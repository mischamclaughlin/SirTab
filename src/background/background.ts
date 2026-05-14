import {
    orderGroupsByTabPosition,
    sortTabsByIndex,
} from "../shared/groupOrder.js";

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) =>
        console.error("Failed to set side panel behavior:", error),
    );

const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedGroupsByWindow";

async function getVisibleTabOrderForCurrentWindow(): Promise<number[]> {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return [];

    const [tabs, groups, storage] = await Promise.all([
        chrome.tabs.query({ windowId: currentWindow.id }),
        chrome.tabGroups.query({ windowId: currentWindow.id }),
        chrome.storage.local.get(COLLAPSED_GROUPS_STORAGE_KEY),
    ]);

    const rawByWindow = storage[COLLAPSED_GROUPS_STORAGE_KEY];
    const byWindow: Record<string, unknown> =
        typeof rawByWindow === "object" && rawByWindow != null
            ? (rawByWindow as Record<string, unknown>)
            : {};
    const storedGroupIds = byWindow[String(currentWindow.id)];
    const collapsedGroups = new Set(
        Array.isArray(storedGroupIds)
            ? storedGroupIds
                .filter(
                    (groupId): groupId is string | number =>
                        typeof groupId === "string" ||
                        typeof groupId === "number",
                )
                .map(String)
            : [],
    );
    const orderedTabs = sortTabsByIndex(tabs);
    const orderedGroups = orderGroupsByTabPosition(groups, orderedTabs);

    const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
    const ungroupedTabs: chrome.tabs.Tab[] = [];

    for (const tab of orderedTabs) {
        if (tab.id == null || tab.groupId == null) continue;
        if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            ungroupedTabs.push(tab);
            continue;
        }
        const groupedTabs = tabsByGroup.get(tab.groupId);
        if (groupedTabs) groupedTabs.push(tab);
        else tabsByGroup.set(tab.groupId, [tab]);
    }

    const orderedTabIds: number[] = [];
    for (const tab of ungroupedTabs) {
        if (tab.id != null) orderedTabIds.push(tab.id);
    }

    for (const group of orderedGroups) {
        const groupId = group.id;
        if (groupId == null || collapsedGroups.has(String(groupId))) continue;
        const groupedTabs = tabsByGroup.get(groupId) ?? [];
        for (const tab of groupedTabs) {
            if (tab.id != null) orderedTabIds.push(tab.id);
        }
    }

    return orderedTabIds;
}

async function cycleVisibleTabs(direction: 1 | -1) {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return;

    const [activeTab] = await chrome.tabs.query({
        windowId: currentWindow.id,
        active: true,
    });
    if (activeTab?.id == null) return;

    const orderedTabIds = await getVisibleTabOrderForCurrentWindow();
    if (orderedTabIds.length === 0) return;

    const currentIndex = orderedTabIds.indexOf(activeTab.id);
    const startIndex =
        currentIndex >= 0
            ? currentIndex
            : direction === 1
                ? -1
                : 0;
    const nextIndex =
        (startIndex + direction + orderedTabIds.length) % orderedTabIds.length;
    const nextTabId = orderedTabIds[nextIndex];
    if (nextTabId == null) return;

    await chrome.tabs.update(nextTabId, { active: true });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "cycle_next_visible_tab") {
        void cycleVisibleTabs(1);
    } else if (command === "cycle_previous_visible_tab") {
        void cycleVisibleTabs(-1);
    }
});

async function moveVisibleTab(direction: 1 | -1) {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return;

    const [activeTab] = await chrome.tabs.query({
        windowId: currentWindow.id,
        active: true,
    });

    if (activeTab?.id == null) return;

    const orderedTabIds = await getVisibleTabOrderForCurrentWindow();
    if (orderedTabIds.length <= 1) return;

    const currentIndex = orderedTabIds.indexOf(activeTab.id);
    if (currentIndex === -1) return;

    const nextIndex =
        (currentIndex + direction + orderedTabIds.length) % orderedTabIds.length;

    const nextTabId = orderedTabIds[nextIndex];
    if (nextTabId == null) return;

    const nextTab = await chrome.tabs.get(nextTabId);

    if (nextTab.index == null) return;

    await chrome.tabs.move(activeTab.id, {
        windowId: currentWindow.id,
        index: nextTab.index,
    });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "move_active_tab_next") {
        void moveVisibleTab(1);
    } else if (command == "move_active_tab_previous") {
        void moveVisibleTab(-1);
    }
});

