import { readdir } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { syncStatic } from "./sync-static.mjs";

const STATIC_WATCH_INTERVAL_MS = 1500;

const watchTargets = [
    "manifest.json",
    "src/sidebar/sidebar.html",
    "src/sidebar/sidebar.css",
];

let syncQueued = false;
let syncInProgress = false;
let debounceTimer;

async function runSync(reason, { clean = false } = {}) {
    if (syncInProgress) {
        syncQueued = true;
        return;
    }

    syncInProgress = true;
    try {
        await syncStatic({ clean });
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

await runSync("initial", { clean: true });

const assetFiles = (await readdir("src/sidebar/assets")).map(
    (file) => `src/sidebar/assets/${file}`,
);
const styleFiles = (await readdir("src/sidebar/styles")).map(
    (file) => `src/sidebar/styles/${file}`,
);
const filesToWatch = [...watchTargets, ...styleFiles, ...assetFiles];

for (const target of filesToWatch) {
    watchFile(target, { interval: STATIC_WATCH_INTERVAL_MS }, () => {
        scheduleSync(target);
    });
}

function closeWatchers() {
    clearTimeout(debounceTimer);
    for (const target of filesToWatch) {
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
