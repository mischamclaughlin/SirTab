import { sortTabsByIndex } from "../../shared/groupOrder.js";

export async function loadTabAndGroupData(windowId: number) {
    const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId }),
    ]);

    return [sortTabsByIndex(tabs), groups] as const;
}

export async function loadBookmarkTree() {
    return await chrome.bookmarks.getTree();
}
