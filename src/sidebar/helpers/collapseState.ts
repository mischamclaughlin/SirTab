import type { ToggleType } from "../types.js";
import {
    COLLAPSED_GROUPS_STORAGE_KEY,
    COLLAPSED_GROUPS_WINDOW_PREFIX,
    COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY,
} from "../config.js";

export async function toggleInList(
    list: Set<string>,
    id: string,
    type: ToggleType,
) {
    list.has(id) ? list.delete(id) : list.add(id);

    await persistCollapse(list, type);
}

async function getCurrentWindowId() {
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
        return await chrome.storage.local.set({
            [`${COLLAPSED_GROUPS_WINDOW_PREFIX}${windowId}`]: Array.from(list),
        });
    }

    return await chrome.storage.local.set({ [key]: Array.from(list) });
}

export async function loadCollapse(
    list: Set<string>,
    type: ToggleType,
): Promise<void> {
    const key =
        type === "tab"
            ? COLLAPSED_GROUPS_STORAGE_KEY
            : COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY;
    list.clear();

    if (type === "tab") {
        const windowId = await getCurrentWindowId();
        if (windowId === null) return;

        const windowKey = `${COLLAPSED_GROUPS_WINDOW_PREFIX}${windowId}`;
        const storage = await chrome.storage.local.get([windowKey, key]);
        const ownWindowIds = storage[windowKey];
        const rawByWindow = storage[key];
        const byWindow: Record<string, unknown> =
            typeof rawByWindow === "object" && rawByWindow != null
                ? (rawByWindow as Record<string, unknown>)
                : {};
        const storedIds = Array.isArray(ownWindowIds)
            ? ownWindowIds
            : byWindow[String(windowId)];
        if (!Array.isArray(storedIds)) return;

        for (const id of storedIds) {
            if (typeof id === "string" || typeof id === "number") {
                list.add(String(id));
            }
        }

        return;
    }

    const storage = await chrome.storage.local.get(key);
    const storedIds = storage[key];
    if (!Array.isArray(storedIds)) return;

    for (const id of storedIds) {
        if (typeof id === "string" || typeof id === "number") {
            list.add(String(id));
        }
    }
}

export function isCollapsedCheck(id: string | number, list: Set<string>) {
    return list.has(String(id));
}
