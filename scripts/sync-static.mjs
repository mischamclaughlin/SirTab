import { cp, mkdir, rm } from "node:fs/promises";

export async function syncStatic({ clean = false } = {}) {
    if (clean) {
        await rm("dist", { recursive: true, force: true });
    }

    await mkdir("dist/sidebar", { recursive: true });

    await Promise.all([
        cp("manifest.json", "dist/manifest.json"),
        cp("src/sidebar/sidebar.html", "dist/sidebar/sidebar.html"),
        cp("src/sidebar/sidebar.css", "dist/sidebar/sidebar.css"),
        cp("src/sidebar/assets", "dist/sidebar/assets", { recursive: true }),
    ]);
}
