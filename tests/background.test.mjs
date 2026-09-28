import assert from "node:assert/strict";
import test from "node:test";

const NO_GROUP_ID = -1;
const WINDOW_ID = 7;
const state = {
    tabs: [],
    groups: [],
    storage: {},
    currentWindow: { id: WINDOW_ID },
    lastFocusedWindow: {
        id: WINDOW_ID,
        left: 100,
        top: 50,
        width: 1200,
        height: 800,
    },
    tabUpdates: [],
    grouped: [],
    ungrouped: [],
    createdWindows: [],
};
const commandListeners = [];

globalThis.chrome = {
    sidePanel: {
        setPanelBehavior: async () => {},
    },
    commands: {
        onCommand: {
            addListener: (listener) => commandListeners.push(listener),
        },
    },
    windows: {
        getCurrent: async () => state.currentWindow,
        getLastFocused: async () => state.lastFocusedWindow,
        create: async (options) => {
            state.createdWindows.push(options);
            return { id: 50, ...options };
        },
    },
    tabGroups: {
        TAB_GROUP_ID_NONE: NO_GROUP_ID,
        query: async ({ windowId }) =>
            state.groups.filter((group) => group.windowId === windowId),
    },
    tabs: {
        query: async ({ windowId, active }) =>
            state.tabs.filter(
                (tab) =>
                    (windowId == null || tab.windowId === windowId) &&
                    (active == null || tab.active === active),
            ),
        get: async (tabId) => state.tabs.find(({ id }) => id === tabId),
        update: async (tabId, changes) => {
            state.tabUpdates.push({ tabId, changes });
            if (changes.active) {
                for (const tab of state.tabs) {
                    if (tab.windowId === WINDOW_ID) tab.active = tab.id === tabId;
                }
            }
            return state.tabs.find(({ id }) => id === tabId);
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
                if (keys == null) return { ...state.storage };
                return { [keys]: state.storage[keys] };
            },
            set: async (updates) => Object.assign(state.storage, updates),
        },
    },
};

const {
    COLLAPSED_GROUPS_STORAGE_KEY,
    GROUP_ORDER_STORAGE_KEY,
    TAB_ORDER_STORAGE_KEY,
    TAB_ORDER_WINDOW_PREFIX,
} = await import("../dist/shared/storageKeys.js");
await import("../dist/background/background.js");

function tab(id, index, groupId = NO_GROUP_ID, active = false) {
    return {
        id,
        index,
        groupId,
        active,
        windowId: WINDOW_ID,
        title: `Tab ${id}`,
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

function reset({
    tabs = [],
    groups = [],
    collapsedGroups = [],
    tabOrder = [],
    groupOrder = [],
} = {}) {
    state.tabs = tabs;
    state.groups = groups;
    state.storage = {
        [COLLAPSED_GROUPS_STORAGE_KEY]: {
            [WINDOW_ID]: collapsedGroups,
        },
        [TAB_ORDER_STORAGE_KEY]: {
            [WINDOW_ID]: tabOrder,
        },
        [GROUP_ORDER_STORAGE_KEY]: {
            [WINDOW_ID]: groupOrder,
        },
    };
    state.currentWindow = { id: WINDOW_ID };
    state.tabUpdates = [];
    state.grouped = [];
    state.ungrouped = [];
    state.createdWindows = [];
}

async function dispatchCommand(command) {
    for (const listener of commandListeners) listener(command);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

test("cycle commands skip collapsed groups and wrap at the ends", async () => {
    reset({
        tabs: [
            tab(1, 0, NO_GROUP_ID, true),
            tab(2, 1, 10),
            tab(3, 2, 20),
        ],
        groups: [group(10), group(20)],
        collapsedGroups: ["10"],
        tabOrder: [1, 2, 3],
        groupOrder: [10, 20],
    });

    await dispatchCommand("cycle_next_visible_tab");
    assert.deepEqual(state.tabUpdates, [
        { tabId: 3, changes: { active: true } },
    ]);

    await dispatchCommand("cycle_next_visible_tab");
    assert.deepEqual(state.tabUpdates.at(-1), {
        tabId: 1,
        changes: { active: true },
    });

    await dispatchCommand("cycle_previous_visible_tab");
    assert.deepEqual(state.tabUpdates.at(-1), {
        tabId: 3,
        changes: { active: true },
    });
});

test("moving within a group updates logical order and preserves active tab", async () => {
    reset({
        tabs: [tab(1, 0, 10, true), tab(2, 1, 10)],
        groups: [group(10)],
        tabOrder: [1, 2],
        groupOrder: [10],
    });

    await dispatchCommand("move_active_tab_next");

    assert.deepEqual(state.storage[`${TAB_ORDER_WINDOW_PREFIX}${WINDOW_ID}`].order, [2, 1]);
    assert.deepEqual(state.grouped, []);
    assert.deepEqual(state.ungrouped, []);
    assert.deepEqual(state.tabUpdates, [
        { tabId: 1, changes: { active: true } },
    ]);
});

test("moving across sections changes the active tab's Chrome group", async () => {
    reset({
        tabs: [tab(1, 0, NO_GROUP_ID, true), tab(2, 1, 10)],
        groups: [group(10)],
        tabOrder: [1, 2],
        groupOrder: [10],
    });

    await dispatchCommand("move_active_tab_next");

    assert.deepEqual(state.grouped, [{ groupId: 10, tabIds: [1] }]);
    assert.equal(state.tabs[0].groupId, 10);
    assert.deepEqual(state.tabUpdates, [
        { tabId: 1, changes: { active: true } },
    ]);
});

test("quick search opens a fixed-size window centred on the last focused one", async () => {
    reset();

    await dispatchCommand("open_quick_search");

    assert.deepEqual(state.createdWindows, [
        {
            left: 340,
            top: 190,
            type: "normal",
            state: "normal",
            width: 720,
            height: 520,
            focused: true,
        },
    ]);
});
