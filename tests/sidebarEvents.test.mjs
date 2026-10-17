import assert from "node:assert/strict";
import test from "node:test";
import { setupEventListeners } from "../dist/sidebar/helpers/events.js";
import { GROUP_ORDER_STORAGE_KEY, GROUP_ORDER_WINDOW_PREFIX, TAB_ORDER_STORAGE_KEY, TAB_ORDER_WINDOW_PREFIX } from "../dist/shared/storageKeys.js";

function eventSource() {
    const listeners = new Set();
    return {
        listeners,
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
        async emit(...args) { await Promise.all([...listeners].map((listener) => listener(...args))); },
    };
}

function harness(t) {
    const original = { chrome: globalThis.chrome, window: globalThis.window, error: console.error };
    const tabs = Object.fromEntries(["onCreated", "onRemoved", "onUpdated", "onMoved", "onAttached", "onDetached", "onActivated", "onReplaced"].map((name) => [name, eventSource()]));
    const tabGroups = Object.fromEntries(["onCreated", "onRemoved", "onUpdated", "onMoved"].map((name) => [name, eventSource()]));
    const bookmarks = Object.fromEntries(["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"].map((name) => [name, eventSource()]));
    const pagehide = eventSource();
    const storage = { onChanged: eventSource() };
    const state = { refreshes: 0, bookmarks: 0, activated: [], errors: [] };
    globalThis.chrome = { tabs, tabGroups, bookmarks, storage };
    globalThis.window = { addEventListener: (_, cb) => pagehide.addListener(cb), removeEventListener: (_, cb) => pagehide.removeListener(cb) };
    console.error = (...args) => state.errors.push(args);
    const cleanup = setupEventListeners(7, {
        activateTab: (id) => state.activated.push(id),
        requestTabGroupRefresh: () => { state.refreshes++; },
        requestBookmarkRefresh: () => { state.bookmarks++; },
    });
    t.after(() => { cleanup(); globalThis.chrome = original.chrome; globalThis.window = original.window; console.error = original.error; });
    return { tabs, tabGroups, bookmarks, storage, pagehide, state, cleanup };
}

test("tab events stay scoped to their window and activation avoids refresh", async (t) => {
    const { tabs, state } = harness(t);
    await tabs.onActivated.emit({ tabId: 11, windowId: 7 });
    await tabs.onActivated.emit({ tabId: 12, windowId: 8 });
    assert.deepEqual(state.activated, [11]);
    assert.equal(state.refreshes, 0);
    const events = [
        ["onCreated", (id) => [{ id: 13, windowId: id }]],
        ["onRemoved", (id) => [13, { windowId: id }]],
        ["onMoved", (id) => [13, { windowId: id }]],
        ["onAttached", (id) => [13, { newWindowId: id }]],
        ["onDetached", (id) => [13, { oldWindowId: id }]],
    ];
    for (const [name, args] of events) {
        const before = state.refreshes;
        await tabs[name].emit(...args(8));
        assert.equal(state.refreshes, before, name);
        await tabs[name].emit(...args(7));
        assert.equal(state.refreshes, before + 1, name);
    }
    for (const key of ["title", "url", "favIconUrl", "groupId"]) {
        const before = state.refreshes;
        await tabs.onUpdated.emit(13, { [key]: "changed" }, { windowId: 8 });
        await tabs.onUpdated.emit(13, { status: "complete", audible: true }, { windowId: 7 });
        assert.equal(state.refreshes, before);
        await tabs.onUpdated.emit(13, { [key]: "changed" }, { windowId: 7 });
        assert.equal(state.refreshes, before + 1);
    }
});

test("group changes are window scoped and every bookmark mutation refreshes bookmarks only", async (t) => {
    const { tabGroups, bookmarks, state } = harness(t);
    for (const event of Object.values(tabGroups)) {
        const before = state.refreshes;
        await event.emit({ windowId: 8 });
        assert.equal(state.refreshes, before);
        await event.emit({ windowId: 7 });
        assert.equal(state.refreshes, before + 1);
    }
    for (const event of Object.values(bookmarks)) await event.emit("id", {});
    assert.equal(state.bookmarks, 6);
    assert.equal(state.refreshes, 4);
});

test("storage refreshes only local ordering changes for this window or legacy keys", async (t) => {
    const { storage, state } = harness(t);
    for (const key of [TAB_ORDER_STORAGE_KEY, GROUP_ORDER_STORAGE_KEY, `${TAB_ORDER_WINDOW_PREFIX}7`, `${GROUP_ORDER_WINDOW_PREFIX}7`]) {
        const before = state.refreshes;
        await storage.onChanged.emit({ [key]: {} }, "sync");
        assert.equal(state.refreshes, before);
        await storage.onChanged.emit({ [key]: {} }, "local");
        assert.equal(state.refreshes, before + 1);
    }
    for (const key of [`${TAB_ORDER_WINDOW_PREFIX}8`, `${GROUP_ORDER_WINDOW_PREFIX}8`, "theme", "unrelated"]) await storage.onChanged.emit({ [key]: {} }, "local");
    assert.equal(state.refreshes, 4);
});

test("replacement lookup filters windows, contains failures, and stops after cleanup", async (t) => {
    const { tabs, state, cleanup } = harness(t);
    tabs.get = async () => ({ windowId: 8 });
    await tabs.onReplaced.emit(42, 41);
    assert.equal(state.refreshes, 0);
    tabs.get = async () => ({ windowId: 7 });
    await tabs.onReplaced.emit(42, 41);
    assert.equal(state.refreshes, 1);
    tabs.get = async () => { throw Error("tab disappeared"); };
    await tabs.onReplaced.emit(42, 41);
    assert.equal(state.errors.length, 1);
    let resolve;
    tabs.get = () => new Promise((done) => { resolve = done; });
    const pending = tabs.onReplaced.emit(42, 41);
    cleanup();
    resolve({ windowId: 7 });
    await pending;
    assert.equal(state.refreshes, 1);
});

test("manual and pagehide cleanup remove every listener and are idempotent", async (t) => {
    const { tabs, tabGroups, bookmarks, storage, pagehide, cleanup } = harness(t);
    const sources = [...Object.values(tabs), ...Object.values(tabGroups), ...Object.values(bookmarks), storage.onChanged, pagehide];
    assert.ok(sources.every((source) => source.listeners.size === 1));
    await pagehide.emit();
    cleanup();
    assert.ok(sources.every((source) => source.listeners.size === 0));
});
