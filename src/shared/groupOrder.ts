import {
    COLLAPSED_GROUPS_STORAGE_KEY,
    COLLAPSED_GROUPS_WINDOW_PREFIX,
    GROUP_ORDER_STORAGE_KEY,
    GROUP_ORDER_SNAPSHOT_PREFIX,
    GROUP_ORDER_WINDOW_PREFIX,
    TAB_ORDER_STORAGE_KEY,
    TAB_ORDER_SNAPSHOT_PREFIX,
    TAB_ORDER_WINDOW_PREFIX,
} from "./storageKeys.js";

const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

type WindowOrderMap = Record<string, number[]>;
type WindowCollapsedMap = Record<string, unknown>;
type StoredOrder = {
    order: number[];
    fingerprints: string[] | null;
    inventory: string[] | null;
    sourceWindowId?: number;
    windowInventory?: string[] | null;
};
type TabWithId = chrome.tabs.Tab & { id: number };
type GroupWithId = chrome.tabGroups.TabGroup & { id: number };

export type DropPosition = "before" | "after";

export type LogicalTabGroupData = {
    tabs: chrome.tabs.Tab[];
    groups: chrome.tabGroups.TabGroup[];
    tabOrder: number[];
    groupOrder: number[];
    restoredFromWindowId?: number;
};

export type VisibleMovePositionOptions = {
    sourceGroupId: number;
    targetGroupId: number;
    direction: 1 | -1;
    currentIndex: number;
    nextIndex: number;
};

export function sortTabsByIndex<T extends Pick<chrome.tabs.Tab, "index">>(
    tabs: T[],
) {
    return [...tabs].sort((left, right) => {
        const leftIndex = left.index ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = right.index ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}

export function getTabGroupId(tab: Pick<chrome.tabs.Tab, "groupId">) {
    return tab.groupId ?? NO_GROUP_ID;
}

export function orderGroupsByTabPosition(
    groups: chrome.tabGroups.TabGroup[],
    tabs: chrome.tabs.Tab[],
) {
    const firstTabIndexByGroup = new Map<number, number>();

    for (const tab of tabs) {
        const groupId = tab.groupId;
        const tabIndex = tab.index;
        if (groupId == null || tabIndex == null || groupId === NO_GROUP_ID) {
            continue;
        }

        const currentFirstIndex = firstTabIndexByGroup.get(groupId);
        if (currentFirstIndex == null || tabIndex < currentFirstIndex) {
            firstTabIndexByGroup.set(groupId, tabIndex);
        }
    }

    return [...groups].sort((left, right) => {
        const leftId = left.id;
        const rightId = right.id;
        const leftIndex =
            leftId == null ? undefined : firstTabIndexByGroup.get(leftId);
        const rightIndex =
            rightId == null ? undefined : firstTabIndexByGroup.get(rightId);

        if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) {
            return leftIndex - rightIndex;
        }

        if (leftIndex != null) return -1;
        if (rightIndex != null) return 1;

        if (leftId == null && rightId == null) return 0;
        if (leftId == null) return 1;
        if (rightId == null) return -1;

        return leftId - rightId;
    });
}

function isFiniteId(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        Number.isFinite(value)
    );
}

function parseStoredId(value: unknown) {
    if (isFiniteId(value)) return value;
    if (typeof value !== "string" || value.trim().length === 0) return null;

    const parsed = Number(value);
    return isFiniteId(parsed) ? parsed : null;
}

function readWindowOrderMap(rawValue: unknown): WindowOrderMap {
    const orderMap: WindowOrderMap = {};
    if (typeof rawValue !== "object" || rawValue == null) return orderMap;

    for (const [windowId, rawOrder] of Object.entries(
        rawValue as Record<string, unknown>,
    )) {
        if (!Array.isArray(rawOrder)) continue;

        const seen = new Set<number>();
        const order: number[] = [];
        for (const rawId of rawOrder) {
            const id = parseStoredId(rawId);
            if (id == null || seen.has(id)) continue;

            seen.add(id);
            order.push(id);
        }

        orderMap[windowId] = order;
    }

    return orderMap;
}

function areOrdersEqual(left: number[], right: number[]) {
    if (left.length !== right.length) return false;

    return left.every((value, index) => value === right[index]);
}

function normaliseStoredOrder(storedOrder: number[], liveOrder: number[]) {
    const liveIds = new Set(liveOrder);
    const usedIds = new Set<number>();
    const normalisedOrder: number[] = [];

    for (const id of storedOrder) {
        if (!liveIds.has(id) || usedIds.has(id)) continue;

        usedIds.add(id);
        normalisedOrder.push(id);
    }

    for (const id of liveOrder) {
        if (usedIds.has(id)) continue;

        usedIds.add(id);
        normalisedOrder.push(id);
    }

    return normalisedOrder;
}

