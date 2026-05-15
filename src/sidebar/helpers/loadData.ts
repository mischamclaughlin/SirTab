import { loadLogicalTabGroupData } from "../../shared/groupOrder.js";

export async function loadTabAndGroupData(windowId: number) {
    const { tabs, groups } = await loadLogicalTabGroupData(windowId);

    return [tabs, groups] as const;
}

export async function loadBookmarkTree() {
    return await chrome.bookmarks.getTree();
}
