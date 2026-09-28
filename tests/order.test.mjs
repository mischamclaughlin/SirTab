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
    setBarrier: null,
};

globalThis.chrome = {
    windows: {
        getAll: async () => [...new Set(state.tabs.map((tab) => tab.windowId))]
            .map((id) => ({ id })),
    },
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
                let result;
                if (Array.isArray(keys)) {
                    result = Object.fromEntries(
                        keys.map((key) => [key, state.storage[key]]),
                    );
                } else if (typeof keys === "string") {
                    result = { [keys]: state.storage[keys] };
                } else {
                    result = { ...state.storage };
                }
                return structuredClone(result);
            },
            set: async (updates) => {
                if (state.setBarrier) await state.setBarrier();
                Object.assign(state.storage, structuredClone(updates));
            },
            remove: async (keys) => {
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    delete state.storage[key];
                }
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
    GROUP_ORDER_SNAPSHOT_PREFIX,
    GROUP_ORDER_WINDOW_PREFIX,
    TAB_ORDER_STORAGE_KEY,
    TAB_ORDER_SNAPSHOT_PREFIX,
    TAB_ORDER_WINDOW_PREFIX,
} = await import("../dist/shared/storageKeys.js");

function tab(id, index, groupId = NO_GROUP_ID) {
    return {
        id,
        index,
        groupId,
        windowId: WINDOW_ID,
        title: `Tab ${id}`,
        url: `https://example.test/${id}`,
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
    state.setBarrier = null;
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
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [3, 2, 1, 4]);
    assert.deepEqual(state.storage[`${GROUP_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [10, 20]);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}${WINDOW_ID}`].order, [3, 2, 1, 4]);
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY].other, [88]);
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
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [
        1,
        3,
        2,
        4,
    ]);

    await moveStoredTabToEnd(WINDOW_ID, 1);
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [
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
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [2, 1]);
    assert.deepEqual(state.storage[`${GROUP_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [10]);
    assert.deepEqual(state.storage[TAB_ORDER_STORAGE_KEY][99], [90]);
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
    assert.deepEqual(state.storage[`${GROUP_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [20, 10, 30]);
    assert.deepEqual(state.storage[GROUP_ORDER_STORAGE_KEY][99], [90]);

    await moveStoredGroupToEnd(WINDOW_ID, 20);
    assert.deepEqual(state.storage[`${GROUP_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [
        10, 30, 20,
    ]);
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [1, 2, 3]);
});

test("concurrent order saves in two windows keep both window records", async () => {
    resetState({
        tabs: [
            tab(1, 0), tab(2, 1),
            { ...tab(11, 0), windowId: 8 },
            { ...tab(12, 1), windowId: 8 },
        ],
        tabOrderByWindow: { 7: [1, 2], 8: [11, 12] },
    });
    let waiting = [];
    let blockedWrites = 0;
    state.setBarrier = () => {
        if (blockedWrites++ >= 2) return Promise.resolve();
        return new Promise((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) {
                for (const release of waiting) release();
                waiting = [];
            }
        });
    };

    await Promise.all([
        moveStoredTabRelative(7, 1, 2, "after"),
        moveStoredTabRelative(8, 11, 12, "after"),
    ]);

    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}7`].order, [2, 1]);
    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}8`].order, [12, 11]);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`].order, [2, 1]);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}8`].order, [12, 11]);
});

test("concurrent tab and group moves preserve both restart snapshots", async () => {
    resetState({
        tabs: [tab(1, 0, 10), tab(2, 1, 20), tab(3, 2, 30)],
        groups: [group(10), group(20), group(30)],
    });
    let waiting = [];
    let blockedWrites = 0;
    state.setBarrier = () => {
        if (blockedWrites++ >= 2) return Promise.resolve();
        return new Promise((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) {
                for (const release of waiting) release();
                waiting = [];
            }
        });
    };
    await Promise.all([
        moveStoredTabRelative(7, 3, 1, "before"),
        moveStoredGroupRelative(7, 30, 10, "before"),
    ]);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`].order, [3, 1, 2]);
    assert.deepEqual(state.storage[`${GROUP_ORDER_SNAPSHOT_PREFIX}7`].order, [30, 10, 20]);

    state.tabs = [
        { ...tab(101, 0, 110), windowId: 8, url: "https://example.test/1" },
        { ...tab(102, 1, 120), windowId: 8, url: "https://example.test/2" },
        { ...tab(103, 2, 130), windowId: 8, url: "https://example.test/3" },
    ];
    state.groups = [
        { ...group(110), windowId: 8, title: "Group 10" },
        { ...group(120), windowId: 8, title: "Group 20" },
        { ...group(130), windowId: 8, title: "Group 30" },
    ];
    const restored = await loadLogicalTabGroupData(8);
    assert.deepEqual(restored.tabOrder, [103, 101, 102]);
    assert.deepEqual(restored.groupOrder, [130, 110, 120]);
});

