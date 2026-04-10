import type { RequestRender } from "../types.js";

type SidebarEventHandlers = {
    requestTabGroupRefresh: RequestRender;
    requestBookmarkRefresh: RequestRender;
};

const TAB_UPDATE_KEYS_TO_RENDER: (keyof chrome.tabs.OnUpdatedInfo)[] = [
    "favIconUrl",
    "groupId",
    "title",
    "url",
];

function hasRelevantTabUpdate(changeInfo: chrome.tabs.OnUpdatedInfo) {
    return TAB_UPDATE_KEYS_TO_RENDER.some((key) => key in changeInfo);
}

export function setupEventListeners(
    currentWindowId: number,
    {
        requestTabGroupRefresh,
        requestBookmarkRefresh,
    }: SidebarEventHandlers,
): () => void {
    const handleTabCreated = (tab: chrome.tabs.Tab) => {
        if (tab.windowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabRemoved = (
        _tabId: number,
        removeInfo: chrome.tabs.OnRemovedInfo,
    ) => {
        if (removeInfo.windowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabUpdated = (
        _tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab,
    ) => {
        if (tab.windowId !== currentWindowId || !hasRelevantTabUpdate(changeInfo)) {
            return;
        }

        requestTabGroupRefresh();
    };

    const handleTabMoved = (
        _tabId: number,
        moveInfo: chrome.tabs.OnMovedInfo,
    ) => {
        if (moveInfo.windowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabAttached = (
        _tabId: number,
        attachInfo: chrome.tabs.OnAttachedInfo,
    ) => {
        if (attachInfo.newWindowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabDetached = (
        _tabId: number,
        detachInfo: chrome.tabs.OnDetachedInfo,
    ) => {
        if (detachInfo.oldWindowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabActivated = (activeInfo: chrome.tabs.OnActivatedInfo) => {
        if (activeInfo.windowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleTabReplaced = async (addedTabId: number) => {
        try {
            const addedTab = await chrome.tabs.get(addedTabId);
            if (addedTab.windowId !== currentWindowId) return;
            requestTabGroupRefresh();
        } catch (error) {
            console.error("Failed to handle tab replacement:", error);
        }
    };

    const handleTabGroupChange = (group: chrome.tabGroups.TabGroup) => {
        if (group.windowId !== currentWindowId) return;
        requestTabGroupRefresh();
    };

    const handleBookmarkChange = () => requestBookmarkRefresh();

    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.tabs.onMoved.addListener(handleTabMoved);
    chrome.tabs.onAttached.addListener(handleTabAttached);
    chrome.tabs.onDetached.addListener(handleTabDetached);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onReplaced.addListener(handleTabReplaced);
    chrome.tabGroups.onCreated.addListener(handleTabGroupChange);
    chrome.tabGroups.onRemoved.addListener(handleTabGroupChange);
    chrome.tabGroups.onUpdated.addListener(handleTabGroupChange);
    chrome.tabGroups.onMoved.addListener(handleTabGroupChange);
    chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
    chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
    chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);
    chrome.bookmarks.onImportEnded.addListener(handleBookmarkChange);

    const cleanup = () => {
        chrome.tabs.onCreated.removeListener(handleTabCreated);
        chrome.tabs.onRemoved.removeListener(handleTabRemoved);
        chrome.tabs.onUpdated.removeListener(handleTabUpdated);
        chrome.tabs.onMoved.removeListener(handleTabMoved);
        chrome.tabs.onAttached.removeListener(handleTabAttached);
        chrome.tabs.onDetached.removeListener(handleTabDetached);
        chrome.tabs.onActivated.removeListener(handleTabActivated);
        chrome.tabs.onReplaced.removeListener(handleTabReplaced);
        chrome.tabGroups.onCreated.removeListener(handleTabGroupChange);
        chrome.tabGroups.onRemoved.removeListener(handleTabGroupChange);
        chrome.tabGroups.onUpdated.removeListener(handleTabGroupChange);
        chrome.tabGroups.onMoved.removeListener(handleTabGroupChange);
        chrome.bookmarks.onCreated.removeListener(handleBookmarkChange);
        chrome.bookmarks.onRemoved.removeListener(handleBookmarkChange);
        chrome.bookmarks.onChanged.removeListener(handleBookmarkChange);
        chrome.bookmarks.onMoved.removeListener(handleBookmarkChange);
        chrome.bookmarks.onChildrenReordered.removeListener(
            handleBookmarkChange,
        );
        chrome.bookmarks.onImportEnded.removeListener(handleBookmarkChange);
    };

    window.addEventListener("pagehide", cleanup, { once: true });

    return cleanup;
}
