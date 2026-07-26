import assert from "node:assert/strict";
import test from "node:test";

const NO_GROUP_ID = -1;
const WINDOW_ID = 7;

const state = {
    tabs: [],
    groups: [],
    storage: {},
    grouped: [],
    ungrouped: [],
};

globalThis.chrome = {
    tabGroups: {
        TAB_GROUP_ID_NONE: NO_GROUP_ID,
        query: async ({ windowId }) =>
            state.groups.filter((group) => group.windowId === windowId),
    },
    tabs: {
        query: async ({ windowId }) =>
            state.tabs.filter((tab) => tab.windowId === windowId),
        get: async (tabId) => {
            const tab = state.tabs.find((candidate) => candidate.id === tabId);
            if (!tab) throw new Error(`Missing tab ${tabId}`);
            return tab;
        },
        group: async ({ groupId, tabIds }) => {
            const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
            state.grouped.push({ groupId, tabIds: ids });
            for (const tab of state.tabs) {
                if (ids.includes(tab.id)) tab.groupId = groupId;
            }
            return groupId;
        },
        ungroup: async (tabIds) => {
            const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
            state.ungrouped.push(ids);
            for (const tab of state.tabs) {
                if (ids.includes(tab.id)) tab.groupId = NO_GROUP_ID;
            }
        },
    },
    storage: {
        local: {
            get: async (keys) => {
                if (Array.isArray(keys)) {
                    return Object.fromEntries(
                        keys.map((key) => [key, state.storage[key]]),
                    );
                }
                if (typeof keys === "string") {
                    return { [keys]: state.storage[keys] };
                }
                return { ...state.storage };
            },
            set: async (updates) => {
                Object.assign(state.storage, updates);
            },
        },
    },
};

const {
    getTabGroupId,
    buildVisibleLogicalTabIds,
    getVisibleMovePosition,
    loadCollapsedGroupIds,
    loadLogicalTabGroupData,
    moveIdRelative,
    moveIdToEnd,
    moveStoredGroupRelative,
    moveStoredGroupToEnd,
    moveStoredTabRelative,
    moveStoredTabToEnd,
    orderGroupsByTabPosition,
    setTabGroup,
    sortTabsByIndex,
} = await import("../dist/shared/groupOrder.js");
const {
    COLLAPSED_GROUPS_STORAGE_KEY,
    GROUP_ORDER_STORAGE_KEY,
    TAB_ORDER_STORAGE_KEY,
} = await import("../dist/shared/storageKeys.js");

function tab(id, index, groupId = NO_GROUP_ID) {
    return {
        id,
        index,
        groupId,
        windowId: WINDOW_ID,
        title: `Tab ${id}`,
        active: false,
    };
}

function group(id) {
    return {
        id,
        windowId: WINDOW_ID,
        title: `Group ${id}`,
        color: "grey",
        collapsed: false,
    };
}

function resetState({
    tabs = [],
    groups = [],
    tabOrderByWindow = {},
    groupOrderByWindow = {},
} = {}) {
    state.tabs = tabs;
    state.groups = groups;
    state.grouped = [];
    state.ungrouped = [];
    state.storage = {
        [TAB_ORDER_STORAGE_KEY]: tabOrderByWindow,
        [GROUP_ORDER_STORAGE_KEY]: groupOrderByWindow,
    };
}

test("loadLogicalTabGroupData cleans closed ids and appends new live ids", async () => {
    resetState({
        tabs: [
            tab(1, 0),
            tab(2, 1, 20),
            tab(3, 2, 10),
            tab(4, 3),
        ],
        groups: [group(20), group(10)],
        tabOrderByWindow: {
            [WINDOW_ID]: [3, 999, 2, 2],
            other: [88],
        },
        groupOrderByWindow: {
            [WINDOW_ID]: [10, 999, 10],
        },
    });

    const data = await loadLogicalTabGroupData(WINDOW_ID);

    assert.deepEqual(data.tabOrder, [3, 2, 1, 4]);
    assert.deepEqual(data.groupOrder, [10, 20]);
    assert.deepEqual(
        data.tabs.map((loadedTab) => loadedTab.id),
        [3, 2, 1, 4],
    );
    assert.deepEqual(
        data.groups.map((loadedGroup) => loadedGroup.id),
        [10, 20],
    );
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY], {
        [WINDOW_ID]: [3, 2, 1, 4],
        other: [88],
    });
    assert.deepEqual(state.storage[GROUP_ORDER_STORAGE_KEY], {
        [WINDOW_ID]: [10, 20],
    });
});

