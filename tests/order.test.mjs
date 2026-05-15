import assert from "node:assert/strict";

const NO_GROUP_ID = -1;
const WINDOW_ID = 7;

const state = {
    tabs: [],
    groups: [],
    storage: {},
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
            for (const tab of state.tabs) {
                if (ids.includes(tab.id)) tab.groupId = groupId;
            }
            return groupId;
        },
        ungroup: async (tabIds) => {
            const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
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
    buildVisibleLogicalTabIds,
    getVisibleMovePosition,
    loadLogicalTabGroupData,
    moveIdRelative,
    moveStoredTabRelative,
    moveStoredTabToEnd,
} = await import("../dist/shared/groupOrder.js");
const { GROUP_ORDER_STORAGE_KEY, TAB_ORDER_STORAGE_KEY } = await import(
    "../dist/shared/storageKeys.js"
);

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
    state.storage = {
        [TAB_ORDER_STORAGE_KEY]: tabOrderByWindow,
        [GROUP_ORDER_STORAGE_KEY]: groupOrderByWindow,
    };
}

const tests = [];

function test(name, run) {
    tests.push({ name, run });
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

for (const { name, run } of tests) {
    try {
        await run();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

console.log(`${tests.length} order tests passed`);
