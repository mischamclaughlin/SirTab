import { sortTabsByIndex } from "../../shared/groupOrder.js";

export async function loadAllData() {
    const [tabs, groups, tree] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
        chrome.bookmarks.getTree(),
    ]);

    return [sortTabsByIndex(tabs), groups, tree] as const;
}
