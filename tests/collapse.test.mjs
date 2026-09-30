import assert from "node:assert/strict";
import test from "node:test";

const WINDOW_ID = 7;
const state = {
    currentWindow: { id: WINDOW_ID },
    storage: {},
};

globalThis.chrome = {
    runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
    },
    windows: {
        getCurrent: async () => state.currentWindow,
    },
    storage: {
        local: {
            get: async (keys) => Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).map((key) => [key, state.storage[key]]),
            ),
            set: async (updates) => Object.assign(state.storage, updates),
        },
    },
};

const {
    isCollapsedCheck,
    loadCollapse,
    persistCollapse,
    toggleInList,
} = await import("../dist/sidebar/helpers/collapseState.js");
const {
    COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY,
    COLLAPSED_GROUPS_STORAGE_KEY,
    COLLAPSED_GROUPS_WINDOW_PREFIX,
} = await import("../dist/sidebar/config.js");

function reset() {
    state.currentWindow = { id: WINDOW_ID };
    state.storage = {};
}

test("tab collapse state persists per window without overwriting others", async () => {
    reset();
    state.storage[COLLAPSED_GROUPS_STORAGE_KEY] = {
        99: ["90"],
    };
    state.storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}99`] = ["91"];

    await persistCollapse(new Set(["10", "20"]), "tab");

    assert.deepEqual(state.storage[COLLAPSED_GROUPS_STORAGE_KEY], {
        99: ["90"],
    });
    assert.deepEqual(state.storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}${WINDOW_ID}`], ["10", "20"]);
    assert.deepEqual(state.storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}99`], ["91"]);
});

test("tab collapse state prefers the per-window key over legacy data", async () => {
    reset();
    state.storage[COLLAPSED_GROUPS_STORAGE_KEY] = { [WINDOW_ID]: ["old"] };
    state.storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}${WINDOW_ID}`] = [];

    const ids = new Set(["stale"]);
    await loadCollapse(ids, "tab");

    assert.deepEqual([...ids], []);
});

test("bookmark collapse state uses one shared flat list", async () => {
    reset();

    await persistCollapse(new Set(["folder-a", "folder-b"]), "bookmark");

    assert.deepEqual(
        state.storage[COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY],
        ["folder-a", "folder-b"],
    );
});

test("loading collapse state clears stale memory and sanitises stored ids", async () => {
    reset();
    state.storage[COLLAPSED_GROUPS_STORAGE_KEY] = {
        [WINDOW_ID]: [10, "20", null, {}, "20"],
    };
    state.storage[COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY] = [
        "folder-a",
        3,
        false,
    ];

    const tabIds = new Set(["stale"]);
    const bookmarkIds = new Set(["stale"]);
    await loadCollapse(tabIds, "tab");
    await loadCollapse(bookmarkIds, "bookmark");

    assert.deepEqual([...tabIds], ["10", "20"]);
    assert.deepEqual([...bookmarkIds], ["folder-a", "3"]);
    assert.equal(isCollapsedCheck(10, tabIds), true);
    assert.equal(isCollapsedCheck("missing", tabIds), false);
});

test("toggleInList updates memory and persisted bookmark state together", async () => {
    reset();
    const ids = new Set(["a"]);

    await toggleInList(ids, "a", "bookmark");
    assert.deepEqual([...ids], []);
    assert.deepEqual(
        state.storage[COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY],
        [],
    );

    await toggleInList(ids, "b", "bookmark");
    assert.deepEqual([...ids], ["b"]);
    assert.deepEqual(
        state.storage[COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY],
        ["b"],
    );
});

test("tab persistence safely stops when Chrome has no current window id", async () => {
    reset();
    state.currentWindow = {};

    await persistCollapse(new Set(["10"]), "tab");

    assert.equal(state.storage[COLLAPSED_GROUPS_STORAGE_KEY], undefined);
    assert.equal(state.storage[`${COLLAPSED_GROUPS_WINDOW_PREFIX}${WINDOW_ID}`], undefined);
});
