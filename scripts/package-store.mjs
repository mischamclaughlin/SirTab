import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const distDirectory = path.resolve("dist");
const manifest = JSON.parse(await readFile(path.join(distDirectory, "manifest.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
    throw new Error("The extension manifest needs a valid release version");
}

async function listFiles(directory, prefix = "") {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name);
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Unexpected symbolic link: ${relativePath}`);
        } else if (entry.isDirectory()) {
            files.push(...await listFiles(fullPath, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        } else {
            throw new Error(`Unexpected build entry: ${relativePath}`);
        }
    }
    return files;
}

const files = (await listFiles(distDirectory))
    .filter((file) => !file.endsWith(".map"))
    .sort();
const allowed = (file) =>
    file === "manifest.json" ||
    /^(?:background|shared|sidebar)\/.+\.(?:js|css|html|png|svg)$/.test(file);
const unexpected = files.filter((file) => !allowed(file));
if (unexpected.length > 0) {
    throw new Error(`Unexpected files in extension build: ${unexpected.join(", ")}`);
}
for (const required of [
    "manifest.json",
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.icons?.["128"],
]) {
    if (!required || !files.includes(required)) {
        throw new Error(`Missing required extension file: ${required}`);
    }
}

const outputDirectory = path.resolve("webstore");
await mkdir(outputDirectory, { recursive: true });
const archive = path.join(outputDirectory, `sir-tab-${manifest.version}.zip`);
try {
    await unlink(archive);
} catch (error) {
    if (error.code !== "ENOENT") throw error;
}

await new Promise((resolve, reject) => {
    const child = spawn("zip", ["-q", "-X", archive, ...files], {
        cwd: distDirectory,
        stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`zip exited with status ${code}`));
    });
});

process.stdout.write(`${archive}\n`);
