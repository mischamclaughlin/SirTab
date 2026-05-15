import { THEME_STORAGE_KEY, THEMES, SidebarTheme } from "../config.js";
import { runButtonAction } from "../helpers/domFactory.js";
import { applyTheme } from "../helpers/theme.js";

type ShortcutCommandId =
    | "_execute_action"
    | "cycle_next_visible_tab"
    | "cycle_previous_visible_tab"
    | "move_active_tab_next"
    | "move_active_tab_previous";

const SHORTCUT_COMMANDS: {
    id: ShortcutCommandId;
    label: string;
}[] = [
    { id: "_execute_action", label: "open Sir Tab" },
    { id: "cycle_next_visible_tab", label: "next tab" },
    { id: "cycle_previous_visible_tab", label: "previous tab" },
    { id: "move_active_tab_next", label: "move tab down" },
    { id: "move_active_tab_previous", label: "move tab up" },
];

async function refreshShortcutList(list: HTMLElement) {
    const commands = await chrome.commands.getAll();
    const commandByName = new Map(
        commands
            .filter((command) => command.name != null)
            .map((command) => [command.name!, command]),
    );

    list.replaceChildren();

    for (const shortcutCommand of SHORTCUT_COMMANDS) {
        const command = commandByName.get(shortcutCommand.id);
        const shortcut = command?.shortcut?.trim() ?? "";

        const row = document.createElement("li");
        row.className = "shortcut-row";

        const label = document.createElement("span");
        label.className = "shortcut-name";
        label.textContent = shortcutCommand.label;

        const value = document.createElement("span");
        value.className = "shortcut-value";
        if (shortcut.length === 0) {
            value.classList.add("is-missing");
            value.textContent = "not set";
        } else {
            value.textContent = shortcut;
        }

        row.append(label, value);
        list.append(row);
    }
}

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
    const themeHeading = document.createElement("h2");
    themeHeading.className = "setting-heading";
    themeHeading.textContent = "theme";

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

    const shortcutSection = document.createElement("div");
    shortcutSection.className = "shortcut-settings";

    const shortcutHeading = document.createElement("h2");
    shortcutHeading.className = "setting-heading";
    shortcutHeading.textContent = "keyboard shortcuts";

    const shortcutList = document.createElement("ul");
    shortcutList.className = "shortcut-list";

    const shortcutActions = document.createElement("div");
    shortcutActions.className = "shortcut-actions";

    const openShortcutsBtn = document.createElement("button");
    openShortcutsBtn.type = "button";
    openShortcutsBtn.className = "control";
    openShortcutsBtn.textContent = "set shortcuts";

    const refreshShortcutsBtn = document.createElement("button");
    refreshShortcutsBtn.type = "button";
    refreshShortcutsBtn.className = "control";
    refreshShortcutsBtn.textContent = "refresh";

    openShortcutsBtn.addEventListener("click", () => {
        void runButtonAction(
            openShortcutsBtn,
            async () => {
                await chrome.tabs.create({
                    url: "chrome://extensions/shortcuts",
                });
            },
            "Open shortcut settings failed:",
        );
    });

    refreshShortcutsBtn.addEventListener("click", () => {
        void runButtonAction(
            refreshShortcutsBtn,
            async () => refreshShortcutList(shortcutList),
            "Refresh shortcuts failed:",
        );
    });

    shortcutActions.append(openShortcutsBtn, refreshShortcutsBtn);
    shortcutSection.append(shortcutHeading, shortcutList, shortcutActions);

    settingInfoSection.append(shortcutSection, themeHeading, themeOptions);

    let isSettingOpen = false;

    settingsBtn.addEventListener("click", () => {
        isSettingOpen = !isSettingOpen;
        settingInfoSection.hidden = !isSettingOpen;
        settingsBtn.setAttribute("aria-expanded", String(isSettingOpen));
        if (isSettingOpen) {
            void refreshShortcutList(shortcutList);
        }
    });

    settings?.append(settingInfoSection, settingsBtn);
}
