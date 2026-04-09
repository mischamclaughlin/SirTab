import { spawn } from "node:child_process";

const childProcesses = [
    spawn(
        process.execPath,
        ["node_modules/typescript/bin/tsc", "--watch", "--preserveWatchOutput"],
        { stdio: "inherit" },
    ),
    spawn(process.execPath, ["scripts/watch-static.mjs"], {
        stdio: "inherit",
    }),
];

function shutdown(signal = "SIGTERM") {
    for (const child of childProcesses) {
        if (!child.killed) {
            child.kill(signal);
        }
    }
}

for (const child of childProcesses) {
    child.on("exit", (code) => {
        shutdown();
        process.exit(code ?? 0);
    });
}

process.on("SIGINT", () => {
    shutdown("SIGINT");
    process.exit(0);
});

process.on("SIGTERM", () => {
    shutdown("SIGTERM");
    process.exit(0);
});
