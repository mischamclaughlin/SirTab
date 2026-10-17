import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function until(read, description) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error(`Timed out waiting for ${description}`);
}

// Run fixtures with real browser timing; optionally profile before navigation
// so module initialisation and same-origin iframe execution are included.
export async function runBrowserFixture({ browser, profile, url, root, directory, screenshotPath }) {
    const child = spawn(browser, [
        "--headless=new", "--no-first-run", "--disable-gpu",
        `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-2000); });
    child.on("error", (error) => { errors += error.message; });
    let socket;
    const pending = new Map();
    try {
        const port = await until(async () => {
            try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; }
            catch { return null; }
        }, "browser debugging port");
        const target = await until(async () => {
            const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
            return targets.find((target) => target.type === "page");
        }, "browser page");
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", reject, { once: true });
        });
        let sequence = 0;
        socket.addEventListener("message", ({ data }) => {
            const message = JSON.parse(data);
            const callback = pending.get(message.id);
            if (!callback) return;
            pending.delete(message.id);
            clearTimeout(callback.timeout);
            if (message.error) callback.reject(Error(JSON.stringify(message.error)));
            else callback.resolve(message.result);
        });
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(Error(`CDP timed out: ${method}`));
            }, 10000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
        });
        await send("Page.enable");
        if (directory) {
            await send("Profiler.enable");
            await send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
        }
        if (screenshotPath) await send("Emulation.setDeviceMetricsOverride", {
            width: 360, height: 600, deviceScaleFactor: 1, mobile: false,
        });
        await send("Page.navigate", { url });
        const result = await until(async () => {
            const evaluated = await send("Runtime.evaluate", {
                expression: "document.querySelector('output#result')?.textContent ?? ''",
                returnByValue: true,
            });
            const value = evaluated.result.value;
            return value === "PASS" || value?.startsWith("FAIL:") ? value : null;
        }, "fixture result");
        if (directory) {
            const coverage = await send("Profiler.takePreciseCoverage");
            const origin = new URL(url).origin;
            const scripts = coverage.result.flatMap((script) => {
                if (!script.url.startsWith(`${origin}/dist/`)) return [];
                const pathname = decodeURIComponent(new URL(script.url).pathname);
                const file = path.resolve(root, `.${pathname}`);
                if (!file.startsWith(`${path.join(root, "dist")}${path.sep}`)) return [];
                return [{ ...script, url: pathToFileURL(file).href }];
            });
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, `coverage-browser-${process.pid}-${Date.now()}.json`), JSON.stringify({ result: scripts }));
            await send("Profiler.stopPreciseCoverage");
        }
        if (screenshotPath) {
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            await writeFile(screenshotPath, Buffer.from(data, "base64"));
        }
        return result;
    } catch (error) {
        throw Error(`${error.message}\n${errors}`, { cause: error });
    } finally {
        for (const callback of pending.values()) {
            clearTimeout(callback.timeout);
            callback.reject(Error("Browser fixture session closed"));
        }
        socket?.close();
        if (child.exitCode == null && child.signalCode == null) {
            await new Promise((resolve) => {
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
                timer.unref();
                child.once('exit', () => { clearTimeout(timer); resolve(); });
                child.kill();
            });
        }
    }
}
