export const DEFAULT_TAB_ICON_URL = chrome.runtime.getURL(
    "sidebar/assets/default-tab-icon.svg",
);

export const THEME_STORAGE_KEY = "sidebarTheme";
export const THEMES = [
    "dark",
    "light",
    "mocha",
    "latte",
    "retro-dark",
    "retro-light",
] as const;
export type SidebarTheme = (typeof THEMES)[number];

export const groupColorMap = {
    none: "grey",
    blue: "blue",
    red: "red",
    yellow: "yellow",
    green: "green",
    pink: "pink",
    lavender: "purple",
    sky: "cyan",
    peach: "orange",
} as const;
export type GroupColorChoice = keyof typeof groupColorMap;

export const chromeToUiColor: Record<string, string> = {
    grey: "var(--group-grey)",
    blue: "var(--group-blue)",
    red: "var(--group-red)",
    yellow: "var(--group-yellow)",
    green: "var(--group-green)",
    pink: "var(--group-pink)",
    purple: "var(--group-lavender)",
    cyan: "var(--group-sky)",
    orange: "var(--group-peach)",
};

export const COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY =
    "collapsedBookmarkFolders";

export const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedGroupsByWindow";
