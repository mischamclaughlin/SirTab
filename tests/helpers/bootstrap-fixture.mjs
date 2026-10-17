const assert = (condition, message) => { if (!condition) throw new Error(message); };
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const until = async (read, message) => {
    for (let i = 0; i < 100; i++) {
        if (read()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(message);
};
function eventSource() {
    const listeners = new Set();
    return {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
        emit: (...args) => { for (const listener of listeners) listener(...args); },
    };
}

export async function run(scenario) {
    const errors = [];
    const unhandled = [];
    window.addEventListener('unhandledrejection', (event) => { unhandled.push(String(event.reason)); event.preventDefault(); });
    console.error = (...args) => errors.push(args.join(' '));
    document.body.innerHTML = '<div id="actions"></div><main id="sidebar-content"><ul id="tabs-list"></ul><ul id="groups-list"></ul><ul id="bookmarks-list"></ul></main><div id="settings"></div>';
    let tabs = [
        { id: 11, windowId: 1, index: 0, groupId: -1, title: 'First', url: 'https://first.test/', active: true },
        { id: 12, windowId: 1, index: 1, groupId: 21, title: 'Second', url: 'https://second.test/', active: false },
    ];
    const group = { id: 21, windowId: 1, title: 'Projects', color: 'blue', collapsed: false };
    const tree = [{ id: '0', children: [{ id: '1', title: 'Bookmarks bar', children: [{ id: '31', title: 'Reference', url: 'https://reference.test/' }] }] }];
    const storage = { orderFingerprintsSha256Migrated: true, shortcutPromptDismissed: true };
    if (scenario === 'initial-search') storage['collapsedGroupsByWindow:1'] = ['21'];
    let failBookmarks = scenario === 'bookmark-failure';
    let failTabs = scenario === 'tab-failure';
    let heldQuery;
    let queryStarted = false;
    let tabLoads = 0;
    globalThis.chrome = {
        runtime: { getURL: (path) => path },
        commands: { getAll: async () => [] },
        sidePanel: { onOpened: eventSource() },
        windows: { getCurrent: async () => ({ id: 1 }), getAll: async () => [{ id: 1 }], onRemoved: eventSource() },
        tabs: {
            ...Object.fromEntries(['onCreated','onRemoved','onUpdated','onMoved','onAttached','onDetached','onActivated','onReplaced'].map((key) => [key, eventSource()])),
            query: async () => {
                tabLoads++;
                if (failTabs) throw new Error('tabs unavailable');
                const snapshot = structuredClone(tabs);
                if (heldQuery) { const current = heldQuery; heldQuery = null; queryStarted = true; await current.promise; }
                return snapshot;
            },
            get: async (id) => structuredClone(tabs.find((tab) => tab.id === id)),
            update: async () => {},
        },
        tabGroups: {
            ...Object.fromEntries(['onCreated','onRemoved','onUpdated','onMoved'].map((key) => [key, eventSource()])),
            TAB_GROUP_ID_NONE: -1, query: async () => [structuredClone(group)], update: async () => {},
        },
        bookmarks: {
            ...Object.fromEntries(['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportEnded'].map((key) => [key, eventSource()])),
            getTree: async () => { if (failBookmarks) throw new Error('bookmarks unavailable'); return structuredClone(tree); },
        },
        storage: {
            onChanged: eventSource(),
            local: {
                get: async (keys) => {
                    if (scenario === 'preference-failure' && keys !== null && !String(keys).includes('Order')) throw new Error('preferences unavailable');
                    return structuredClone(keys == null ? storage : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]])));
                },
                set: async (updates) => Object.assign(storage, structuredClone(updates)),
                remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
            },
        },
    };
    const { bootstrapSidebar } = await import('../../dist/sidebar/helpers/bootstrap.js');
    const row = (id) => document.querySelector(`[data-tab-id="${id}"]`);
    const current = (id) => row(id)?.querySelector('[aria-current="page"]');
    const bookmark = () => document.querySelector('[data-bookmark-id="31"]');
    if (scenario === 'initial-activation' || scenario === 'initial-search') heldQuery = deferred();
    const initialQuery = heldQuery;
    if (scenario === 'entrypoint') {
        await import('../../dist/sidebar/sidebar.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
    } else {
        await bootstrapSidebar();
    }
    if (initialQuery) {
        await until(() => queryStarted, 'initial load did not start');
        if (scenario === 'initial-search') {
            const search = document.querySelector('.search-input');
            search.value = 'Projects';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            assert(storage['collapsedGroupsByWindow:1']?.includes('21'), 'search before the first load erased saved collapse state');
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            for (const tab of tabs) tab.active = tab.id === 12;
            chrome.tabs.onActivated.emit({ tabId: 12, windowId: 1 });
        }
        initialQuery.resolve();
    }
    if (failBookmarks) {
        await until(() => row(11), 'bookmark failure blocked tabs');
        assert(!bookmark(), 'failed bookmark request unexpectedly rendered');
        failBookmarks = false;
        chrome.bookmarks.onCreated.emit('31', tree[0].children[0].children[0]);
        await until(bookmark, 'bookmark event did not recover failed initial load');
    } else if (failTabs) {
        await until(bookmark, 'tab failure blocked bookmarks');
        failTabs = false;
        chrome.tabs.onCreated.emit(tabs[0]);
        await until(() => row(11), 'tab event did not recover failed initial load');
    } else {
        await until(() => row(11) && bookmark(), 'initial sidebar did not render');
    }
    assert(document.querySelector('[aria-label="Settings"]'), 'settings missing after startup');
    if (scenario === 'initial-search') {
        assert(document.querySelector('[data-group-id="21"] .group-tabs')?.hidden, 'saved collapse state should survive loading while searching');
    }
    if (scenario === 'initial-activation') {
        await until(() => current(12), 'initial load lost an activation for an uncached tab');
        assert(!current(11), 'initial stale tab remained active');
    }
    if (scenario === 'races') {
        // The query captures the old active state, then activation arrives before it resolves.
        heldQuery = deferred();
        const pending = heldQuery;
        queryStarted = false;
        chrome.tabs.onUpdated.emit(11, { title: 'First' }, tabs[0]);
        await until(() => queryStarted, 'refresh did not start');
        const rowBeforeRefresh = row(11);
        for (const tab of tabs) tab.active = tab.id === 12;
        chrome.tabs.onActivated.emit({ tabId: 12, windowId: 1 });
        pending.resolve();
        await until(() => row(11) !== rowBeforeRefresh && current(12), 'refresh overwrote a newer activation');
        assert(!current(11), 'two active rows after refresh');
        // Group-title matches include their members; clearing search restores all rows.
        const search = document.querySelector('.search-input');
        search.value = 'nothing-matches-this-query';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => document.querySelector('#groups-list .empty-search-state-message') && document.querySelector('#bookmarks-list .empty-search-state-message'), 'empty search should explain missing results in both sections');
        search.value = 'Projects';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => !row(11) && row(12), 'group-title search did not show its members');
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => row(11), 'cleared search did not restore tabs');
        document.querySelector('[aria-label^="Select tabs"]').click();
        row(11).querySelector('.tab-button').click();
        await until(() => document.querySelector('.selection-summary')?.textContent === '1 selected', 'selection did not render');
        tabs = tabs.filter((tab) => tab.id !== 11);
        chrome.tabs.onRemoved.emit(11, { windowId: 1 });
        await until(() => !row(11) && document.querySelector('.selection-summary')?.textContent === '0 selected', 'closed tab was not pruned from selection');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => !document.querySelector('.selection-summary'), 'Escape did not leave selection mode');
        const before = tabLoads;
        chrome.tabs.onCreated.emit({ id: 90, windowId: 2 });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert(tabLoads === before, 'another window triggered a data refresh');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(unhandled.length === 0, `unhandled rejections: ${unhandled.join('; ')}`);
    if (scenario.endsWith('failure')) assert(errors.length > 0, 'failure scenario was not exercised');
}