function buildIdMap<T extends { id?: number }>(items: T[]) {
    const idMap = new Map<number, T & { id: number }>();

    for (const item of items) {
        if (item.id == null) continue;
        idMap.set(item.id, item as T & { id: number });
    }

    return idMap;
}

function getWindowOrder(orderMap: WindowOrderMap, windowId: number) {
    return orderMap[String(windowId)] ?? [];
}

function readStoredOrder(value: unknown): StoredOrder | null {
    if (typeof value !== "object" || value == null) return null;
    const raw = value as Record<string, unknown>;
    if (!Array.isArray(raw.order)) return null;
    const order = raw.order.map(parseStoredId);
    if (order.some((id) => id == null)) return null;
    const fingerprints = raw.fingerprints;
    const inventory = raw.inventory;
    const windowInventory = raw.windowInventory;
    if (
        fingerprints !== null &&
        (!Array.isArray(fingerprints) ||
            fingerprints.length !== order.length ||
            !fingerprints.every((item) => typeof item === "string"))
    ) return null;
    if (
        inventory !== null &&
        (!Array.isArray(inventory) ||
            !inventory.every((item) => typeof item === "string"))
    ) return null;
    if (fingerprints === undefined || inventory === undefined) return null;
    if (windowInventory !== undefined && windowInventory !== null &&
        (!Array.isArray(windowInventory) ||
            !windowInventory.every((item) => typeof item === "string"))) return null;
    return {
        order: order as number[],
        fingerprints: fingerprints as string[] | null,
        inventory: inventory as string[] | null,
        ...(isFiniteId(raw.sourceWindowId)
            ? { sourceWindowId: raw.sourceWindowId }
            : {}),
        ...(windowInventory === undefined
            ? {}
            : { windowInventory: windowInventory as string[] | null }),
    };
}

function tabUrl(tab: chrome.tabs.Tab) {
    return tab.url || tab.pendingUrl || null;
}

const fingerprintPrefix = "sha256:";
const fingerprintMigrationKey = "orderFingerprintsSha256Migrated";