test("restores tab and group order after browser IDs change", async () => {
    resetState({
        tabs: [tab(1, 0), tab(2, 1, 10), tab(3, 2, 20), tab(4, 3)],
        groups: [
            { ...group(10), title: "Work" },
            { ...group(20), title: "Reading" },
        ],
    });
    await moveStoredTabRelative(7, 4, 1, "before");
    await moveStoredGroupRelative(7, 20, 10, "before");

    state.tabs = [
        { ...tab(101, 0), windowId: 8, url: "https://example.test/1" },
        { ...tab(102, 1, 110), windowId: 8, url: "https://example.test/2" },
        { ...tab(103, 2, 120), windowId: 8, url: "https://example.test/3" },
        { ...tab(104, 3), windowId: 8, url: "https://example.test/4" },
    ];
    state.groups = [
        { ...group(110), windowId: 8, title: "Work" },
        { ...group(120), windowId: 8, title: "Reading" },
    ];

    const restored = await loadLogicalTabGroupData(8);
    assert.deepEqual(restored.tabOrder, [104, 101, 102, 103]);
    assert.deepEqual(restored.groupOrder, [120, 110]);
});

test("restores order when Brave reuses the window ID but changes tab IDs", async () => {
    resetState({ tabs: [tab(1, 0), tab(2, 1), tab(3, 2)] });
    await moveStoredTabRelative(7, 3, 1, "before");
    state.tabs = [1, 2, 3].map((id, index) => ({
        ...tab(100 + id, index),
        url: `https://example.test/${id}`,
    }));

    const restored = await loadLogicalTabGroupData(7);
    assert.deepEqual(restored.tabOrder, [103, 101, 102]);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`].order, [3, 1, 2]);
});

test("reused numeric tab and group IDs do not revive unrelated order", async () => {
    resetState({
        tabs: [tab(1, 0, 10), tab(2, 1, 20), tab(3, 2)],
        groups: [group(10), group(20)],
    });
    await moveStoredTabRelative(7, 3, 1, "before");
    await moveStoredGroupRelative(7, 20, 10, "before");
    state.tabs = [
        { ...tab(1, 0, 10), url: "https://other.test/x" },
        { ...tab(2, 1, 20), url: "https://other.test/y" },
        { ...tab(3, 2), url: "https://other.test/z" },
    ];
    state.groups = [
        { ...group(10), title: "Unrelated A" },
        { ...group(20), title: "Unrelated B" },
    ];

    const loaded = await loadLogicalTabGroupData(7);
    assert.deepEqual(loaded.tabOrder, [1, 2, 3]);
    assert.deepEqual(loaded.groupOrder, [10, 20]);
});

test("an open restored window claims its snapshot from another matching window", async () => {
    resetState({ tabs: [tab(1, 0), tab(2, 1), tab(3, 2)] });
    await moveStoredTabRelative(7, 3, 1, "before");
    state.tabs = [
        ...[1, 2, 3].map((id, index) => ({
            ...tab(100 + id, index), windowId: 8,
            url: `https://example.test/${id}`,
        })),
        ...[1, 2, 3].map((id, index) => ({
            ...tab(200 + id, index), windowId: 9,
            url: `https://example.test/${id}`,
        })),
    ];

    assert.deepEqual((await loadLogicalTabGroupData(8)).tabOrder, [103, 101, 102]);
    assert.deepEqual((await loadLogicalTabGroupData(9)).tabOrder, [201, 202, 203]);
});

test("shutdown tab removals cannot erase the durable order snapshot", async () => {
    resetState({ tabs: [tab(1, 0), tab(2, 1), tab(3, 2), tab(4, 3)] });
    await moveStoredTabRelative(7, 4, 1, "before");
    const snapshot = structuredClone(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`]);

    state.tabs = [tab(1, 0), tab(2, 1)];
    await loadLogicalTabGroupData(7);
    state.tabs = [];
    await loadLogicalTabGroupData(7);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`], snapshot);

    state.tabs = [1, 2, 3, 4].map((id, index) => ({
        ...tab(100 + id, index),
        windowId: 8,
        url: `https://example.test/${id}`,
    }));
    const restored = await loadLogicalTabGroupData(8);
    assert.deepEqual(restored.tabOrder, [104, 101, 102, 103]);
});

test("a reused tab ID cannot make shutdown-truncated active order win", async () => {
    resetState({
        tabs: [tab(1, 0), tab(2, 1), tab(3, 2), tab(4, 3)],
        tabOrderByWindow: { 7: [1, 2, 3, 4] },
    });
    await moveStoredTabRelative(7, 4, 1, "before");
    state.tabs = [tab(1, 0), tab(2, 1)];
    await loadLogicalTabGroupData(7);

    state.tabs = [
        tab(1, 0),
        { ...tab(102, 1), url: "https://example.test/2" },
        { ...tab(103, 2), url: "https://example.test/3" },
        { ...tab(104, 3), url: "https://example.test/4" },
    ];
    const restored = await loadLogicalTabGroupData(7);
    assert.deepEqual(restored.tabOrder, [104, 1, 102, 103]);
});

