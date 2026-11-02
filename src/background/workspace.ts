import { loadLogicalTabGroupData, loadCollapsedGroupIds, persistRestoredWindowOrder } from "../shared/groupOrder.js";
import { installRestoredGroups, PERSISTENT_GROUPS_WINDOW_PREFIX } from "../shared/persistentGroups.js";
import { COLLAPSED_GROUPS_WINDOW_PREFIX, GROUP_ORDER_WINDOW_PREFIX, TAB_ORDER_WINDOW_PREFIX, GROUP_ORDER_SNAPSHOT_PREFIX, TAB_ORDER_SNAPSHOT_PREFIX } from "../shared/storageKeys.js";

export const WORKSPACE_SNAPSHOT_PREFIX = "workspaceSnapshot:";
const JOURNAL_KEY = "workspaceRecoveryJournal";
const SESSION_KEY = "workspaceSession";
const CLOSED_KEY = "workspaceClosedWindows";
const READY_KEY = "workspaceRecoveryComplete";
const REOPEN_KEY = "workspaceNeedsRecovery";

type SavedTab = Pick<chrome.tabs.Tab, "id" | "title" | "pinned" | "active" | "groupId"> & { id: number; url: string };
type SavedGroup = Pick<chrome.tabGroups.TabGroup, "id" | "title" | "color" | "collapsed">;
export type WorkspaceSnapshot = {
    version: 1;
    windowId: number;
    sessionId: string;
    updatedAt: number;
    closedAt?: number;
    tabs: SavedTab[];
    groups: SavedGroup[];
    deletedGroupIds?: number[];
};
type RecoveryJournal = { sessionId: string; snapshots: WorkspaceSnapshot[]; windows: Record<string, number>; tabs: Record<string, Record<string, number>>; placeholders: Record<string, number[]> };

// These addresses execute browser commands rather than opening documents.
const browserCommands = new Set([
    "quit", "restart", "crash", "crashdump", "badcastcrash", "checkcrash", "heapcorruptioncrash",
    "inducebrowsercrashforrealz", "inducebrowserdcheckforrealz", "inducebrowserheapcorruption",
    "hang", "shorthang", "uithreadhang", "delayeduithreadhang", "kill", "gpuclean", "gpucrash", "gpuhang",
    "memory-exhaust", "memory-pressure-critical", "memory-pressure-moderate", "blink-oom", "v8-oom", "gpu-java-crash",
]);
function isBrowserCommand(url: string) {
    try {
        const parsed = new URL(url);
        return ["chrome:", "brave:", "edge:", "about:"].includes(parsed.protocol) &&
            browserCommands.has(decodeURIComponent(parsed.hostname || parsed.pathname.split("/")[0]).toLowerCase());
    } catch { return false; }
}

function restorableUrl(url: string) {
    if (url.startsWith(chrome.runtime.getURL("")) || isBrowserCommand(url)) return false;
    try {
        return ["http:", "https:", "file:", "ftp:", "chrome:", "brave:", "edge:", "about:", "chrome-extension:"].includes(new URL(url).protocol);
    } catch { return false; }
}

function readSnapshot(value: unknown): WorkspaceSnapshot | null {
    if (typeof value !== "object" || value == null) return null;
    const record = value as WorkspaceSnapshot;
    if (record.version !== 1 || !Number.isInteger(record.windowId) || typeof record.sessionId !== "string" ||
        !Number.isFinite(record.updatedAt) || !Array.isArray(record.tabs) || !Array.isArray(record.groups)) return null;
    if (record.deletedGroupIds != null && (!Array.isArray(record.deletedGroupIds) || !record.deletedGroupIds.every(Number.isSafeInteger))) return null;
    if (record.closedAt != null && !Number.isFinite(record.closedAt)) return null;
    if (!record.tabs.every((tab) => tab && Number.isSafeInteger(tab.id) && tab.id >= 0 &&
        typeof tab.url === "string" && restorableUrl(tab.url) && typeof tab.pinned === "boolean" &&
        typeof tab.active === "boolean" && Number.isSafeInteger(tab.groupId))) return null;
    const colours = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);
    if (!record.groups.every((group) => group && Number.isSafeInteger(group.id) && group.id !== -1 &&
        typeof group.title === "string" && colours.has(group.color) && typeof group.collapsed === "boolean")) return null;
    const tabIds = new Set(record.tabs.map((tab) => tab.id));
    const groupIds = new Set(record.groups.map((group) => group.id));
    if (tabIds.size !== record.tabs.length || groupIds.size !== record.groups.length ||
        record.tabs.some((tab) => tab.groupId !== -1 && !groupIds.has(tab.groupId!))) return null;
    return record;
}

