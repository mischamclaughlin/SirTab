import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const pages = process.env.SIRTAB_TEST_PAGE
    ? [process.env.SIRTAB_TEST_PAGE]
    : (await readdir(testsDirectory))
        .filter((file) => file.endsWith(".html"))
        .sort()
        .map((file) => `tests/${file}`);

if (pages.length === 0) throw new Error("No browser test pages found");
if (process.env.SIRTAB_TEST_SCREENSHOT && pages.length !== 1) {
    throw new Error("Set SIRTAB_TEST_PAGE when taking a screenshot");
}

const failures = [];
for (const page of pages) {
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["tests/refresh-interaction.browser.mjs"], {
            cwd: path.dirname(testsDirectory),
            env: { ...process.env, SIRTAB_TEST_PAGE: page },
            stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
    });
    if (result !== 0) failures.push(page);
}

if (failures.length > 0) {
    throw new Error(`${failures.length} browser fixture(s) failed: ${failures.join(", ")}`);
}
