import {
    COLLAPSED_GROUPS_STORAGE_KEY,
    COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY,
    DEFAULT_TAB_ICON_URL,
    chromeToUiColor,
} from "./config.js";
import { THEME_STORAGE_KEY, THEMES, SidebarTheme } from "./config.js";

export function applyTheme(theme: SidebarTheme) {
    document.documentElement.setAttribute("data-theme", theme);
}

export async function loadThemePreference() {
    const storage = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const savedTheme = storage[THEME_STORAGE_KEY];
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

export function cycleTabs(
    tabElement: HTMLElement,
    tabList: chrome.tabs.Tab[],
    grouped = false,
    groupColour?: string,
) {
    for (const tab of tabList) {
        if (tab.id == null) continue;

        const li = document.createElement("li");
        li.className = "tab-item";

        const btn = document.createElement("button");
        btn.className = grouped ? "group-tab" : "ungroup-tab";
        btn.type = "button";

        const icon = document.createElement("img");
        icon.className = "tab-icon";
        icon.src = tab.favIconUrl || DEFAULT_TAB_ICON_URL;
        icon.alt = "";
        icon.width = 16;
        icon.height = 16;
        icon.addEventListener("error", () => {
            icon.src = DEFAULT_TAB_ICON_URL;
        });

        const label = document.createElement("span");
        label.className = "tab-label";

        if (tab.active) label.className += " active-tab";
        const title = tab.title?.trim() ?? "";
        const text = title || tab.url || "(Untitled tab)";
        label.textContent = text;

        btn.append(icon, label);

        btn.addEventListener("click", async () => {
            await chrome.tabs.update(tab.id!, { active: true });
        });

        const row = document.createElement("div");
        row.className = "tab-row";

        const deleteBtn = createDeleteButton("Close tab", async () => {
            await chrome.tabs.remove(tab.id!);
        });

        row.append(btn, deleteBtn);
        li.appendChild(row);
        tabElement.appendChild(li);
        tabElement.style.background = groupColour
            ? chromeToUiColor[groupColour]
            : "var(--blue)";
    }
}

export function createDeleteButton(
    title: string,
    onClick: () => Promise<void> | void,
) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "row-delete-btn";
    deleteBtn.title = title;
    deleteBtn.setAttribute("aria-label", title);
    deleteBtn.textContent = "x";
    deleteBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await onClick();
    });

    return deleteBtn;
}

export type ToggleNode =
    | chrome.bookmarks.BookmarkTreeNode
    | chrome.tabGroups.TabGroup;
export type ToggleType = "tab" | "bookmark";

export type NodeType = chrome.tabs.Tab | ToggleNode;

function isTabNode(node: NodeType): node is chrome.tabs.Tab {
    return "active" in node;
}

function isGroupNode(
    node: ToggleNode | NodeType,
): node is chrome.tabGroups.TabGroup {
    return "collapsed" in node;
}

export function isCollpased(id: string | number, list: Set<string>) {
    return list.has(String(id));
}

export function removeNodeFromCollapsed(
    node: chrome.bookmarks.BookmarkTreeNode,
    list: Set<string>,
) {
    if (node.url) return;

    const nodeId = String(node.id);
    list.delete(nodeId);

    const childrenNodes = node.children;
    if (!childrenNodes) return;

    for (const cNode of childrenNodes) {
        removeNodeFromCollapsed(cNode, list);
    }
}

type ToggleViewOptions = {
    type?: ToggleType;
    onToggle?: () => void;
    hasChildren?: boolean;
    colour?: string;
    canToggle?: boolean;
};

export function toggleView(
    isCollapsed: boolean,
    node: ToggleNode,
    list: Set<string>,
    {
        type = "bookmark",
        onToggle,
        hasChildren = true,
        colour,
        canToggle = hasChildren,
    }: ToggleViewOptions = {},
) {
    const nodeId = String(node.id);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-toggle";
    btn.style.background = colour ? colour : "transparent";

    const icon = document.createElement("h4");
    icon.className = "group-toggle-icon";
    const toggleIcon = hasChildren ? (isCollapsed ? "▸" : "▾") : " ";
    icon.textContent = toggleIcon;

    const title = document.createElement("h4");
    title.className = "group-toggle-title";
    title.textContent = node.title?.trim() || "(untitled)";

    btn.append(icon, title);

    btn.addEventListener("click", async () => {
        if (!canToggle || !hasChildren) return;
        await toggleInList(list, nodeId, type);
        onToggle?.();
    });

    return btn;
}

export async function toggleInList(
    list: Set<string>,
    id: string,
    type: ToggleType,
) {
    list.has(id) ? list.delete(id) : list.add(id);

    await persistCollapse(list, type);
}

export async function getCurrentWindowId() {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return null;

    return currentWindow.id;
}

