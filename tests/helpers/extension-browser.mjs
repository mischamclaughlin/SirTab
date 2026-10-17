import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function until(read, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// A disposable profile is essential: these tests intentionally mutate real tabs,
// windows, bookmarks and extension storage, never an existing browser session.
export async function launchExtension(root) {
  const browser = [
    process.env.SIRTAB_EXTENSION_BROWSER,
    process.env.SIRTAB_BROWSER,
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/brave-browser",
    "/usr/bin/chromium",
  ]
    .filter(Boolean)
    .find(existsSync);
  if (!browser)
    throw new Error(
      "Brave or Chromium with unpacked-extension support is required",
    );
  const profile = await mkdtemp(path.join(tmpdir(), "sirtab-extension-test-"));
  const sockets = [];
  let errors = "";
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      `--disable-extensions-except=${path.join(root, "dist")}`,
      `--load-extension=${path.join(root, "dist")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (data) => {
    errors = (errors + data).slice(-4000);
  });
  child.on("error", (error) => {
    errors += error.message;
  });
  const close = async () => {
    for (const socket of sockets) socket.close();
    if (child.exitCode == null && child.signalCode == null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        timer.unref();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  };
  try {
    const port = await until(async () => {
      try {
        return (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
      } catch {
        return null;
      }
    }, "browser debugging port");
    const targets = () =>
      fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(5000),
      }).then((response) => response.json());
    const connect = async (target) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let sequence = 0;
      const pending = new Map();
      socket.addEventListener("message", ({ data }) => {
        const result = JSON.parse(data),
          callback = pending.get(result.id);
        if (!callback) return;
        pending.delete(result.id);
        clearTimeout(callback.timeout);
        if (result.error)
          callback.reject(new Error(JSON.stringify(result.error)));
        else callback.resolve(result.result);
      });
      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timed out: ${method}`));
          }, 15000);
          pending.set(id, { resolve, reject, timeout });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      await send("Runtime.enable");
      await send("Runtime.runIfWaitingForDebugger");
      return { send, evaluate };
    };
    const worker = await until(
      async () =>
        (await targets()).find(
          (target) =>
            target.type === "service_worker" &&
            target.url.endsWith("/background/background.js"),
        ),
      "extension service worker",
    );
    const background = await connect(worker);
    await until(
      () =>
        background.evaluate(
          "typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.storage",
        ),
      "extension API initialisation",
    );
    return {
      close,
      targets,
      connect,
      background,
      extensionUrl: `${worker.url.split("/background/")[0]}/sidebar/sidebar.html`,
    };
  } catch (error) {
    await close();
    throw new Error(`${error.message}\n${errors}`, { cause: error });
  }
}
