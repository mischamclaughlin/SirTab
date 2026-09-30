import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const watcher = fileURLToPath(new URL("../scripts/watch-static.mjs", import.meta.url));

async function waitFor(check) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(50);
    }
    throw new Error("Static watcher did not reflect the source change");
}

async function contents(file) {
    try {
        return await readFile(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
}

test("static watcher preserves compiled files and mirrors added and removed styles", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "sirtab-static-watch-"));
    let child;
    try {
        const source = path.join(directory, "src/sidebar");
        const destination = path.join(directory, "dist/sidebar");
        await Promise.all([
            mkdir(path.join(source, "styles"), { recursive: true }),
            mkdir(path.join(source, "assets"), { recursive: true }),
            mkdir(destination, { recursive: true }),
        ]);
        await Promise.all([
            writeFile(path.join(directory, "manifest.json"), "{}"),
            writeFile(path.join(source, "sidebar.html"), "<html></html>"),
            writeFile(path.join(source, "sidebar.css"), "body {}"),
            writeFile(path.join(destination, "compiled.js"), "compiled output"),
        ]);

        child = spawn(process.execPath, [watcher], {
            cwd: directory,
            stdio: "inherit",
        });
        const compiled = path.join(destination, "compiled.js");
        const outputStyle = path.join(destination, "styles", "new.css");
        const sourceStyle = path.join(source, "styles", "new.css");
        await waitFor(async () => (await contents(path.join(destination, "sidebar.css"))) === "body {}");
        assert.equal(await contents(compiled), "compiled output");

        await writeFile(sourceStyle, "body { color: red; }");
        await waitFor(async () => (await contents(outputStyle)) === "body { color: red; }");
        await rm(sourceStyle);
        await waitFor(async () => (await contents(outputStyle)) === undefined);
        assert.equal(await contents(compiled), "compiled output");
    } finally {
        if (child?.exitCode == null) {
            const exited = new Promise((resolve) => child.once("exit", resolve));
            child.kill("SIGTERM");
            await exited;
        }
        await rm(directory, { recursive: true, force: true });
    }
});
