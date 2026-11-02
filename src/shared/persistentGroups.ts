/** Sidebar groups outlive Chrome's native groups, which require at least one tab. */
export const PERSISTENT_GROUPS_WINDOW_PREFIX = "persistentGroups:";

type SavedGroup = chrome.tabGroups.TabGroup & { nativeId: number | null; members: string[]; sessionId?: string };
const colours = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);
let pending: Promise<unknown> = Promise.resolve();

// Shared across the worker and all sidebars, including native-group recreation.
function serialise<T>(action: () => Promise<T>): Promise<T> {
    const run = () => typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("sirtab-persistent-groups", action) : action();
    const result = pending.then(run, run);
    pending = result.catch(() => {});
    return result;
}

async function getSessionId(): Promise<string | undefined> {
    if (!chrome.storage.session) return undefined;
    const key = "persistentGroupsSession";
    const stored = (await chrome.storage.session.get(key))[key];
    if (typeof stored === "string") return stored;
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ [key]: id });
    return id;
}

async function readGroups(windowId: number): Promise<SavedGroup[]> {
    const key = `${PERSISTENT_GROUPS_WINDOW_PREFIX}${windowId}`;
    const raw: unknown = (await chrome.storage.local.get(key))[key];
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>();
    return raw.filter((value): value is SavedGroup => {
        if (typeof value !== "object" || value == null) return false;
        const group = value as SavedGroup;
        if (!Number.isSafeInteger(group.id) || group.id === -1 || seen.has(group.id) ||
            group.windowId !== windowId || typeof group.title !== "string" ||
            !colours.has(group.color) || typeof group.collapsed !== "boolean" ||
            !(group.nativeId === null || (Number.isSafeInteger(group.nativeId) && group.nativeId >= 0)) ||
            !Array.isArray(group.members) || !group.members.every((member) => typeof member === "string")) return false;
        seen.add(group.id);
        return true;
    });
}

async function writeGroups(windowId: number, groups: SavedGroup[]) {
    await chrome.storage.local.set({ [`${PERSISTENT_GROUPS_WINDOW_PREFIX}${windowId}`]: groups });
}

function publicGroup({ nativeId: _nativeId, members: _members, sessionId: _sessionId, ...group }: SavedGroup): chrome.tabGroups.TabGroup {
    return group;
}

function newId(groups: SavedGroup[]) {
    let id = -Math.floor(Date.now() * 1000 + Math.random() * 1000) - 2;
    while (groups.some((group) => group.id === id)) id--;
    return id;
}

async function fingerprints(tabs: chrome.tabs.Tab[]) {
    return (await Promise.all(tabs.map(async (tab) => {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tab.url || tab.pendingUrl || ""));
        return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }))).sort();
}

function sameLabel(left: chrome.tabGroups.TabGroup, right: chrome.tabGroups.TabGroup) {
    return (left.title ?? "") === (right.title ?? "") && left.color === right.color;
}
function sameMembers(left: string[], right: string[]) {
    return left.length > 0 && JSON.stringify(left) === JSON.stringify(right);
}

