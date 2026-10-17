import { SidebarTheme, THEMES, THEME_STORAGE_KEY } from "../config.js";

export function applyTheme(theme: SidebarTheme) {
    document.documentElement.setAttribute("data-theme", theme);
}

export async function loadThemePreference() {
    let savedTheme: unknown;
    try {
        const storage = await chrome.storage.local.get(THEME_STORAGE_KEY);
        savedTheme = storage[THEME_STORAGE_KEY];
    } catch (error) {
        console.error("Load theme preference failed:", error);
    }
    const normalizedSavedTheme =
        savedTheme === "standard-dark"
            ? "dark"
            : savedTheme === "standard-light"
              ? "light"
              : savedTheme === "catppuccin-dark"
                ? "mocha"
                : savedTheme === "catppuccin-light"
                  ? "latte"
                  : savedTheme === "cappucin-light"
                    ? "latte"
                    : savedTheme === "claude" || savedTheme === "retro"
                      ? "retro-dark"
                      : savedTheme;
    const theme = THEMES.includes(savedTheme as SidebarTheme)
        ? (savedTheme as SidebarTheme)
        : THEMES.includes(normalizedSavedTheme as SidebarTheme)
          ? (normalizedSavedTheme as SidebarTheme)
          : "dark";
    applyTheme(theme);
}
