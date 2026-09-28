import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidates = [
    process.env.SIRTAB_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
].filter(Boolean);
const browser = candidates.find((candidate) => existsSync(candidate));
assert.ok(browser, "Chrome or Brave is required for the browser interaction test");

const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
    }
    try {
        const contents = await readFile(file);
        response.setHeader(
            "Content-Type",
            file.endsWith(".js") ? "text/javascript" : "text/html",
        );
        response.end(contents);
    } catch {
        response.writeHead(404).end();
    }
});

const profile = await mkdtemp(path.join(tmpdir(), "sirtab-browser-test-"));
let child;
let timeout;
try {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const page = process.env.SIRTAB_TEST_PAGE ?? "tests/refresh-interaction.html";
    const url = `http://127.0.0.1:${address.port}/${page}`;
    child = spawn(browser, [
        "--headless=new",
        "--no-first-run",
        "--disable-gpu",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=3000",
        "--dump-dom",
        url,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let output = "";
    let errors = "";
    const result = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Browser test timed out")), 30000);
        child.on("error", reject);
        child.stdout.on("data", (chunk) => {
            output += chunk;
            const match = output.match(/<output id="result">(PASS|FAIL: [^<]*)<\/output>/);
            if (match) resolve(match[1]);
        });
        child.stderr.on("data", (chunk) => {
            errors += chunk;
        });
        child.on("exit", (code) => {
            const match = output.match(/<output id="result">(PASS|FAIL: [^<]*)<\/output>/);
            if (match) resolve(match[1]);
            else reject(new Error(`Browser exited ${code} before reporting a result: ${errors.slice(-800)}`));
        });
    });
    assert.equal(result, "PASS", result);
    process.stdout.write(`PASS: ${page} in ${path.basename(browser)}\n`);
} finally {
    clearTimeout(timeout);
    if (child && child.exitCode == null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
}
