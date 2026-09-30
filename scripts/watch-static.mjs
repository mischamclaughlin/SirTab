import { watchFile, unwatchFile } from "node:fs";
import { readdir } from "node:fs/promises";
import { syncStatic } from "./sync-static.mjs";

const STATIC_WATCH_INTERVAL_MS = 1500;

const watchTargets = [
    "manifest.json",
    "src/sidebar/sidebar.html",
    "src/sidebar/sidebar.css",
];
const watchDirectories = ["src/sidebar/assets", "src/sidebar/styles"];
const watchedFiles = new Set();

let syncQueued = false;
let syncInProgress = false;
let debounceTimer;

async function runSync(reason) {
    if (syncInProgress) {
        syncQueued = true;
        return;
    }

    syncInProgress = true;
    try {
        await syncStatic();
        console.log(`[static] synced (${reason})`);
    } catch (error) {
        console.error("[static] sync failed");
        console.error(error);
    } finally {
        syncInProgress = false;
        if (syncQueued) {
            syncQueued = false;
            void runSync("queued update");
        }
    }
}

function scheduleSync(reason) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        void runSync(reason);
    }, 50);
}

function watchTarget(target) {
    watchFile(target, { interval: STATIC_WATCH_INTERVAL_MS }, () => {
        scheduleSync(target);
    });
}

async function collectFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const target = `${directory}/${entry.name}`;
        return entry.isDirectory() ? collectFiles(target) : [target];
    }));
    return nested.flat();
}

async function refreshWatchedFiles() {
    const files = new Set((await Promise.all(watchDirectories.map(collectFiles))).flat());
    let changed = false;
    for (const target of watchedFiles) {
        if (!files.has(target)) {
            unwatchFile(target);
            watchedFiles.delete(target);
            changed = true;
        }
    }
    for (const target of files) {
        if (!watchedFiles.has(target)) {
            watchTarget(target);
            watchedFiles.add(target);
            changed = true;
        }
    }
    return changed;
}

for (const target of watchTargets) watchTarget(target);
await refreshWatchedFiles();
const inventoryTimer = setInterval(() => {
    void refreshWatchedFiles()
        .then((changed) => { if (changed) scheduleSync("file inventory"); })
        .catch((error) => console.error("[static] inventory failed", error));
}, STATIC_WATCH_INTERVAL_MS);

await runSync("initial");

function closeWatchers() {
    clearTimeout(debounceTimer);
    clearInterval(inventoryTimer);
    for (const target of [...watchTargets, ...watchedFiles]) {
        unwatchFile(target);
    }
}

process.on("SIGINT", () => {
    closeWatchers();
    process.exit(0);
});

process.on("SIGTERM", () => {
    closeWatchers();
    process.exit(0);
});