function mergeDurableLayout(snapshot: WorkspaceSnapshot, storage: Record<string, unknown>): WorkspaceSnapshot {
    const rawGroups = storage[`${PERSISTENT_GROUPS_WINDOW_PREFIX}${snapshot.windowId}`];
    const nativeToLogical = new Map<number, number>();
    let groups = snapshot.groups;
    if (Array.isArray(rawGroups) && rawGroups.every((group) => group && Number.isSafeInteger(group.id) && typeof group.color === "string")) {
        groups = rawGroups.map((group) => {
            if (typeof group.nativeId === "number") nativeToLogical.set(group.nativeId, group.id);
            return { id: group.id, title: group.title ?? "", color: group.color, collapsed: snapshot.groups.find((saved) => saved.id === group.id)?.collapsed ?? false };
        });
        const knownIds = new Set(groups.map((group) => group.id));
        groups.push(...snapshot.groups.filter((group) => !knownIds.has(group.id) && !snapshot.deletedGroupIds?.includes(group.id)));
    }
    const groupIds = new Set(groups.map((group) => group.id));
    const tabs = snapshot.tabs.map((tab) => {
        const groupId = tab.groupId ?? -1;
        return { ...tab, groupId: groupIds.has(groupId) ? groupId : nativeToLogical.get(groupId) ?? -1 };
    });
    function order<T extends { id: number }>(items: T[], prefix: string) {
        const raw = storage[`${prefix}${snapshot.windowId}`] as { order?: unknown } | undefined;
        const ids = Array.isArray(raw?.order) ? raw.order : [];
        const ranks = new Map(ids.map((id, index) => [id, index]));
        return [...items].sort((left, right) => (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity));
    }
    const collapsed = storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}${snapshot.windowId}`];
    if (Array.isArray(collapsed)) groups = groups.map((group) => ({ ...group, collapsed: collapsed.some((id) => String(id) === String(group.id)) }));
    return { ...snapshot, tabs: order(tabs, TAB_ORDER_SNAPSHOT_PREFIX), groups: order(groups, GROUP_ORDER_SNAPSHOT_PREFIX) };
}

function urlOf(tab: chrome.tabs.Tab) {
    if (tab.pendingUrl && isBrowserCommand(tab.pendingUrl) && tab.url && !isBrowserCommand(tab.url)) return tab.url;
    return tab.pendingUrl || tab.url || "";
}
function placeholder(tab: chrome.tabs.Tab) {
    return ["chrome://newtab/", "chrome://newtab", "brave://newtab/", "edge://newtab/", "about:blank"].includes(urlOf(tab));
}
function normal(window: chrome.windows.Window) { return window.id != null && !window.incognito && window.type === "normal"; }
function savedKey(windowId: number) { return `${WORKSPACE_SNAPSHOT_PREFIX}${windowId}`; }

/** Recovery and capture run in the worker; closing windows invalidate in-flight captures. */
export function setupWorkspacePersistence() {
    let pending: Promise<unknown> = Promise.resolve();
    let recovering = true;
    let disposed = false;
    let sessionId = "";
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryRetries = 0;
    const closing = new Set<number>();
    const normalWindows = new Set<number>();
    const knownTabs = new Map<number, chrome.tabs.Tab>();
    const knownGroups = new Map<number, chrome.tabGroups.TabGroup>();
    const closedDuringRecovery = new Map<number, chrome.tabs.Tab>();
    const internalRemovals = new Set<number>();
    const revisions = new Map<number, number>();
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const disposers: Array<() => void> = [];

    function enqueue<T>(action: () => Promise<T>): Promise<T> {
        const result = pending.then(action, action);
        pending = result.catch((error) => console.error("Workspace persistence failed:", error));
        return result;
    }
    function invalidate(windowId: number) {
        revisions.set(windowId, (revisions.get(windowId) ?? 0) + 1);
        const timer = timers.get(windowId);
        if (timer != null) clearTimeout(timer);
        timers.delete(windowId);
    }
    async function capture(windowId: number) {
        if (recovering || disposed || closing.has(windowId)) return;
        const revision = revisions.get(windowId) ?? 0;
        const windows = await chrome.windows.getAll({ populate: false, windowTypes: ["normal"] });
        if (!windows.some((window) => window.id === windowId && normal(window))) return;
        const data = await loadLogicalTabGroupData(windowId);
        const tabs: SavedTab[] = data.tabs.flatMap((tab) => {
            const url = urlOf(tab);
            return tab.id == null || tab.incognito || !restorableUrl(url) ? [] : [{
                id: tab.id, url, title: tab.title ?? "", pinned: !!tab.pinned, active: !!tab.active, groupId: tab.groupId ?? -1,
            }];
        });
        // Shutdown can remove the native inventory before onRemoved is delivered.
        // An empty native inventory must never erase its last good snapshot.
        if (data.tabs.length === 0) return;
        const collapsed = await loadCollapsedGroupIds(windowId);
        const record: WorkspaceSnapshot = {
            version: 1, windowId, sessionId, updatedAt: Date.now(), tabs,
            groups: data.groups.map((group) => ({ id: group.id, title: group.title ?? "", color: group.color, collapsed: collapsed.has(String(group.id)) })),
        };
        if (recovering || disposed || closing.has(windowId) || revision !== (revisions.get(windowId) ?? 0)) return;
        await chrome.storage.local.set({ [savedKey(windowId)]: record });
    }
    function schedule(windowId: number) {
        if (recovering || disposed || closing.has(windowId)) return;
        invalidate(windowId);
        timers.set(windowId, setTimeout(() => {
            timers.delete(windowId);
            void enqueue(() => capture(windowId)).catch(() => {});
        }, 120));
    }
    async function currentWindows() {
        const windows = (await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })).filter(normal);
        for (const window of windows) {
            normalWindows.add(window.id!);
            for (const tab of window.tabs ?? []) if (tab.id != null) knownTabs.set(tab.id, tab);
        }
        return windows;
    }
    async function patchGroupMetadata(group: chrome.tabGroups.TabGroup) {
        const key = savedKey(group.windowId);
        const storage = await chrome.storage.local.get(null);
        const snapshot = readSnapshot(storage[key]);
        if (!snapshot) return;
        const raw = storage[`${PERSISTENT_GROUPS_WINDOW_PREFIX}${group.windowId}`];
        const id = Array.isArray(raw) ? raw.find((saved) => saved.nativeId === group.id)?.id ?? group.id : group.id;
        const existing = snapshot.groups.find((saved) => saved.id === id);
        const metadata: SavedGroup = { id, title: group.title ?? "", color: group.color, collapsed: existing?.collapsed ?? false };
        const position = snapshot.groups.findIndex((saved) => saved.id === id || saved.id === group.id);
        snapshot.groups = snapshot.groups.filter((saved) => saved.id !== id && (id === group.id || saved.id !== group.id));
        snapshot.groups.splice(position < 0 ? snapshot.groups.length : position, 0, metadata);
        await chrome.storage.local.set({ [key]: { ...snapshot, updatedAt: Date.now() } });
    }
    async function markDeletedGroups(windowId: number, ids: number[]) {
        const key = savedKey(windowId);
        const snapshot = readSnapshot((await chrome.storage.local.get(key))[key]);
        if (!snapshot) return;
        snapshot.deletedGroupIds = [...new Set([...(snapshot.deletedGroupIds ?? []), ...ids])];
        snapshot.groups = snapshot.groups.filter((group) => !ids.includes(group.id));
        snapshot.tabs = snapshot.tabs.map((tab) => ids.includes(tab.groupId ?? -1) ? { ...tab, groupId: -1 } : tab);
        await chrome.storage.local.set({ [key]: { ...snapshot, updatedAt: Date.now() } });
    }
    async function patchLayout(windowId: number) {
        const storage = await chrome.storage.local.get(null);
        const snapshot = readSnapshot(storage[savedKey(windowId)]);
        if (!snapshot || snapshot.sessionId !== sessionId) return;
        const merged = mergeDurableLayout(snapshot, storage);
        if (JSON.stringify(merged) !== JSON.stringify(snapshot)) await chrome.storage.local.set({ [savedKey(windowId)]: { ...merged, updatedAt: Date.now() } });
    }
    async function forgetTab(windowId: number, tabId: number) {
        const key = savedKey(windowId);
        const snapshot = readSnapshot((await chrome.storage.local.get(key))[key]);
        if (snapshot) await chrome.storage.local.set({ [key]: { ...snapshot, tabs: snapshot.tabs.filter((tab) => tab.id !== tabId), updatedAt: Date.now() } });
    }
    async function patchTab(tab: chrome.tabs.Tab) {
        if (tab.id == null || tab.incognito) return;
        const key = savedKey(tab.windowId);
        const storage = await chrome.storage.local.get(null);
        const record = readSnapshot(storage[key]) ?? { version: 1 as const, windowId: tab.windowId, sessionId, updatedAt: Date.now(), tabs: [], groups: [] };
        const snapshot = mergeDurableLayout(record, storage);
        const url = urlOf(tab);
        const previous = snapshot.tabs.findIndex((saved) => saved.id === tab.id);
        if (!restorableUrl(url)) {
            if (isBrowserCommand(url) || previous < 0) return;
            snapshot.tabs.splice(previous, 1);
        } else {
            const rawGroups = storage[`${PERSISTENT_GROUPS_WINDOW_PREFIX}${tab.windowId}`];
            const mapping = Array.isArray(rawGroups) ? rawGroups.find((group) => group.nativeId === tab.groupId) : undefined;
            const groupId = mapping?.id ?? tab.groupId ?? -1;
            if (groupId !== -1 && !snapshot.groups.some((group) => group.id === groupId)) {
                const metadata = knownGroups.get(tab.groupId);
                snapshot.groups.push({ id: groupId, title: metadata?.title ?? "", color: metadata?.color ?? "grey", collapsed: false });
            }
            const saved: SavedTab = { id: tab.id, url, title: tab.title ?? "", pinned: !!tab.pinned, active: !!tab.active, groupId };
            if (previous < 0) snapshot.tabs.push(saved); else snapshot.tabs[previous] = saved;
        }
        await chrome.storage.local.set({ [key]: { ...snapshot, sessionId, updatedAt: Date.now() } });
    }
    async function settleStartup() {
        let previous = "";
        let stable = 0;
        for (let attempt = 0; attempt < 20; attempt++) {
            const windows = await currentWindows();
            const identity = JSON.stringify(windows.map((window) => [window.id, window.tabs?.map((tab) => [tab.id, urlOf(tab), tab.groupId])]));
            if (identity === previous) stable++; else stable = 0;
            if (stable >= 2) return;
            previous = identity;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    async function recoverWindow(snapshot: WorkspaceSnapshot, windowId: number, writeJournal: () => Promise<void>, restoredIds: Record<string, number>, placeholderIds: number[]) {
        const live = await chrome.tabs.query({ windowId });
        const nativeGroups = await chrome.tabGroups.query({ windowId });
        for (const tab of live) if (tab.id != null) knownTabs.set(tab.id, tab);
        for (const group of nativeGroups) knownGroups.set(group.id, group);
        const available = [...live];
        if (live.length > 0 && live.every(placeholder) && placeholderIds.length === 0) {
            placeholderIds.push(...live.flatMap((tab) => tab.id == null ? [] : [tab.id]));
            await writeJournal();
        }
        const restored: Array<{ saved: SavedTab; tab: chrome.tabs.Tab & { id: number } }> = [];
        for (const [id, closed] of closedDuringRecovery) {
            if (closed.windowId !== windowId) continue;
            const candidates = snapshot.tabs.filter((tab) => tab.url === urlOf(closed));
            const nativeGroup = knownGroups.get(closed.groupId);
            const saved = snapshot.tabs.find((tab) => restoredIds[String(tab.id)] === id) ?? candidates.find((tab) => {
                const group = snapshot.groups.find((group) => group.id === tab.groupId);
                return closed.groupId === -1 ? tab.groupId === -1 : group && nativeGroup && group.title === nativeGroup.title && group.color === nativeGroup.color;
            }) ?? candidates[0];
            if (saved) snapshot.tabs = snapshot.tabs.filter((tab) => tab.id !== saved.id);
            closedDuringRecovery.delete(id);
        }
        for (const saved of [...snapshot.tabs]) {
            const group = snapshot.groups.find((group) => group.id === saved.groupId);
            const candidates = available.filter((tab) => urlOf(tab) === saved.url);
            const preferred = available.find((tab) => tab.id === restoredIds[String(saved.id)]) ?? candidates.find((tab) => group
                ? nativeGroups.some((native) => native.id === tab.groupId && native.title === group.title && native.color === group.color)
                : tab.groupId === -1) ?? candidates[0];
            const tab = preferred ?? await chrome.tabs.create({ windowId, url: saved.url, active: false, pinned: !!saved.pinned });
            if (tab.id != null && closedDuringRecovery.has(tab.id)) {
                snapshot.tabs = snapshot.tabs.filter((item) => item.id !== saved.id);
                closedDuringRecovery.delete(tab.id);
                await writeJournal();
                continue;
            }
            if (tab.id == null) throw new Error("Restored tab has no ID");
            if (preferred) available.splice(available.indexOf(preferred), 1);
            if (!!tab.pinned !== !!saved.pinned) await chrome.tabs.update(tab.id, { pinned: !!saved.pinned });
            restored.push({ saved, tab: tab as chrome.tabs.Tab & { id: number } });
            restoredIds[String(saved.id)] = tab.id;
            knownTabs.set(tab.id, tab);
            // Window association is already durable. If the worker stops here,
            // the next attempt matches created tabs by URL, including duplicates.
            await writeJournal();
        }
        for (let index = restored.length - 1; index >= 0; index--) {
            const pair = restored[index];
            if (closedDuringRecovery.has(pair.tab.id)) {
                snapshot.tabs = snapshot.tabs.filter((saved) => saved.id !== pair.saved.id);
                restored.splice(index, 1);
                closedDuringRecovery.delete(pair.tab.id);
            }
        }
        await writeJournal();
        const ungrouped = restored.filter(({ saved }) => saved.groupId === -1).map(({ tab }) => tab.id);
        if (ungrouped.length > 0) await chrome.tabs.ungroup(ungrouped as [number, ...number[]]);
        const groupRecords: Array<SavedGroup & { nativeId: number | null }> = [];
        const usedNativeIds = new Set<number>();
        for (const saved of snapshot.groups) {
            const tabIds = restored.filter(({ saved: tab }) => tab.groupId === saved.id).map(({ tab }) => tab.id);
            let nativeId: number | null = null;
            if (tabIds.length > 0) {
                const current = await chrome.tabs.get(tabIds[0]);
                const reusable = current.groupId !== -1 && !usedNativeIds.has(current.groupId) && nativeGroups.some((native) => native.id === current.groupId);
                nativeId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], ...(reusable ? { groupId: current.groupId } : { createProperties: { windowId } }) });
                usedNativeIds.add(nativeId);
                await chrome.tabGroups.update(nativeId, { title: saved.title, color: saved.color, collapsed: false });
            }
            groupRecords.push({ ...saved, nativeId });
        }
        if (restored.length > 0 && placeholderIds.length > 0) {
            const spare = available.filter((tab) => tab.id != null && placeholderIds.includes(tab.id) && placeholder(tab)).flatMap((tab) => tab.id == null ? [] : [tab.id]);
            if (spare.length > 0) {
                for (const id of spare) internalRemovals.add(id);
                await chrome.tabs.remove(spare);
            }
        }
        await installRestoredGroups(windowId, groupRecords);
        await chrome.storage.local.set({ [`${COLLAPSED_GROUPS_WINDOW_PREFIX}${windowId}`]: snapshot.groups.filter((group) => group.collapsed).map((group) => String(group.id)) });
        await persistRestoredWindowOrder(windowId, restored.map(({ tab }) => tab.id), snapshot.groups.map((group) => group.id));
        const active = restored.find(({ saved }) => saved.active);
        if (active) await chrome.tabs.update(active.tab.id, { active: true });
        const record: WorkspaceSnapshot = {
            ...snapshot, windowId, sessionId, updatedAt: Date.now(),
            tabs: restored.map(({ saved, tab }) => ({ ...saved, id: tab.id })),
        };
        delete record.closedAt;
        await chrome.storage.local.set({ [savedKey(windowId)]: record });
    }
    async function restoreInternal(force = false) {
        recovering = true;
        try {
            const session = await chrome.storage.session.get([SESSION_KEY, READY_KEY]);
            sessionId = typeof session[SESSION_KEY] === "string" ? session[SESSION_KEY] : crypto.randomUUID();
            await chrome.storage.session.set({ [SESSION_KEY]: sessionId });
            if (!force && session[READY_KEY] === true) { recovering = false; return; }
            await settleStartup();
            if ((await currentWindows()).length === 0) {
                await chrome.storage.session.set({ [REOPEN_KEY]: true });
                recovering = false;
                return;
            }
            const storage = await chrome.storage.local.get(null);
            const all = Object.entries(storage).filter(([key]) => key.startsWith(WORKSPACE_SNAPSHOT_PREFIX))
                .map(([, value]) => readSnapshot(value)).filter((value): value is WorkspaceSnapshot => value != null)
                .map((snapshot) => mergeDurableLayout(snapshot, storage));
            const latest = all.reduce<WorkspaceSnapshot | undefined>((latest, snapshot) => !latest || snapshot.updatedAt > latest.updatedAt ? snapshot : latest, undefined);
            const records = latest ? all.filter((snapshot) => snapshot.sessionId === latest.sessionId) : [];
            // Keep a cohort of windows closed together, rather than reopening
            // every window deliberately closed earlier in the browsing session.
            const lastActivity = Math.max(0, ...records.map((snapshot) => Math.max(snapshot.updatedAt, snapshot.closedAt ?? 0)));
            let snapshots = records.filter((snapshot) => (snapshot.tabs.length > 0 || snapshot.groups.length > 0) && (snapshot.closedAt == null || snapshot.closedAt >= lastActivity - 10000));
            const rawJournal: unknown = storage[JOURNAL_KEY];
            const journal: RecoveryJournal = { sessionId, snapshots, windows: {}, tabs: {}, placeholders: {} };
            if (typeof rawJournal === "object" && rawJournal != null) {
                const raw = rawJournal as Partial<RecoveryJournal>;
                if (Array.isArray(raw.snapshots) && raw.snapshots.every((snapshot) => readSnapshot(snapshot) != null)) {
                    snapshots = raw.snapshots;
                    journal.snapshots = snapshots;
                }
                if (raw.sessionId === sessionId && typeof raw.windows === "object" && raw.windows != null) {
                    for (const [source, target] of Object.entries(raw.windows)) if (Number.isInteger(target)) journal.windows[source] = target;
                    if (typeof raw.placeholders === "object" && raw.placeholders != null) {
                        for (const [source, ids] of Object.entries(raw.placeholders)) if (Array.isArray(ids)) journal.placeholders[source] = ids.filter(Number.isInteger);
                    }
                    if (typeof raw.tabs === "object" && raw.tabs != null) {
                        for (const [source, ids] of Object.entries(raw.tabs)) {
                            if (typeof ids !== "object" || ids == null) continue;
                            journal.tabs[source] = Object.fromEntries(Object.entries(ids).filter(([, id]) => Number.isInteger(id)));
                        }
                    }
                }
            }
            const writeJournal = () => chrome.storage.local.set({ [JOURNAL_KEY]: journal });
            const windows = await currentWindows();
            const unused = new Set(windows.map((window) => window.id!));
            for (const snapshot of snapshots.sort((left, right) => right.tabs.length - left.tabs.length)) {
                let windowId = journal.windows[String(snapshot.windowId)];
                if (!unused.has(windowId)) {
                    let bestScore = 0;
                    let best: number | undefined;
                    for (const window of windows) {
                        if (!unused.has(window.id!)) continue;
                        const urls = (window.tabs ?? []).map(urlOf);
                        let score = 0;
                        for (const tab of snapshot.tabs) {
                            const index = urls.indexOf(tab.url);
                            if (index !== -1) { score++; urls.splice(index, 1); }
                        }
                        if (score > bestScore) { bestScore = score; best = window.id; }
                    }
                    windowId = best ?? windows.find((window) => unused.has(window.id!) && (window.tabs ?? []).every(placeholder))?.id ?? -1;
                    if (windowId === -1) {
                        const created = await chrome.windows.create({ focused: false });
                        if (created?.id == null) throw new Error("Restored window has no ID");
                        windowId = created.id;
                    }
                    journal.windows[String(snapshot.windowId)] = windowId;
                    await writeJournal();
                }
                unused.delete(windowId);
                closing.delete(windowId);
                const tabIds = journal.tabs[String(snapshot.windowId)] ??= {};
                await recoverWindow(snapshot, windowId, writeJournal, tabIds, journal.placeholders[String(snapshot.windowId)] ??= []);
                const sourceAlive = windows.some((window) => window.id === snapshot.windowId);
                if (snapshot.windowId !== windowId && !sourceAlive) {
                    await chrome.storage.local.remove([savedKey(snapshot.windowId), `${PERSISTENT_GROUPS_WINDOW_PREFIX}${snapshot.windowId}`]);
                }
            }
            const liveWindowIds = new Set((await currentWindows()).map((window) => window.id));
            const obsolete = all.filter((snapshot) => !liveWindowIds.has(snapshot.windowId)).map((snapshot) => savedKey(snapshot.windowId));
            if (obsolete.length > 0) await chrome.storage.local.remove(obsolete);
            await chrome.storage.session.set({ [READY_KEY]: true, [REOPEN_KEY]: false, [CLOSED_KEY]: [] });
            await chrome.storage.local.remove(JOURNAL_KEY);
            recovering = false;
        } catch (error) {
            // Keep capture gated after a partial failure; the durable journal
            // remains authoritative until recovery succeeds.
            recovering = true;
            throw error;
        }
    }

    function listen<Args extends unknown[]>(event: {
        addListener: (listener: (...args: Args) => void) => void;
        removeListener: (listener: (...args: Args) => void) => void;
    }, listener: (...args: Args) => void) {
        event.addListener(listener);
        disposers.push(() => event.removeListener(listener));
    }

    const tabChange = (tab: chrome.tabs.Tab) => {
        if (tab.id != null) knownTabs.set(tab.id, tab);
        if (!tab.incognito) {
            if (!recovering && normalWindows.has(tab.windowId)) void enqueue(() => patchTab(tab)).catch(() => {});
            schedule(tab.windowId);
        }
    };
    listen(chrome.tabs.onCreated, tabChange);
    listen(chrome.tabs.onUpdated, (_id, change, tab) => {
        if (["url", "pendingUrl", "title", "groupId", "pinned"].some((key) => key in change)) tabChange(tab);
    });
    if (chrome.tabs.onReplaced) {
        listen(chrome.tabs.onReplaced, (addedTabId) => {
            void chrome.tabs.get(addedTabId).then(tabChange).catch((error) => console.error("Failed to capture replaced tab:", error));
        });
    }
    listen(chrome.tabs.onActivated, ({ windowId }) => schedule(windowId));
    listen(chrome.tabs.onMoved, (_id, { windowId }) => schedule(windowId));
    listen(chrome.tabs.onAttached, (tabId, { newWindowId }) => {
        void chrome.tabs.get(tabId).then(tabChange).catch(() => {});
        schedule(newWindowId);
    });
    listen(chrome.tabs.onDetached, (tabId, { oldWindowId }) => {
        void enqueue(() => forgetTab(oldWindowId, tabId)).catch(() => {});
        schedule(oldWindowId);
    });
    listen(chrome.tabs.onRemoved, (tabId, info) => {
        invalidate(info.windowId);
        if (info.isWindowClosing) {
            closing.add(info.windowId);
            void enqueue(async () => {
                const key = savedKey(info.windowId);
                const snapshot = readSnapshot((await chrome.storage.local.get(key))[key]);
                if (snapshot && snapshot.closedAt == null) await chrome.storage.local.set({ [key]: { ...snapshot, closedAt: Date.now() } });
                await chrome.storage.session.set({ [CLOSED_KEY]: [...closing] });
            }).catch(() => {});
        } else if (!internalRemovals.has(tabId)) {
            const known = knownTabs.get(tabId);
            if (recovering && known) closedDuringRecovery.set(tabId, known);
            void enqueue(async () => {
                await forgetTab(info.windowId, tabId);
                schedule(info.windowId);
            }).catch(() => {});
        }
    });
    for (const event of [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved]) {
        listen(event, (group) => {
            knownGroups.set(group.id, group);
            if (!recovering && normalWindows.has(group.windowId)) void enqueue(() => patchGroupMetadata(group)).catch(() => {});
            schedule(group.windowId);
        });
    }
    listen(chrome.tabGroups.onRemoved, (group) => { knownGroups.set(group.id, group); schedule(group.windowId); });
    listen(chrome.storage.onChanged, (changes, area) => {
        if (area !== "local") return;
        for (const key of Object.keys(changes)) {
            for (const prefix of [TAB_ORDER_WINDOW_PREFIX, GROUP_ORDER_WINDOW_PREFIX, PERSISTENT_GROUPS_WINDOW_PREFIX, COLLAPSED_GROUPS_WINDOW_PREFIX]) {
                if (key.startsWith(prefix)) {
                    const windowId = Number(key.slice(prefix.length));
                    if (Number.isInteger(windowId)) {
                        if (!recovering) {
                            if (prefix === PERSISTENT_GROUPS_WINDOW_PREFIX) {
                                const change = changes[key];
                                if (Array.isArray(change.oldValue) && Array.isArray(change.newValue)) {
                                    const remaining = new Set(change.newValue.map((group) => group.id));
                                    const removed = change.oldValue.filter((group) => !remaining.has(group.id)).map((group) => group.id);
                                    if (removed.length > 0) void enqueue(() => markDeletedGroups(windowId, removed)).catch(() => {});
                                }
                            }
                            void enqueue(() => patchLayout(windowId)).catch(() => {});
                        }
                        schedule(windowId);
                    }
                }
            }
        }
    });
    listen(chrome.windows.onRemoved, (windowId) => {
        closing.add(windowId);
        normalWindows.delete(windowId);
        invalidate(windowId);
        void enqueue(async () => {
            if ((await currentWindows()).length === 0) await chrome.storage.session.set({ [REOPEN_KEY]: true });
        }).catch(() => {});
    });
    listen(chrome.windows.onCreated, (window) => {
        if (!normal(window)) return;
        normalWindows.add(window.id!);
        void enqueue(async () => {
            const state = await chrome.storage.session.get(REOPEN_KEY);
            if (state[REOPEN_KEY] && !recovering) await restoreInternal(true);
            schedule(window.id!);
        }).catch(() => {});
    });
    async function bootstrap() {
        const state = await chrome.storage.session.get(CLOSED_KEY);
        if (Array.isArray(state[CLOSED_KEY])) for (const id of state[CLOSED_KEY]) if (typeof id === "number") closing.add(id);
        await restoreInternal();
        for (const window of await currentWindows()) await capture(window.id!);
    }
    function retryRecovery() {
        if (disposed || retryTimer != null || recoveryRetries >= 3) return;
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void enqueue(bootstrap).catch(retryRecovery);
        }, 1000 * ++recoveryRetries);
    }
    const ready = enqueue(bootstrap);
    if (chrome.runtime.onMessage) {
        listen(chrome.runtime.onMessage, (message, _sender, sendResponse) => {
            if (message?.type !== "workspace-ready") return;
            void ready.then(() => sendResponse({ ready: true }), () => sendResponse({ ready: false }));
            return true;
        });
    }
    // Register startup/update listeners synchronously. Bootstrap also runs when
    // the worker is first activated after an update or browser crash.
    const wake = () => { void ready.catch(() => {}); };
    listen(chrome.runtime.onStartup, wake);
    listen(chrome.runtime.onInstalled, wake);
    void ready.catch(retryRecovery);
    return {
        ready,
        captureWindow: (windowId: number) => enqueue(() => capture(windowId)),
        restore: () => enqueue(() => restoreInternal(true)),
        dispose: () => { disposed = true; if (retryTimer != null) clearTimeout(retryTimer); for (const timer of timers.values()) clearTimeout(timer); for (const dispose of disposers) dispose(); },
    };
}
