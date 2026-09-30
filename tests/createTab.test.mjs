import assert from "node:assert/strict";
import test from "node:test";

const calls = { created: [], grouped: [], removed: [] };
let shouldFailGrouping = false;
globalThis.chrome = {
    tabs: {
        create: async (details) => {
            calls.created.push(details);
            return { id: 42 };
        },
        group: async (details) => {
            calls.grouped.push(details);
            if (shouldFailGrouping) throw new Error("Group no longer exists");
        },
        remove: async (tabId) => { calls.removed.push(tabId); },
    },
};

const { createNewTab, createNewTabInGroup } = await import(
    "../dist/sidebar/tab/createTab.js"
);

test("new tab action preserves the existing background-tab behaviour", async () => {
    await createNewTab();
    assert.deepEqual(calls.created.at(-1), {
        url: "chrome://newtab", active: false,
    });
});

test("group add creates the tab in the right window and joins the group", async () => {
    await createNewTabInGroup(7, 3);
    assert.deepEqual(calls.created.at(-1), {
        url: "chrome://newtab", active: false, windowId: 3,
    });
    assert.deepEqual(calls.grouped.at(-1), { tabIds: 42, groupId: 7 });
    assert.deepEqual(calls.removed, []);
});

test("failed grouping closes the newly created loose tab", async () => {
    shouldFailGrouping = true;
    await assert.rejects(createNewTabInGroup(7, 3), /Group no longer exists/);
    assert.deepEqual(calls.removed, [42]);
});
