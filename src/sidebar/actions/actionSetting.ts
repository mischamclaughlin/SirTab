import { THEME_STORAGE_KEY, THEMES, SidebarTheme } from "../config.js";
import { applyTheme } from "../helpers/theme.js";

export async function setupSettingAction(settings: HTMLElement): Promise<void> {
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.textContent = "settings";
    settingsBtn.className = "control settings-btn";
    settingsBtn.setAttribute("aria-expanded", "false");

    const settingInfoSection = document.createElement("div");
    settingInfoSection.className = "setting-info-section";
    settingInfoSection.hidden = true;
    settingInfoSection.id = "settings-panel";
    settingsBtn.setAttribute("aria-controls", settingInfoSection.id);

    const themeOptions = document.createElement("div");
    themeOptions.className = "theme-options";

    const themeLabels: Record<SidebarTheme, string> = {
        dark: "dark",
        light: "light",
        mocha: "mocha",
        latte: "latte",
        "retro-dark": "retro dark",
        "retro-light": "retro light",
    };

    const themeButtons = new Map<SidebarTheme, HTMLButtonElement>();
    for (const theme of THEMES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "control theme-option";
        button.textContent = themeLabels[theme];
        button.addEventListener("click", async () => {
            applyTheme(theme);
            await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
            for (const [id, btn] of themeButtons) {
                const isSelected = id === theme;
                btn.classList.toggle("is-selected", isSelected);
                btn.setAttribute("aria-pressed", String(isSelected));
            }
        });
        themeButtons.set(theme, button);
        themeOptions.append(button);
    }

    const currentTheme = document.documentElement.getAttribute(
        "data-theme",
    ) as SidebarTheme | null;
    const initialTheme =
        currentTheme && THEMES.includes(currentTheme) ? currentTheme : "dark";
    for (const [id, btn] of themeButtons) {
        const isSelected = id === initialTheme;
        btn.classList.toggle("is-selected", isSelected);
        btn.setAttribute("aria-pressed", String(isSelected));
    }

    settingInfoSection.appendChild(themeOptions);

    let isSettingOpen = false;

    settingsBtn.addEventListener("click", () => {
        isSettingOpen = !isSettingOpen;
        settingInfoSection.hidden = !isSettingOpen;
        settingsBtn.setAttribute("aria-expanded", String(isSettingOpen));
    });

    settings?.append(settingInfoSection, settingsBtn);
}