test("ordinary close restores the surviving order; duplicate URLs use physical order", async () => {
    resetState({
        tabs: [
            { ...tab(1, 0), url: "https://same.test/" },
            tab(2, 1),
            { ...tab(3, 2), url: "https://same.test/" },
            tab(4, 3),
        ],
    });
    await moveStoredTabRelative(7, 4, 2, "before");
    state.tabs = [
        { ...tab(101, 0), windowId: 8, url: "https://same.test/" },
        { ...tab(103, 1), windowId: 8, url: "https://same.test/" },
        { ...tab(104, 2), windowId: 8, url: "https://example.test/4" },
    ];

    const restored = await loadLogicalTabGroupData(8);
    assert.deepEqual(restored.tabOrder, [101, 104, 103]);
});

test("a new tab after a move joins the durable snapshot before restart", async () => {
    resetState({ tabs: [tab(1, 0), tab(2, 1), tab(3, 2)] });
    await moveStoredTabRelative(7, 3, 1, "before");
    state.tabs.push(tab(4, 3));
    await loadLogicalTabGroupData(7);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`].order, [3, 1, 2, 4]);

    state.tabs = [1, 2, 3, 4].map((id, index) => ({
        ...tab(100 + id, index), windowId: 8,
        url: `https://example.test/${id}`,
    }));
    assert.deepEqual((await loadLogicalTabGroupData(8)).tabOrder, [103, 101, 102, 104]);
});

test("URL navigation and group rename refresh their durable identities", async () => {
    resetState({
        tabs: [tab(1, 0, 10), tab(2, 1, 20), tab(3, 2)],
        groups: [group(10), group(20)],
    });
    await moveStoredTabRelative(7, 3, 1, "before");
    await moveStoredGroupRelative(7, 20, 10, "before");
    state.tabs.find((candidate) => candidate.id === 2).url = "https://new.test/2";
    state.groups.find((candidate) => candidate.id === 20).title = "Renamed";
    await loadLogicalTabGroupData(7);
    assert.deepEqual(state.storage[`${TAB_ORDER_SNAPSHOT_PREFIX}7`].fingerprints, [
        "https://example.test/3", "https://example.test/1", "https://new.test/2",
    ]);
    assert.deepEqual(state.storage[`${GROUP_ORDER_SNAPSHOT_PREFIX}7`].fingerprints, [
        JSON.stringify(["Renamed", "grey", ["https://new.test/2"]]),
        JSON.stringify(["Group 10", "grey", ["https://example.test/1"]]),
    ]);

    state.tabs = [
        { ...tab(101, 0, 110), windowId: 8, url: "https://example.test/1" },
        { ...tab(102, 1, 120), windowId: 8, url: "https://new.test/2" },
        { ...tab(103, 2), windowId: 8, url: "https://example.test/3" },
    ];
    state.groups = [
        { ...group(110), windowId: 8, title: "Group 10" },
        { ...group(120), windowId: 8, title: "Renamed" },
    ];
    const restored = await loadLogicalTabGroupData(8);
    assert.deepEqual(restored.tabOrder, [103, 101, 102]);
    assert.deepEqual(restored.groupOrder, [120, 110]);
});

test("duplicate group labels use member URLs, then physical order if indistinguishable", async () => {
    resetState({
        tabs: [tab(1, 0, 10), tab(2, 1, 20)],
        groups: [
            { ...group(10), title: "Same" },
            { ...group(20), title: "Same" },
        ],
    });
    await moveStoredGroupRelative(7, 20, 10, "before");
    state.tabs = [
        { ...tab(101, 0, 110), windowId: 8, url: "https://example.test/1" },
        { ...tab(102, 1, 120), windowId: 8, url: "https://example.test/2" },
    ];
    state.groups = [
        { ...group(110), windowId: 8, title: "Same" },
        { ...group(120), windowId: 8, title: "Same" },
    ];
    assert.deepEqual((await loadLogicalTabGroupData(8)).groupOrder, [120, 110]);

    resetState({
        tabs: [
            { ...tab(1, 0, 10), url: "https://same.test/" },
            { ...tab(2, 1, 20), url: "https://same.test/" },
        ],
        groups: [
            { ...group(10), title: "Same" },
            { ...group(20), title: "Same" },
        ],
    });
    await moveStoredGroupRelative(7, 20, 10, "before");
    state.tabs = [
        { ...tab(101, 0, 110), windowId: 8, url: "https://same.test/" },
        { ...tab(102, 1, 120), windowId: 8, url: "https://same.test/" },
    ];
    state.groups = [
        { ...group(110), windowId: 8, title: "Same" },
        { ...group(120), windowId: 8, title: "Same" },
    ];
    assert.deepEqual((await loadLogicalTabGroupData(8)).groupOrder, [110, 120]);
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