async function reconcile(windowId: number) {
    const [tabs, nativeGroups, saved] = await Promise.all([
        chrome.tabs.query({ windowId }), chrome.tabGroups.query({ windowId }), readGroups(windowId),
    ]);
    const sessionId = await getSessionId();
    const before = JSON.stringify(saved);
    const liveIds = new Set(nativeGroups.map((group) => group.id));
    const assigned = new Set<number>();
    const logicalIdByNativeId = new Map<number, number>();
    for (const native of nativeGroups) {
        const members = await fingerprints(tabs.filter((tab) => tab.groupId === native.id));
        let record = saved.find((group) => group.nativeId === native.id);
        if (!record) {
            // Match changed browser IDs by member fingerprints, then a unique label.
            const candidates = saved.filter((group) =>
                (group.nativeId != null || (group.members.length > 0 && (sessionId == null || group.sessionId !== sessionId))) &&
                (group.nativeId == null || !liveIds.has(group.nativeId)) && !assigned.has(group.id) && sameLabel(group, native));
            const exact = candidates.filter((group) => sameMembers(group.members, members));
            if (exact.length > 0) record = exact[0];
            else if (candidates.length === 1 && candidates[0].nativeId != null && nativeGroups.filter((group) => sameLabel(group, native)).length === 1) record = candidates[0];
        }
        if (!record) {
            const id = saved.some((group) => group.id === native.id) ? newId(saved) : native.id;
            record = { ...native, collapsed: native.collapsed ?? false, shared: native.shared ?? false, title: native.title ?? "", id, nativeId: native.id, members, sessionId };
            saved.push(record);
        } else {
            Object.assign(record, native, { id: record.id, title: native.title ?? "", nativeId: native.id, members, sessionId });
        }
        assigned.add(record.id);
        logicalIdByNativeId.set(native.id, record.id);
    }
    // Transfer a moved native group rather than leaving an empty duplicate.
    for (let index = saved.length - 1; index >= 0; index--) {
        const group = saved[index];
        if (group.nativeId == null || liveIds.has(group.nativeId)) continue;
        let native: chrome.tabGroups.TabGroup | undefined;
        if (chrome.tabGroups.get) {
            try { native = await chrome.tabGroups.get(group.nativeId); }
            catch { /* Its last tab left; the saved group remains. */ }
        }
        if (native && native.windowId !== windowId) {
            const destination = await readGroups(native.windowId);
            const next = destination.filter((other) => other.nativeId !== group.nativeId);
            if (next.some((other) => other.id === group.id)) group.id = newId(next);
            next.push({ ...group, windowId: native.windowId });
            await writeGroups(native.windowId, next);
            saved.splice(index, 1);
        } else if (!native) {
            group.nativeId = null;
        }
    }
    if (JSON.stringify(saved) !== before) await writeGroups(windowId, saved);
    return {
        tabs: tabs.map((tab) => ({ ...tab, groupId: logicalIdByNativeId.get(tab.groupId) ?? tab.groupId })),
        groups: saved.map(publicGroup),
    };
}

export function reconcilePersistentGroups(windowId: number) {
    return serialise(() => reconcile(windowId));
}

export function createPersistentGroup(windowId: number, title: string, color: chrome.tabGroups.TabGroup["color"]) {
    return serialise(async () => {
        const groups = await readGroups(windowId);
        const sessionId = await getSessionId();
        const group: SavedGroup = { sessionId, id: newId(groups), windowId, title, color, collapsed: false, shared: false, nativeId: null, members: [] };
        groups.push(group);
        await writeGroups(windowId, groups);
        return publicGroup(group);
    });
}

export function updatePersistentGroup(groupId: number, windowId: number, changes: chrome.tabGroups.UpdateProperties) {
    return serialise(async () => {
        const groups = await readGroups(windowId);
        const group = groups.find((group) => group.id === groupId);
        if (!group) {
            if (groupId < 0) throw new Error("Group no longer exists");
            await chrome.tabGroups.update(groupId, changes);
            return;
        }
        if (group.nativeId != null) {
            const live = await chrome.tabGroups.query({ windowId });
            if (live.some((native) => native.id === group.nativeId)) await chrome.tabGroups.update(group.nativeId, changes);
        }
        Object.assign(group, changes);
        await writeGroups(windowId, groups);
    });
}

export function removePersistentGroup(groupId: number, windowId: number) {
    return serialise(async () => {
        const groups = await readGroups(windowId);
        const next = groups.filter((group) => group.id !== groupId);
        if (next.length !== groups.length) await writeGroups(windowId, next);
    });
}

