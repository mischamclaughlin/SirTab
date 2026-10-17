import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserFixture } from "./helpers/browser-fixture.mjs";

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
        response.setHeader("Content-Type", /\.m?js$/.test(file) ? "text/javascript" :
            file.endsWith(".css") ? "text/css" : "text/html");
        response.end(contents);
    } catch {
        response.writeHead(404).end();
    }
});
const profile = await mkdtemp(path.join(tmpdir(), "sirtab-browser-test-"));
try {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const page = process.env.SIRTAB_TEST_PAGE ?? "tests/refresh-interaction.html";
    const url = `http://127.0.0.1:${server.address().port}/${page}`;
    const result = await runBrowserFixture({
        browser, profile, url, root,
        screenshotPath: process.env.SIRTAB_TEST_SCREENSHOT,
        directory: process.env.SIRTAB_COVERAGE_DIRECTORY,
    });
    assert.equal(result, "PASS", result);
    process.stdout.write(`PASS: ${page} in ${path.basename(browser)}${process.env.SIRTAB_COVERAGE_DIRECTORY ? " (coverage)" : ""}\n`);
} finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
