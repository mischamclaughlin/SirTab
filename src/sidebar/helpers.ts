import {
    COLLAPSED_GROUPS_STORAGE_KEY,
    COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY,
    DEFAULT_TAB_ICON_URL,
    chromeToUiColor,
} from "./config.js";

export function buildCycle(
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

export type ToggleNode = chrome.tabs.Tab | chrome.bookmarks.BookmarkTreeNode;
export type ToggleType = "tab" | "bookmark";

export type NodeType =
    | chrome.tabs.Tab
    | chrome.bookmarks.BookmarkTreeNode
    | chrome.tabGroups.TabGroup;

function isBookmarkNode(
    node: ToggleNode,
): node is chrome.bookmarks.BookmarkTreeNode {
    return !("active" in node);
}

function isGroupNode(node: NodeType): node is chrome.tabGroups.TabGroup {
    return !("active" in node);
}

export function isCollpased(id: string, list: Set<string>) {
    return list.has(id);
}

export function removeNodeFromCollapsed(node: ToggleNode, list: Set<string>) {
    if (node.url) return;

    const nodeId = String(node.id);
    list.delete(nodeId);

    const isBookmark = isBookmarkNode(node);

    if (isBookmark) {
        const childrenNodes = node.children;
        if (!childrenNodes) return;

        for (const cNode of childrenNodes) {
            removeNodeFromCollapsed(cNode, list);
        }
    }
}

export function toggleView(
    isCollapsed: boolean,
    node: ToggleNode,
    list: Set<string>,
    type: ToggleType = "bookmark",
    onToggle?: () => void,
    hasChildren?: boolean,
    colour?: string,
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
    icon.textContent = hasChildren ? toggleIcon : " ";

    const title = document.createElement("h4");
    title.className = "group-toggle-title";
    title.textContent = node.title?.trim() || "(unititled)";

    btn.append(icon, title);

    btn.addEventListener("click", async () => {
        await toggleInList(list, nodeId, type);
        onToggle?.();
    });

    return btn;
}

export async function toggleInList(list: Set<string>, id: string, type: ToggleType) {
    list.has(id) ? list.delete(id) : list.add(id);

    await persistCollapse(list, type);
}

export async function getCurrentWindowId() {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return null;

    return currentWindow.id;
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
    btn.textContent = type === "bookmark" ? "bookmark +" : "book +";

    return false;
}

function includesNormalised(value: string | undefined, query: string) {
    if (query.length === 0) return true;
    if (!value) return false;
    return value.toLowerCase().includes(query);
}

export function nodeQuery(node: NodeType, query: string) {
    const isGroup = isGroupNode(node);
    if (isGroup) return includesNormalised(node.title, query);

    return (
        includesNormalised(node.title, query) ||
        includesNormalised(node.url, query)
    );
}