test("buildVisibleLogicalTabIds puts ungrouped tabs first and skips collapsed groups", async () => {
    resetState({
        tabs: [
            tab(1, 0),
            tab(2, 1, 20),
            tab(3, 2, 10),
            tab(4, 3),
            tab(5, 4, 20),
        ],
        groups: [group(20), group(10)],
        tabOrderByWindow: {
            [WINDOW_ID]: [3, 2, 1, 5, 4],
        },
        groupOrderByWindow: {
            [WINDOW_ID]: [10, 20],
        },
    });

    const data = await loadLogicalTabGroupData(WINDOW_ID);

    assert.deepEqual(buildVisibleLogicalTabIds(data, new Set()), [
        1,
        4,
        3,
        2,
        5,
    ]);
    assert.deepEqual(buildVisibleLogicalTabIds(data, new Set(["10"])), [
        1,
        4,
        2,
        5,
    ]);
});

test("move helpers reposition ids without mutating the original order", () => {
    const order = [1, 2, 3, 4];

    assert.deepEqual(moveIdRelative(order, 2, 3, "after"), [1, 3, 2, 4]);
    assert.deepEqual(moveIdRelative(order, 4, 1, "before"), [4, 1, 2, 3]);
    assert.deepEqual(order, [1, 2, 3, 4]);
});

test("stored tab moves persist against the cleaned logical order", async () => {
    resetState({
        tabs: [tab(1, 0), tab(2, 1), tab(3, 2), tab(4, 3)],
        tabOrderByWindow: {
            [WINDOW_ID]: [1, 2, 999, 3, 4],
        },
    });

    await moveStoredTabRelative(WINDOW_ID, 2, 3, "after");
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY][WINDOW_ID], [
        1,
        3,
        2,
        4,
    ]);

    await moveStoredTabToEnd(WINDOW_ID, 1);
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY][WINDOW_ID], [
        3,
        2,
        4,
        1,
    ]);
});

test("visible keyboard moves insert at section edges when crossing groups", () => {
    assert.equal(
        getVisibleMovePosition({
            sourceGroupId: NO_GROUP_ID,
            targetGroupId: 10,
            direction: 1,
            currentIndex: 1,
            nextIndex: 2,
        }),
        "before",
    );
    assert.equal(
        getVisibleMovePosition({
            sourceGroupId: 10,
            targetGroupId: NO_GROUP_ID,
            direction: -1,
            currentIndex: 2,
            nextIndex: 1,
        }),
        "after",
    );
});

test("visible keyboard moves still swap adjacent tabs inside one section", () => {
    assert.equal(
        getVisibleMovePosition({
            sourceGroupId: 10,
            targetGroupId: 10,
            direction: 1,
            currentIndex: 2,
            nextIndex: 3,
        }),
        "after",
    );
    assert.equal(
        getVisibleMovePosition({
            sourceGroupId: 10,
            targetGroupId: 10,
            direction: -1,
            currentIndex: 3,
            nextIndex: 2,
        }),
        "before",
    );
});

test("physical tab and group ordering is deterministic without mutating inputs", () => {
    const unsortedTabs = [
        tab(3, 8, 30),
        tab(1, 1, 10),
        { ...tab(4, 0, 40), index: undefined },
        tab(2, 4, 20),
    ];
    const unsortedGroups = [group(40), group(30), group(20), group(10)];

    assert.deepEqual(
        sortTabsByIndex(unsortedTabs).map(({ id }) => id),
        [1, 2, 3, 4],
    );
    assert.deepEqual(
        orderGroupsByTabPosition(unsortedGroups, unsortedTabs).map(
            ({ id }) => id,
        ),
        [10, 20, 30, 40],
    );
    assert.deepEqual(
        unsortedTabs.map(({ id }) => id),
        [3, 1, 4, 2],
    );
    assert.deepEqual(
        unsortedGroups.map(({ id }) => id),
        [40, 30, 20, 10],
    );
});

