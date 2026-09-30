import assert from "node:assert/strict";
import test from "node:test";

import { setupEventListeners } from "../dist/sidebar/helpers/events.js";

function eventSource() {
    const listeners = new Set();
    return {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
        emit(...args) {
            for (const listener of listeners) listener(...args);
        },
    };
}

test("tab activation updates the current tab without a full refresh", () => {
    const originalChrome = globalThis.chrome;
    const originalWindow = globalThis.window;
    const tabs = Object.fromEntries([
        "onCreated", "onRemoved", "onUpdated", "onMoved", "onAttached",
        "onDetached", "onActivated", "onReplaced",
    ].map((name) => [name, eventSource()]));
    const tabGroups = Object.fromEntries([
        "onCreated", "onRemoved", "onUpdated", "onMoved",
    ].map((name) => [name, eventSource()]));
    const bookmarks = Object.fromEntries([
        "onCreated", "onRemoved", "onChanged", "onMoved",
        "onChildrenReordered", "onImportEnded",
    ].map((name) => [name, eventSource()]));
    globalThis.chrome = {
        tabs,
        tabGroups,
        bookmarks,
        storage: { onChanged: eventSource() },
    };
    globalThis.window = { addEventListener() {} };

    try {
        const activated = [];
        let refreshes = 0;
        const cleanup = setupEventListeners(7, {
            activateTab: (tabId) => activated.push(tabId),
            requestTabGroupRefresh: () => { refreshes += 1; },
            requestBookmarkRefresh: () => {},
        });

        tabs.onActivated.emit({ tabId: 11, windowId: 7 });
        tabs.onActivated.emit({ tabId: 12, windowId: 8 });
        assert.deepEqual(activated, [11]);
        assert.equal(refreshes, 0);

        tabs.onCreated.emit({ id: 13, windowId: 7 });
        assert.equal(refreshes, 1);
        cleanup();
        tabs.onActivated.emit({ tabId: 14, windowId: 7 });
        assert.deepEqual(activated, [11]);
    } finally {
        globalThis.chrome = originalChrome;
        globalThis.window = originalWindow;
    }
});
