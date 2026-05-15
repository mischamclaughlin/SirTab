import {
    COLLAPSED_GROUPS_STORAGE_KEY,
    GROUP_ORDER_STORAGE_KEY,
    TAB_ORDER_STORAGE_KEY,
} from "./storageKeys.js";

const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

type WindowOrderMap = Record<string, number[]>;
type WindowCollapsedMap = Record<string, unknown>;
type TabWithId = chrome.tabs.Tab & { id: number };
type GroupWithId = chrome.tabGroups.TabGroup & { id: number };

export type DropPosition = "before" | "after";

export type LogicalTabGroupData = {
    tabs: chrome.tabs.Tab[];
    groups: chrome.tabGroups.TabGroup[];
    tabOrder: number[];
    groupOrder: number[];
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

async function saveWindowOrder(
    storageKey: string,
    windowId: number,
    order: number[],
) {
    const storage = await chrome.storage.local.get(storageKey);
    const orderMap = readWindowOrderMap(storage[storageKey]);
    orderMap[String(windowId)] = order;

    await chrome.storage.local.set({ [storageKey]: orderMap });
}

export async function loadLogicalTabGroupData(
    windowId: number,
): Promise<LogicalTabGroupData> {
    const [liveTabs, liveGroups, storage] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId }),
        chrome.storage.local.get([TAB_ORDER_STORAGE_KEY, GROUP_ORDER_STORAGE_KEY]),
    ]);

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

    const tabOrderMap = readWindowOrderMap(storage[TAB_ORDER_STORAGE_KEY]);
    const groupOrderMap = readWindowOrderMap(storage[GROUP_ORDER_STORAGE_KEY]);
    const storedTabOrder = getWindowOrder(tabOrderMap, windowId);
    const storedGroupOrder = getWindowOrder(groupOrderMap, windowId);
    const tabOrder = normaliseStoredOrder(storedTabOrder, liveTabOrder);
    const groupOrder = normaliseStoredOrder(storedGroupOrder, liveGroupOrder);

    const storageUpdates: Record<string, WindowOrderMap> = {};
    if (!areOrdersEqual(storedTabOrder, tabOrder)) {
        tabOrderMap[String(windowId)] = tabOrder;
        storageUpdates[TAB_ORDER_STORAGE_KEY] = tabOrderMap;
    }
    if (!areOrdersEqual(storedGroupOrder, groupOrder)) {
        groupOrderMap[String(windowId)] = groupOrder;
        storageUpdates[GROUP_ORDER_STORAGE_KEY] = groupOrderMap;
    }
    if (Object.keys(storageUpdates).length > 0) {
        await chrome.storage.local.set(storageUpdates);
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
    const storage = await chrome.storage.local.get(COLLAPSED_GROUPS_STORAGE_KEY);
    const rawByWindow = storage[COLLAPSED_GROUPS_STORAGE_KEY];
    const byWindow: WindowCollapsedMap =
        typeof rawByWindow === "object" && rawByWindow != null
            ? (rawByWindow as WindowCollapsedMap)
            : {};
    const storedGroupIds = byWindow[String(windowId)];
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
    const { tabOrder } = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdRelative(
        tabOrder,
        sourceTabId,
        targetTabId,
        position,
    );
    if (areOrdersEqual(tabOrder, nextOrder)) return;

    await saveWindowOrder(TAB_ORDER_STORAGE_KEY, windowId, nextOrder);
}

export async function moveStoredTabToEnd(
    windowId: number,
    sourceTabId: number,
) {
    const { tabOrder } = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdToEnd(tabOrder, sourceTabId);
    if (areOrdersEqual(tabOrder, nextOrder)) return;

    await saveWindowOrder(TAB_ORDER_STORAGE_KEY, windowId, nextOrder);
}

export async function moveStoredGroupRelative(
    windowId: number,
    sourceGroupId: number,
    targetGroupId: number,
    position: DropPosition,
) {
    const { groupOrder } = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdRelative(
        groupOrder,
        sourceGroupId,
        targetGroupId,
        position,
    );
    if (areOrdersEqual(groupOrder, nextOrder)) return;

    await saveWindowOrder(GROUP_ORDER_STORAGE_KEY, windowId, nextOrder);
}

export async function moveStoredGroupToEnd(
    windowId: number,
    sourceGroupId: number,
) {
    const { groupOrder } = await loadLogicalTabGroupData(windowId);
    const nextOrder = moveIdToEnd(groupOrder, sourceGroupId);
    if (areOrdersEqual(groupOrder, nextOrder)) return;

    await saveWindowOrder(GROUP_ORDER_STORAGE_KEY, windowId, nextOrder);
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
