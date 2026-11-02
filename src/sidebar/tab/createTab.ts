import { groupTabsPersistently } from "../../shared/persistentGroups.js";

export function createNewTab(windowId?: number) {
    return chrome.tabs.create({
        url: "chrome://newtab",
        active: false,
        ...(windowId == null ? {} : { windowId }),
    });
}

export async function createNewTabInGroup(groupId: number, windowId: number) {
    const tab = await createNewTab(windowId);
    if (tab.id == null) throw new Error("New tab has no ID");

    try {
        await groupTabsPersistently([tab.id], groupId, windowId);
    } catch (error) {
        try {
            await chrome.tabs.remove(tab.id);
        } catch (cleanupError) {
            console.error("Failed to close ungrouped new tab:", cleanupError);
        }
        throw error;
    }
}