function urlFingerprint(url: string): Promise<string> {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
        .then((bytes) => fingerprintPrefix + Array.from(new Uint8Array(bytes))
            .map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

async function itemFingerprints(
    tabs: chrome.tabs.Tab[],
    groups: chrome.tabGroups.TabGroup[],
) {
    const hashedUrls = new Map<number, string | null>();
    await Promise.all(tabs.map(async (tab) => {
        if (tab.id == null) return;
        const url = tabUrl(tab);
        hashedUrls.set(tab.id, url == null ? null : await urlFingerprint(url));
    }));
    const memberFingerprintsByGroup = new Map<number, Array<string | null>>();
    for (const tab of tabs) {
        if (tab.groupId == null || tab.groupId === NO_GROUP_ID) continue;
        const members = memberFingerprintsByGroup.get(tab.groupId) ?? [];
        members.push(tab.id == null ? null : hashedUrls.get(tab.id) ?? null);
        memberFingerprintsByGroup.set(tab.groupId, members);
    }
    const groupFingerprints = new Map<number, string | null>();
    for (const group of groups) {
        if (group.id == null) continue;
        const memberFingerprints = memberFingerprintsByGroup.get(group.id) ?? [];
        groupFingerprints.set(
            group.id,
            memberFingerprints.every((fingerprint) => fingerprint != null)
                ? JSON.stringify([
                      group.title ?? "",
                      group.color ?? "",
                      [...(memberFingerprints as string[])].sort(),
                  ])
                : null,
        );
    }

    return { tabFingerprints: hashedUrls, groupFingerprints };
}

async function migrateLegacyFingerprints(storage: Record<string, unknown>) {
    if (storage[fingerprintMigrationKey] === true) return;
    const updates: Record<string, StoredOrder> = {};
    const invalidKeys: string[] = [];
    for (const [key, value] of Object.entries(storage)) {
        const isTab = key.startsWith(TAB_ORDER_WINDOW_PREFIX) ||
            key.startsWith(TAB_ORDER_SNAPSHOT_PREFIX);
        const isGroup = key.startsWith(GROUP_ORDER_WINDOW_PREFIX) ||
            key.startsWith(GROUP_ORDER_SNAPSHOT_PREFIX);
        if (!isTab && !isGroup) continue;
        const record = readStoredOrder(value);
        if (!record) {
            invalidKeys.push(key);
            delete storage[key];
            continue;
        }
        const migrateTab = (fingerprint: string) => fingerprint.startsWith(fingerprintPrefix)
            ? Promise.resolve(fingerprint)
            : urlFingerprint(fingerprint);
        const migrateGroup = async (fingerprint: string) => {
            try {
                const parsed: unknown = JSON.parse(fingerprint);
                if (!Array.isArray(parsed) || parsed.length !== 3 ||
                    typeof parsed[0] !== "string" || typeof parsed[1] !== "string" ||
                    !Array.isArray(parsed[2]) ||
                    !parsed[2].every((item) => typeof item === "string")) return null;
                const members = await Promise.all((parsed[2] as string[]).map(migrateTab));
                return JSON.stringify([parsed[0], parsed[1], members.sort()]);
            } catch {
                return null;
            }
        };
        const migrate = isTab ? migrateTab : migrateGroup;
        const migratedFingerprints = record.fingerprints == null ? null :
            await Promise.all(record.fingerprints.map(migrate));
        const migratedInventory = record.inventory == null ? null :
            await Promise.all(record.inventory.map(migrate));
        if (migratedFingerprints?.includes(null) || migratedInventory?.includes(null)) {
            invalidKeys.push(key);
            delete storage[key];
            continue;
        }
        const migrated: StoredOrder = {
            ...record,
            fingerprints: migratedFingerprints as string[] | null,
            inventory: migratedInventory == null ? null :
                (migratedInventory as string[]).sort(),
            ...(record.windowInventory === undefined ? {} : {
                windowInventory: record.windowInventory == null ? null :
                    (await Promise.all(record.windowInventory.map(migrateTab))).sort(),
            }),
        };
        if (JSON.stringify(record) !== JSON.stringify(migrated)) {
            updates[key] = migrated;
            storage[key] = migrated;
        }
    }
    await chrome.storage.local.set({ ...updates, [fingerprintMigrationKey]: true });
    if (invalidKeys.length > 0) await chrome.storage.local.remove(invalidKeys);
}

function makeStoredOrder(
    order: number[],
    fingerprintsById: Map<number, string | null>,
    sourceWindowId?: number,
): StoredOrder {
    const fingerprints = order.map((id) => fingerprintsById.get(id) ?? null);
    return {
        order,
        fingerprints: fingerprints.every((value) => value != null)
            ? (fingerprints as string[])
            : null,
        inventory: fingerprints.every((value) => value != null)
            ? [...(fingerprints as string[])].sort()
            : null,
        ...(sourceWindowId == null ? {} : { sourceWindowId }),
    };
}

function makeGroupStoredOrder(
    groupOrder: number[],
    groupFingerprints: Map<number, string | null>,
    tabOrder: number[],
    tabFingerprints: Map<number, string | null>,
): StoredOrder {
    return {
        ...makeStoredOrder(groupOrder, groupFingerprints),
        windowInventory: makeStoredOrder(tabOrder, tabFingerprints).inventory,
    };
}

function restoreOrder(
    stored: StoredOrder | null,
    liveOrder: number[],
    fingerprintsById: Map<number, string | null>,
) {
    if (!stored?.fingerprints) return liveOrder;
    const idsByFingerprint = new Map<string, number[]>();
    for (const id of liveOrder) {
        const fingerprint = fingerprintsById.get(id);
        if (fingerprint == null) return liveOrder;
        const ids = idsByFingerprint.get(fingerprint) ?? [];
        ids.push(id);
        idsByFingerprint.set(fingerprint, ids);
    }
    const restored: number[] = [];
    for (const fingerprint of stored.fingerprints) {
        const id = idsByFingerprint.get(fingerprint)?.shift();
        if (id != null) restored.push(id);
    }
    const used = new Set(restored);
    return [...restored, ...liveOrder.filter((id) => !used.has(id))];
}

function groupLabel(fingerprint: string) {
    try {
        const parsed: unknown = JSON.parse(fingerprint);
        return Array.isArray(parsed) &&
            typeof parsed[0] === "string" &&
            typeof parsed[1] === "string"
            ? JSON.stringify([parsed[0], parsed[1]])
            : null;
    } catch {
        return null;
    }
}

function restoreGroupOrder(
    stored: StoredOrder | null,
    liveOrder: number[],
    fingerprintsById: Map<number, string | null>,
) {
    if (!stored?.fingerprints) return liveOrder;
    const idsByFingerprint = new Map<string, number[]>();
    for (const id of liveOrder) {
        const fingerprint = fingerprintsById.get(id);
        if (fingerprint == null) return liveOrder;
        const ids = idsByFingerprint.get(fingerprint) ?? [];
        ids.push(id);
        idsByFingerprint.set(fingerprint, ids);
    }
    const assigned = stored.fingerprints.map((fingerprint) =>
        idsByFingerprint.get(fingerprint)?.shift() ?? null,
    );
    const used = new Set(assigned.filter((id): id is number => id != null));
    const unmatchedByLabel = new Map<string, number[]>();
    for (const id of liveOrder) {
        if (used.has(id)) continue;
        const label = groupLabel(fingerprintsById.get(id) ?? "");
        if (label == null) continue;
        const ids = unmatchedByLabel.get(label) ?? [];
        ids.push(id);
        unmatchedByLabel.set(label, ids);
    }
    for (let index = 0; index < assigned.length; index++) {
        if (assigned[index] != null) continue;
        const label = groupLabel(stored.fingerprints[index] ?? "");
        if (label == null) continue;
        const storedMatches = stored.fingerprints.filter((fingerprint, slot) =>
            assigned[slot] == null && groupLabel(fingerprint) === label,
        );
        const liveMatches = unmatchedByLabel.get(label) ?? [];
        if (storedMatches.length === 1 && liveMatches.length === 1) {
            assigned[index] = liveMatches[0];
            used.add(liveMatches[0]);
            unmatchedByLabel.delete(label);
        }
    }
    return [
        ...assigned.filter((id): id is number => id != null),
        ...liveOrder.filter((id) => !used.has(id)),
    ];
}

function hasMatchingLiveIdentity(
    stored: StoredOrder | null,
    liveIds: Set<number>,
    fingerprintsById: Map<number, string | null>,
) {
    return stored?.fingerprints?.some((fingerprint, index) => {
        const id = stored.order[index];
        return id != null && liveIds.has(id) &&
            fingerprintsById.get(id) === fingerprint;
    }) ?? false;
}

async function findRestartRecord(
    windowId: number,
    storage: Record<string, unknown>,
    liveInventory: string[] | null,
) {
    if (liveInventory == null || !chrome.windows?.getAll) return null;
    const liveWindowIds = new Set(
        (await chrome.windows.getAll()).map((window) => window.id),
    );
    const previousWindowIds = new Set<number>();
    for (const key of Object.keys(storage)) {
        const prefix = key.startsWith(TAB_ORDER_SNAPSHOT_PREFIX)
            ? TAB_ORDER_SNAPSHOT_PREFIX
            : key.startsWith(GROUP_ORDER_SNAPSHOT_PREFIX)
              ? GROUP_ORDER_SNAPSHOT_PREFIX
              : null;
        if (!prefix) continue;
        const id = Number(key.slice(prefix.length));
        if (isFiniteId(id)) previousWindowIds.add(id);
    }
    const candidates = [...previousWindowIds].flatMap((previousWindowId) => {
        if (!isFiniteId(previousWindowId) ||
            (previousWindowId !== windowId && liveWindowIds.has(previousWindowId))) return [];
        const claimedByLiveWindow = [...liveWindowIds].some((liveWindowId) => {
            if (liveWindowId == null || liveWindowId === windowId) return false;
            const active = readStoredOrder(
                storage[`${TAB_ORDER_WINDOW_PREFIX}${liveWindowId}`],
            );
            return active?.sourceWindowId === previousWindowId;
        });
        if (claimedByLiveWindow) return [];
        const tabRecord = readStoredOrder(
            storage[`${TAB_ORDER_SNAPSHOT_PREFIX}${previousWindowId}`],
        );
        const groupRecord = readStoredOrder(
            storage[`${GROUP_ORDER_SNAPSHOT_PREFIX}${previousWindowId}`],
        );
        const tabMatches = tabRecord?.inventory &&
            isConservativeInventoryMatch(tabRecord.inventory, liveInventory);
        const groupMatches = groupRecord?.windowInventory &&
            isConservativeInventoryMatch(groupRecord.windowInventory, liveInventory);
        if (!tabMatches && !groupMatches) return [];
        return [{ previousWindowId, tabRecord, groupRecord }];
    });
    return candidates.length === 1 ? candidates[0] : null;
}

function isConservativeInventoryMatch(stored: string[], live: string[]) {
    if (live.length === 0) return false;
    if (live.length > stored.length && stored.length < 3) return false;
    if (live.length < 2 && live.length !== stored.length) return false;
    if (Math.min(live.length, stored.length) * 2 <
        Math.max(live.length, stored.length)) return false;
    const smaller = live.length <= stored.length ? live : stored;
    const larger = live.length <= stored.length ? stored : live;
    const counts = new Map<string, number>();
    for (const item of larger) counts.set(item, (counts.get(item) ?? 0) + 1);
    for (const item of smaller) {
        const remaining = counts.get(item) ?? 0;
        if (remaining === 0) return false;
        counts.set(item, remaining - 1);
    }
    return true;
}

function isSameInventory(left: string[] | null | undefined, right: string[] | null) {
    return left != null && right != null && left.length === right.length &&
        left.every((value, index) => value === right[index]);
}

async function saveWindowOrders(
    windowId: number,
    data: LogicalTabGroupData,
    tabOrder: number[],
    groupOrder: number[],
    changed: "tab" | "group",
) {
    const fingerprints = await itemFingerprints(data.tabs, data.groups);
    const tabKey = `${TAB_ORDER_WINDOW_PREFIX}${windowId}`;
    const groupKey = `${GROUP_ORDER_WINDOW_PREFIX}${windowId}`;
    const updates: Record<string, StoredOrder> = {};
    if (changed === "tab") {
        updates[tabKey] = makeStoredOrder(
            tabOrder,
            fingerprints.tabFingerprints,
        );
        updates[`${TAB_ORDER_SNAPSHOT_PREFIX}${windowId}`] = makeStoredOrder(
            tabOrder,
            fingerprints.tabFingerprints,
        );
    }
    if (changed === "group") {
        updates[groupKey] = makeGroupStoredOrder(
            groupOrder,
            fingerprints.groupFingerprints,
            tabOrder,
            fingerprints.tabFingerprints,
        );
        updates[`${GROUP_ORDER_SNAPSHOT_PREFIX}${windowId}`] = updates[groupKey];
    }
    await chrome.storage.local.set(updates);
    if (data.restoredFromWindowId != null && chrome.storage.local.remove) {
        const obsoleteKeys = [
            `${TAB_ORDER_SNAPSHOT_PREFIX}${data.restoredFromWindowId}`,
            `${GROUP_ORDER_SNAPSHOT_PREFIX}${data.restoredFromWindowId}`,
        ];
        if (chrome.windows?.getAll) {
            const liveWindows = await chrome.windows.getAll();
            if (!liveWindows.some((window) => window.id === data.restoredFromWindowId)) {
                obsoleteKeys.push(
                    `${TAB_ORDER_WINDOW_PREFIX}${data.restoredFromWindowId}`,
                    `${GROUP_ORDER_WINDOW_PREFIX}${data.restoredFromWindowId}`,
                );
            }
        }
        await chrome.storage.local.remove(obsoleteKeys);
    }
}

export async function loadLogicalTabGroupData(
    windowId: number,
): Promise<LogicalTabGroupData> {
    const [liveTabs, liveGroups, storage] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId }),
        chrome.storage.local.get(null),
    ]);
    await migrateLegacyFingerprints(storage);

    const tabsById = buildIdMap(liveTabs);
    const groupsById = buildIdMap(liveGroups);
    const liveTabOrder = sortTabsByIndex(liveTabs)
        .map((tab) => tab.id)
        .filter((id): id is number => id != null);
    const liveGroupOrder = orderGroupsByTabPosition(
        liveGroups,
        sortTabsByIndex(liveTabs),
    )
        .map((group) => group.id)
        .filter((id): id is number => id != null);

    const tabKey = `${TAB_ORDER_WINDOW_PREFIX}${windowId}`;
    const groupKey = `${GROUP_ORDER_WINDOW_PREFIX}${windowId}`;
    const rawTabRecord = readStoredOrder(storage[tabKey]);
    const rawGroupRecord = readStoredOrder(storage[groupKey]);
    const fingerprints = await itemFingerprints(liveTabs, liveGroups);
    const liveTabInventory = makeStoredOrder(
        liveTabOrder,
        fingerprints.tabFingerprints,
    ).inventory;
    const groupIdsContinuing = rawGroupRecord?.order.every((id) => groupsById.has(id)) ?? false;
    const groupTabInventoryContinuing = groupIdsContinuing &&
        isSameInventory(rawGroupRecord?.windowInventory, liveTabInventory);
    const directTabRecord = hasMatchingLiveIdentity(
        rawTabRecord,
        new Set(tabsById.keys()),
        fingerprints.tabFingerprints,
    )
        ? rawTabRecord
        : null;
    const directGroupRecord = groupTabInventoryContinuing || hasMatchingLiveIdentity(
        rawGroupRecord,
        new Set(groupsById.keys()),
        fingerprints.groupFingerprints,
    )
        ? rawGroupRecord
        : null;
    const legacyTabOrder = getWindowOrder(
        readWindowOrderMap(storage[TAB_ORDER_STORAGE_KEY]),
        windowId,
    );
    const legacyGroupOrder = getWindowOrder(
        readWindowOrderMap(storage[GROUP_ORDER_STORAGE_KEY]),
        windowId,
    );
    const useLegacyTab = legacyTabOrder.some((id) => tabsById.has(id));
    const useLegacyGroup = legacyGroupOrder.some((id) => groupsById.has(id));
    const matchingDirectIds = directTabRecord?.order.filter((id, index) =>
        tabsById.has(id) &&
        directTabRecord.fingerprints?.[index] === fingerprints.tabFingerprints.get(id),
    ).length ?? 0;
    const restart = !directTabRecord || matchingDirectIds < liveTabOrder.length
        ? await findRestartRecord(windowId, storage, liveTabInventory)
        : null;
    const restoredGroupRecord = restart?.groupRecord ?? null;

    const tabOrder = restart
        ? restoreOrder(restart.tabRecord, liveTabOrder, fingerprints.tabFingerprints)
        : directTabRecord
          ? normaliseStoredOrder(directTabRecord.order, liveTabOrder)
          : normaliseStoredOrder(
                useLegacyTab ? legacyTabOrder : [],
                liveTabOrder,
            );
    const groupOrder = restart
          ? restoreGroupOrder(
                restoredGroupRecord,
                liveGroupOrder,
                fingerprints.groupFingerprints,
            )
        : directGroupRecord
          ? normaliseStoredOrder(directGroupRecord.order, liveGroupOrder)
          : normaliseStoredOrder(
                useLegacyGroup ? legacyGroupOrder : [],
                liveGroupOrder,
            );

    const nextTabRecord = makeStoredOrder(tabOrder, fingerprints.tabFingerprints);
    const nextGroupRecord = makeGroupStoredOrder(
        groupOrder,
        fingerprints.groupFingerprints,
        tabOrder,
        fingerprints.tabFingerprints,
    );
    const hasPersistedOrder = Boolean(
        directTabRecord || directGroupRecord || useLegacyTab ||
        useLegacyGroup || restart,
    );
    if (hasPersistedOrder) {
        const sourceWindowId = rawTabRecord?.sourceWindowId ?? restart?.previousWindowId;
        const updates: Record<string, StoredOrder> = {};
        const activeTabRecord = {
            ...nextTabRecord,
            ...(sourceWindowId == null ? {} : { sourceWindowId }),
        };
        if (JSON.stringify(rawTabRecord) !== JSON.stringify(activeTabRecord)) {
            updates[tabKey] = activeTabRecord;
        }
        if (JSON.stringify(rawGroupRecord) !== JSON.stringify(nextGroupRecord)) {
            updates[groupKey] = nextGroupRecord;
        }
        if ((useLegacyTab || useLegacyGroup) &&
            !readStoredOrder(storage[`${TAB_ORDER_SNAPSHOT_PREFIX}${windowId}`])) {
            updates[`${TAB_ORDER_SNAPSHOT_PREFIX}${windowId}`] = nextTabRecord;
            updates[`${GROUP_ORDER_SNAPSHOT_PREFIX}${windowId}`] = nextGroupRecord;
        }
        const matchingExistingTabs = rawTabRecord?.order.filter((id, index) =>
            tabsById.has(id) &&
            rawTabRecord.fingerprints?.[index] === fingerprints.tabFingerprints.get(id),
        ).length ?? 0;
        const tabIdsContinuing = rawTabRecord != null &&
            rawTabRecord.order.length > 0 &&
            rawTabRecord.order.every((id) => tabsById.has(id)) &&
            matchingExistingTabs >= Math.ceil(rawTabRecord.order.length / 2);
        const tabSnapshotKey = `${TAB_ORDER_SNAPSHOT_PREFIX}${windowId}`;
        const groupSnapshotKey = `${GROUP_ORDER_SNAPSHOT_PREFIX}${windowId}`;
        const tabSnapshot = readStoredOrder(storage[tabSnapshotKey]);
        const groupSnapshot = readStoredOrder(storage[groupSnapshotKey]);
        if (tabSnapshot && tabIdsContinuing &&
            liveTabOrder.length >= tabSnapshot.order.length &&
            JSON.stringify(tabSnapshot) !== JSON.stringify(nextTabRecord)) {
            updates[tabSnapshotKey] = nextTabRecord;
        }
        if (groupSnapshot && (groupTabInventoryContinuing || tabIdsContinuing) &&
            liveTabOrder.length >= (groupSnapshot.windowInventory?.length ?? Infinity) &&
            JSON.stringify(groupSnapshot) !== JSON.stringify(nextGroupRecord)) {
            updates[groupSnapshotKey] = nextGroupRecord;
        }
        if (Object.keys(updates).length > 0) {
            await chrome.storage.local.set(updates);
        }
    }

    return {
        tabs: tabOrder
            .map((tabId) => tabsById.get(tabId))
            .filter((tab): tab is TabWithId => tab != null),
        groups: groupOrder
            .map((groupId) => groupsById.get(groupId))
            .filter((group): group is GroupWithId => group != null),
        tabOrder,
        groupOrder,
        ...(rawTabRecord?.sourceWindowId ?? restart?.previousWindowId) == null ||
            (rawTabRecord?.sourceWindowId ?? restart?.previousWindowId) === windowId
            ? {}
            : { restoredFromWindowId: rawTabRecord?.sourceWindowId ?? restart?.previousWindowId },
    };
}