export function groupTabsPersistently(tabIds: number[], groupId: number, windowId: number) {
    return serialise(async () => {
        if (tabIds.length === 0) return;
        const ids = tabIds as [number, ...number[]];
        const groups = await readGroups(windowId);
        const group = groups.find((group) => group.id === groupId);
        if (!group) {
            if (groupId < 0) throw new Error("Group no longer exists");
            await chrome.tabs.group({ groupId, tabIds: ids });
            return;
        }
        const live = await chrome.tabGroups.query({ windowId });
        const exists = group.nativeId != null && live.some((native) => native.id === group.nativeId);
        if (exists) {
            await chrome.tabs.group({ groupId: group.nativeId!, tabIds: ids });
            return;
        }
        const originalTabs = (await chrome.tabs.query({ windowId })).filter((tab) => tab.id != null && tabIds.includes(tab.id));
        const previousNativeId = group.nativeId;
        const nativeId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
        try {
            // Hold the cross-context lock until both metadata and mapping are
            // saved; worker events cannot adopt this native group in between.
            await chrome.tabGroups.update(nativeId, { title: group.title, color: group.color, collapsed: false });
            group.nativeId = nativeId;
            await writeGroups(windowId, groups);
        } catch (error) {
            group.nativeId = previousNativeId;
            // Restore source membership too: moving the final tab can destroy
            // its original native group, so simply ungrouping is insufficient.
            try {
                const originalIds = new Map<number, number[]>();
                for (const tab of originalTabs) {
                    const sourceId = tab.groupId ?? -1;
                    const members = originalIds.get(sourceId) ?? [];
                    members.push(tab.id!);
                    originalIds.set(sourceId, members);
                }
                for (const [sourceId, members] of originalIds) {
                    const restoreIds = members as [number, ...number[]];
                    if (sourceId === -1) {
                        await chrome.tabs.ungroup(restoreIds);
                        continue;
                    }
                    const current = await chrome.tabGroups.query({ windowId });
                    if (current.some((native) => native.id === sourceId)) {
                        await chrome.tabs.group({ groupId: sourceId, tabIds: restoreIds });
                    } else {
                        const source = live.find((native) => native.id === sourceId);
                        const restoredId = await chrome.tabs.group({ tabIds: restoreIds, createProperties: { windowId } });
                        if (source) await chrome.tabGroups.update(restoredId, { title: source.title, color: source.color, collapsed: source.collapsed });
                        const savedSource = groups.find((saved) => saved.nativeId === sourceId);
                        if (savedSource) savedSource.nativeId = restoredId;
                    }
                }
                await writeGroups(windowId, groups);
            } catch (cleanupError) {
                console.error("Failed to restore tabs after group creation failed:", cleanupError);
            }
            throw error;
        }
    });
}

/** The order layer has identified one unambiguous restored window. */
export function restorePersistentGroups(fromWindowId: number, toWindowId: number) {
    return serialise(async () => {
        if (fromWindowId === toWindowId) return false;
        const previous = await readGroups(fromWindowId);
        if (previous.length === 0) return false;
        const current = await readGroups(toWindowId);
        const restored: SavedGroup[] = [];
        for (const group of previous) {
            const candidates = current.filter((candidate) => sameLabel(candidate, group));
            const exact = candidates.filter((candidate) => sameMembers(candidate.members, group.members));
            const match = exact.length > 0 ? exact[0] :
                candidates.length === 1 && previous.filter((other) => sameLabel(other, group)).length === 1 ? candidates[0] : undefined;
            if (match) current.splice(current.indexOf(match), 1);
            restored.push({ ...group, windowId: toWindowId, nativeId: match?.nativeId ?? null, members: match?.members ?? group.members });
        }
        for (const group of current) {
            if (restored.some((other) => other.id === group.id)) group.id = newId([...restored, ...current]);
            restored.push(group);
        }
        await chrome.storage.local.set({
            [`${PERSISTENT_GROUPS_WINDOW_PREFIX}${toWindowId}`]: restored,
            [`${PERSISTENT_GROUPS_WINDOW_PREFIX}${fromWindowId}`]: [],
        });
        return true;
    });
}

/** Install saved logical identities after native groups have been restored. */
export function installRestoredGroups(
    windowId: number,
    groups: Array<Pick<chrome.tabGroups.TabGroup, "id" | "title" | "color" | "collapsed"> & { nativeId: number | null }>,
) {
    return serialise(async () => {
        const sessionId = await getSessionId();
        const tabs = await chrome.tabs.query({ windowId });
        const saved: SavedGroup[] = await Promise.all(groups.map(async (group) => ({
            ...group, title: group.title ?? "", shared: false, windowId, sessionId,
            members: await fingerprints(tabs.filter((tab) => tab.groupId === group.nativeId)),
        })));
        await writeGroups(windowId, saved);
    });
}