test("malformed stored orders are repaired without losing other windows", async () => {
    resetState({
        tabs: [tab(1, 0), tab(2, 1)],
        groups: [group(10)],
    });
    state.storage[TAB_ORDER_STORAGE_KEY] = {
        [WINDOW_ID]: ["2", "bad", 2, 1.5, null],
        99: [90],
    };
    state.storage[GROUP_ORDER_STORAGE_KEY] = "not an order map";

    const data = await loadLogicalTabGroupData(WINDOW_ID);

    assert.deepEqual(data.tabOrder, [2, 1]);
    assert.deepEqual(data.groupOrder, [10]);
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY], {
        [WINDOW_ID]: [2, 1],
        99: [90],
    });
    assert.deepEqual(state.storage[GROUP_ORDER_STORAGE_KEY], {
        [WINDOW_ID]: [10],
    });
});

test("collapsed group ids load per window and tolerate mixed stored values", async () => {
    resetState();
    state.storage[COLLAPSED_GROUPS_STORAGE_KEY] = {
        [WINDOW_ID]: [10, "20", null, {}, "20"],
        99: ["90"],
    };

    assert.deepEqual([...(await loadCollapsedGroupIds(WINDOW_ID))], [
        "10",
        "20",
    ]);
    assert.deepEqual([...(await loadCollapsedGroupIds(123))], []);
});

test("move helpers handle end moves and invalid requests as no-ops", () => {
    const order = [1, 2, 3];

    assert.deepEqual(moveIdToEnd(order, 1), [2, 3, 1]);
    assert.strictEqual(moveIdToEnd(order, 99), order);
    assert.strictEqual(moveIdRelative(order, 1, 1, "after"), order);
    assert.strictEqual(moveIdRelative(order, 1, 99, "before"), order);
});

test("stored group moves persist independently from tab order", async () => {
    resetState({
        tabs: [tab(1, 0, 10), tab(2, 1, 20), tab(3, 2, 30)],
        groups: [group(10), group(20), group(30)],
        tabOrderByWindow: { [WINDOW_ID]: [1, 2, 3] },
        groupOrderByWindow: { [WINDOW_ID]: [10, 20, 30], 99: [90] },
    });

    await moveStoredGroupRelative(WINDOW_ID, 10, 20, "after");
    assert.deepEqual(state.storage[GROUP_ORDER_STORAGE_KEY], {
        [WINDOW_ID]: [20, 10, 30],
        99: [90],
    });

    await moveStoredGroupToEnd(WINDOW_ID, 20);
    assert.deepEqual(state.storage[GROUP_ORDER_STORAGE_KEY][WINDOW_ID], [
        10, 30, 20,
    ]);
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY][WINDOW_ID], [1, 2, 3]);
});

test("setTabGroup performs only the Chrome operation needed", async () => {
    resetState({
        tabs: [tab(1, 0), tab(2, 1, 10), tab(3, 2, 20)],
    });

    assert.equal(getTabGroupId({}), NO_GROUP_ID);
    await setTabGroup(1, NO_GROUP_ID);
    await setTabGroup(2, 10);
    assert.deepEqual(state.grouped, []);
    assert.deepEqual(state.ungrouped, []);

    await setTabGroup(1, 10);
    await setTabGroup(3, NO_GROUP_ID);

    assert.deepEqual(state.grouped, [{ groupId: 10, tabIds: [1] }]);
    assert.deepEqual(state.ungrouped, [[3]]);
    assert.equal(state.tabs.find(({ id }) => id === 1).groupId, 10);
    assert.equal(state.tabs.find(({ id }) => id === 3).groupId, NO_GROUP_ID);
});