export function buildTabsByLogicalGroup(tabs: chrome.tabs.Tab[]) {
    const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
    const ungroupedTabs: chrome.tabs.Tab[] = [];

    for (const tab of tabs) {
        if (tab.groupId == null) continue;

        if (tab.groupId === NO_GROUP_ID) {
            ungroupedTabs.push(tab);
            continue;
        }

        const groupedTabs = tabsByGroup.get(tab.groupId);
        groupedTabs
            ? groupedTabs.push(tab)
            : tabsByGroup.set(tab.groupId, [tab]);
    }

    return { ungroupedTabs, tabsByGroup };
}

export function buildVisibleLogicalTabIds(
    { tabs, groups }: Pick<LogicalTabGroupData, "tabs" | "groups">,
    collapsedGroups: Set<string>,
) {
    const { ungroupedTabs, tabsByGroup } = buildTabsByLogicalGroup(tabs);
    const visibleTabIds: number[] = [];

    for (const tab of ungroupedTabs) {
        if (tab.id != null) visibleTabIds.push(tab.id);
    }

    for (const group of groups) {
        const groupId = group.id;
        if (groupId == null || collapsedGroups.has(String(groupId))) continue;

        const groupedTabs = tabsByGroup.get(groupId) ?? [];
        for (const tab of groupedTabs) {
            if (tab.id != null) visibleTabIds.push(tab.id);
        }
    }

    return visibleTabIds;
}

