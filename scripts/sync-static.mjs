import { cp, mkdir, rm } from "node:fs/promises";

export async function syncStatic({ clean = false } = {}) {
    if (clean) {
        await rm("dist", { recursive: true, force: true });
    }

    await mkdir("dist/sidebar", { recursive: true });
    // Mirror these directories so removed source files do not linger in dist.
    await Promise.all([
        rm("dist/sidebar/styles", { recursive: true, force: true }),
        rm("dist/sidebar/assets", { recursive: true, force: true }),
    ]);

    await Promise.all([
        cp("manifest.json", "dist/manifest.json"),
        cp("src/sidebar/sidebar.html", "dist/sidebar/sidebar.html"),
        cp("src/sidebar/sidebar.css", "dist/sidebar/sidebar.css"),
        cp("src/sidebar/styles", "dist/sidebar/styles", { recursive: true }),
        cp("src/sidebar/assets", "dist/sidebar/assets", { recursive: true }),
    ]);
}