export async function loadCollapse(
    list: Set<string>,
    type: ToggleType,
): Promise<void> {
    const key =
        type === "tab"
            ? COLLAPSED_GROUPS_STORAGE_KEY
            : COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY;
    const storage = await chrome.storage.local.get(key);

    list.clear();

    if (type === "tab") {
        const windowId = await getCurrentWindowId();
        if (windowId === null) return;

        const rawByWindow = storage[key];
        const byWindow: Record<string, unknown> =
            typeof rawByWindow === "object" && rawByWindow != null
                ? (rawByWindow as Record<string, unknown>)
                : {};
        const storedIds = byWindow[String(windowId)];
        if (!Array.isArray(storedIds)) return;

        for (const id of storedIds) {
            if (typeof id === "string" || typeof id === "number") {
                list.add(String(id));
            }
        }

        return;
    }

    const storedIds = storage[key];
    if (!Array.isArray(storedIds)) return;

    for (const id of storedIds) {
        if (typeof id === "string" || typeof id === "number") {
            list.add(String(id));
        }
    }
}

export async function persistCollapse(
    list: Set<string>,
    type: ToggleType,
): Promise<void> {
    const key =
        type === "tab"
            ? COLLAPSED_GROUPS_STORAGE_KEY
            : COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY;

    if (type === "tab") {
        const windowId = await getCurrentWindowId();
        if (windowId === null) return;

        const storage = await chrome.storage.local.get(key);
        const rawByWindow = storage[key];
        const byWindow: Record<string, string[]> =
            typeof rawByWindow === "object" && rawByWindow != null
                ? (rawByWindow as Record<string, string[]>)
                : {};

        byWindow[String(windowId)] = Array.from(list);

        return await chrome.storage.local.set({ [key]: byWindow });
    }

    return await chrome.storage.local.set({ [key]: Array.from(list) });
}

export function resetCreationState(
    actions: HTMLElement,
    btn: HTMLElement,
    type: ToggleType,
) {
    actions.querySelector(".info-dropdown")?.remove();
    if (type === "bookmark")
        actions.querySelector(".add-current-tab-btn")?.remove();
    btn.textContent = type === "bookmark" ? "bookmark +" : "group +";

    return false;
}

function includesNormalized(value: string | undefined, query: string) {
    if (query.length === 0) return true;
    if (!value) return false;
    return value.toLowerCase().includes(query);
}

export function nodeQuery(node: NodeType, query: string) {
    if (isGroupNode(node)) return includesNormalized(node.title, query);
    if (isTabNode(node)) {
        return (
            includesNormalized(node.title, query) ||
            includesNormalized(node.url, query)
        );
    }

    return (
        includesNormalized(node.title, query) ||
        includesNormalized(node.url, query)
    );
}

export function isCollapsedInList(list: Set<string>, id: string | number) {
    return list.has(String(id));
}

export function queueRender(
    renderQueued: boolean,
    render: () => Promise<void>,
) {
    if (renderQueued) return;
    renderQueued = true;

    queueMicrotask(() => {
        renderQueued = false;
        void render();
    });
}

export function createEmptyState(message: string) {
    const li = document.createElement("li");
    li.className = "empty-state-message";
    li.textContent = message;
    return li;
}

export async function loadAllData() {
    return Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
        chrome.bookmarks.getTree(),
    ]);
}

export async function groupCollapse(
    groups: chrome.tabGroups.TabGroup[],
    collapsedGroups: Set<string>,
) {
    const activeGroupIds = new Set(
        groups
            .map((group) => group.id)
            .filter((groupId): groupId is number => groupId != null),
    );
    let removedStaleGroupId = false;
    for (const groupId of collapsedGroups) {
        if (!activeGroupIds.has(Number(groupId))) {
            collapsedGroups.delete(groupId);
            removedStaleGroupId = true;
        }
    }
    if (removedStaleGroupId) {
        await persistCollapse(collapsedGroups, "tab");
    }
}

export async function setupTabSearch(
    tabs: chrome.tabs.Tab[],
    getSearchQuery: () => string,
) {
    const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
    const ungroupedTabs: chrome.tabs.Tab[] = [];
    for (const tab of tabs) {
        if (tab.groupId == null) continue;
        if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            ungroupedTabs.push(tab);
            continue;
        }
        const groupedTabs = tabsByGroup.get(tab.groupId);
        if (groupedTabs) groupedTabs.push(tab);
        else tabsByGroup.set(tab.groupId, [tab]);
    }

    const searchQuery = getSearchQuery();
    const isSearching = searchQuery.length > 0;
    return [isSearching
        ? ungroupedTabs.filter((tab) => nodeQuery(tab, searchQuery))
        : ungroupedTabs, tabsByGroup, isSearching, searchQuery] as const;
}