export async function loadCollapsedGroupIds(windowId: number) {
    const windowKey = `${COLLAPSED_GROUPS_WINDOW_PREFIX}${windowId}`;
    const storage = await chrome.storage.local.get([windowKey, COLLAPSED_GROUPS_STORAGE_KEY]);
    const windowIds = storage[windowKey];
    const rawByWindow = storage[COLLAPSED_GROUPS_STORAGE_KEY];
    const byWindow: WindowCollapsedMap =
        typeof rawByWindow === "object" && rawByWindow != null
            ? (rawByWindow as WindowCollapsedMap)
            : {};
    const storedGroupIds = Array.isArray(windowIds) ? windowIds : byWindow[String(windowId)];
    const collapsedGroups = new Set<string>();

    if (!Array.isArray(storedGroupIds)) return collapsedGroups;

    for (const groupId of storedGroupIds) {
        if (typeof groupId === "string" || typeof groupId === "number") {
            collapsedGroups.add(String(groupId));
        }
    }

    return collapsedGroups;
}

export function moveIdRelative(
    order: number[],
    sourceId: number,
    targetId: number,
    position: DropPosition,
) {
    if (sourceId === targetId) return order;
    if (!order.includes(sourceId) || !order.includes(targetId)) return order;

    const nextOrder = order.filter((id) => id !== sourceId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (targetIndex === -1) return order;

    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    nextOrder.splice(insertIndex, 0, sourceId);

    return nextOrder;
}

export function moveIdToEnd(order: number[], sourceId: number) {
    if (!order.includes(sourceId)) return order;

    return [...order.filter((id) => id !== sourceId), sourceId];
}

/** Move the selected IDs as one block, retaining their current logical order. */
export function moveIdsRelative(
    order: number[],
    sourceIds: number[],
    targetId: number,
    position: DropPosition,
) {
    const selected = new Set(sourceIds);
    if (selected.has(targetId) || !order.includes(targetId)) return order;
    const moving = order.filter((id) => selected.has(id));
    if (moving.length === 0) return order;
    const remaining = order.filter((id) => !selected.has(id));
    const targetIndex = remaining.indexOf(targetId);
    remaining.splice(position === "before" ? targetIndex : targetIndex + 1, 0, ...moving);
    return remaining;
}

export function moveIdsToEnd(order: number[], sourceIds: number[]) {
    const selected = new Set(sourceIds);
    const moving = order.filter((id) => selected.has(id));
    if (moving.length === 0) return order;
    return [...order.filter((id) => !selected.has(id)), ...moving];
}

export function getVisibleMovePosition({
    sourceGroupId,
    targetGroupId,
    direction,
    currentIndex,
    nextIndex,
}: VisibleMovePositionOptions): DropPosition {
    if (sourceGroupId !== targetGroupId) {
        return direction === 1 ? "before" : "after";
    }

    const wrappedForward = direction === 1 && nextIndex < currentIndex;
    const wrappedBackward = direction === -1 && nextIndex > currentIndex;

    if (direction === 1) {
        return wrappedForward ? "before" : "after";
    }

    return wrappedBackward ? "after" : "before";
}

export async function moveStoredTabRelative(
    windowId: number,
    sourceTabId: number,
    targetTabId: number,
    position: DropPosition,
) {
    const data = await loadLogicalTabGroupData(windowId);
    const { tabOrder, groupOrder } = data;
    const nextOrder = moveIdRelative(
        tabOrder,
        sourceTabId,
        targetTabId,
        position,
    );
    if (areOrdersEqual(tabOrder, nextOrder)) return;

    await saveWindowOrders(windowId, data, nextOrder, groupOrder, "tab");
}

export async function moveStoredTabsRelative(
    windowId: number,
    sourceTabIds: number[],
    targetTabId: number,
    position: DropPosition,
) {
    const data = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdsRelative(data.tabOrder, sourceTabIds, targetTabId, position);
    if (areOrdersEqual(data.tabOrder, nextOrder)) return;
    await saveWindowOrders(windowId, data, nextOrder, data.groupOrder, "tab");
}

export async function moveStoredTabToEnd(
    windowId: number,
    sourceTabId: number,
) {
    const data = await loadLogicalTabGroupData(windowId);
    const { tabOrder, groupOrder } = data;
    const nextOrder = moveIdToEnd(tabOrder, sourceTabId);
    if (areOrdersEqual(tabOrder, nextOrder)) return;

    await saveWindowOrders(windowId, data, nextOrder, groupOrder, "tab");
}

export async function moveStoredTabsToEnd(windowId: number, sourceTabIds: number[]) {
    const data = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdsToEnd(data.tabOrder, sourceTabIds);
    if (areOrdersEqual(data.tabOrder, nextOrder)) return;
    await saveWindowOrders(windowId, data, nextOrder, data.groupOrder, "tab");
}

export async function moveStoredGroupRelative(
    windowId: number,
    sourceGroupId: number,
    targetGroupId: number,
    position: DropPosition,
) {
    const data = await loadLogicalTabGroupData(windowId);
    const { tabOrder, groupOrder } = data;
    const nextOrder = moveIdRelative(
        groupOrder,
        sourceGroupId,
        targetGroupId,
        position,
    );
    if (areOrdersEqual(groupOrder, nextOrder)) return;

    await saveWindowOrders(windowId, data, tabOrder, nextOrder, "group");
}

export async function moveStoredGroupToEnd(
    windowId: number,
    sourceGroupId: number,
) {
    const data = await loadLogicalTabGroupData(windowId);
    const { tabOrder, groupOrder } = data;
    const nextOrder = moveIdToEnd(groupOrder, sourceGroupId);
    if (areOrdersEqual(groupOrder, nextOrder)) return;

    await saveWindowOrders(windowId, data, tabOrder, nextOrder, "group");
}

export async function setTabGroup(tabId: number, targetGroupId: number) {
    const tab = await chrome.tabs.get(tabId);
    const currentGroupId = getTabGroupId(tab);

    if (targetGroupId === NO_GROUP_ID) {
        if (currentGroupId !== NO_GROUP_ID) {
            await chrome.tabs.ungroup(tabId);
        }
        return;
    }

    if (currentGroupId !== targetGroupId) {
        await chrome.tabs.group({ groupId: targetGroupId, tabIds: [tabId] });
    }
}
