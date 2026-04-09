import type { RequestRender } from "../types.js";

export function setupEventListeners(requestRender: RequestRender): () => void {
    const handleTabChange = () => requestRender();
    const handleTabGroupChange = () => requestRender();
    const handleBookmarkChange = () => requestRender();

    chrome.tabs.onCreated.addListener(handleTabChange);
    chrome.tabs.onRemoved.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);
    chrome.tabs.onMoved.addListener(handleTabChange);
    chrome.tabs.onAttached.addListener(handleTabChange);
    chrome.tabs.onDetached.addListener(handleTabChange);
    chrome.tabs.onActivated.addListener(handleTabChange);
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
        chrome.tabs.onCreated.removeListener(handleTabChange);
        chrome.tabs.onRemoved.removeListener(handleTabChange);
        chrome.tabs.onUpdated.removeListener(handleTabChange);
        chrome.tabs.onMoved.removeListener(handleTabChange);
        chrome.tabs.onAttached.removeListener(handleTabChange);
        chrome.tabs.onDetached.removeListener(handleTabChange);
        chrome.tabs.onActivated.removeListener(handleTabChange);
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

    window.addEventListener("unload", cleanup);

    return cleanup;
}
