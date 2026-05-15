import {
    buildVisibleLogicalTabIds,
    getTabGroupId,
    getVisibleMovePosition,
    loadCollapsedGroupIds,
    loadLogicalTabGroupData,
    moveStoredTabRelative,
    setTabGroup,
} from "../shared/groupOrder.js";

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) =>
        console.error("Failed to set side panel behavior:", error),
    );

async function getVisibleTabStateForCurrentWindow() {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return null;
    const windowId = currentWindow.id;

    const [logicalData, collapsedGroups] = await Promise.all([
        loadLogicalTabGroupData(windowId),
        loadCollapsedGroupIds(windowId),
    ]);

    return {
        windowId,
        logicalData,
        orderedTabIds: buildVisibleLogicalTabIds(logicalData, collapsedGroups),
    };
}

async function cycleVisibleTabs(direction: 1 | -1) {
    const visibleState = await getVisibleTabStateForCurrentWindow();
    if (!visibleState) return;

    const [activeTab] = await chrome.tabs.query({
        windowId: visibleState.windowId,
        active: true,
    });
    if (activeTab?.id == null) return;

    if (visibleState.orderedTabIds.length === 0) return;

    const currentIndex = visibleState.orderedTabIds.indexOf(activeTab.id);
    const startIndex =
        currentIndex >= 0
            ? currentIndex
            : direction === 1
                ? -1
                : 0;
    const nextIndex =
        (startIndex + direction + visibleState.orderedTabIds.length) %
        visibleState.orderedTabIds.length;
    const nextTabId = visibleState.orderedTabIds[nextIndex];
    if (nextTabId == null) return;

    await chrome.tabs.update(nextTabId, { active: true });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "cycle_next_visible_tab") {
        void cycleVisibleTabs(1);
    } else if (command === "cycle_previous_visible_tab") {
        void cycleVisibleTabs(-1);
    } else if (command === "open_quick_search") {
        void openQuickSearchWindow();
    }
});

function getCenteredWindowBounds(
    baseWindow: chrome.windows.Window,
    width: number,
    height: number,
) {
    if (
        baseWindow.left == null ||
        baseWindow.top == null ||
        baseWindow.width == null ||
        baseWindow.height == null
    ) {
        return {};
    }

    return {
        left: Math.max(
            0,
            Math.round(baseWindow.left + (baseWindow.width - width) / 2),
        ),
        top: Math.max(
            0,
            Math.round(baseWindow.top + (baseWindow.height - height) / 2),
        ),
    };
}

async function openQuickSearchWindow() {
    const width = 720;
    const height = 520;
    const lastFocusedWindow = await chrome.windows.getLastFocused();

    await chrome.windows.create({
        ...getCenteredWindowBounds(lastFocusedWindow, width, height),
        type: "normal",
        state: "normal",
        width,
        height,
        focused: true,
    });
}

async function moveVisibleTab(direction: 1 | -1) {
    const visibleState = await getVisibleTabStateForCurrentWindow();
    if (!visibleState) return;

    const [activeTab] = await chrome.tabs.query({
        windowId: visibleState.windowId,
        active: true,
    });

    if (activeTab?.id == null) return;

    if (visibleState.orderedTabIds.length <= 1) return;

    const currentIndex = visibleState.orderedTabIds.indexOf(activeTab.id);
    if (currentIndex === -1) return;

    const nextIndex =
        (currentIndex + direction + visibleState.orderedTabIds.length) %
        visibleState.orderedTabIds.length;

    const nextTabId = visibleState.orderedTabIds[nextIndex];
    if (nextTabId == null) return;

    const targetTab = visibleState.logicalData.tabs.find(
        (tab) => tab.id === nextTabId,
    );
    if (targetTab?.id == null) return;

    const sourceGroupId = getTabGroupId(activeTab);
    const targetGroupId = getTabGroupId(targetTab);
    const position = getVisibleMovePosition({
        sourceGroupId,
        targetGroupId,
        direction,
        currentIndex,
        nextIndex,
    });

    await setTabGroup(activeTab.id, targetGroupId);
    await moveStoredTabRelative(
        visibleState.windowId,
        activeTab.id,
        targetTab.id,
        position,
    );
    await chrome.tabs.update(activeTab.id, { active: true });
}

chrome.commands.onCommand.addListener((command) => {
    if (command === "move_active_tab_next") {
        void moveVisibleTab(1);
    } else if (command == "move_active_tab_previous") {
        void moveVisibleTab(-1);
    }
});
