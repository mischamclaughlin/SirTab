import { syncStatic } from "./sync-static.mjs";

await syncStatic({ clean: process.argv.includes("--clean") });
