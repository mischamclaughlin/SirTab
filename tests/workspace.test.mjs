import assert from 'node:assert/strict';
import test from 'node:test';

function eventSource() {
    const listeners = new Set();
    return {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener),
        emit: (...args) => { for (const listener of [...listeners]) listener(...args); },
    };
}
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const clone = value => structuredClone(value);
const ids = value => Array.isArray(value) ? value : [value];
let state;
const tabsEvents = Object.fromEntries(['onCreated', 'onUpdated', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onRemoved'].map(name => [name, eventSource()]));
const groupEvents = Object.fromEntries(['onCreated', 'onUpdated', 'onMoved', 'onRemoved'].map(name => [name, eventSource()]));
const windowEvents = Object.fromEntries(['onCreated', 'onRemoved'].map(name => [name, eventSource()]));
const storageEvent = eventSource();
function read(storage, keys) {
    return clone(keys == null ? storage : Object.fromEntries(ids(keys).map(key => [key, storage[key]])));
}
function reset({ tabs = [], groups = [], windows = [{ id: 7, type: 'normal', incognito: false }], storage = {}, session = {} } = {}) {
    state = { tabs: clone(tabs), groups: clone(groups), windows: clone(windows),
        storage: { orderFingerprintsSha256Migrated: true, ...clone(storage) }, session: clone(session),
        nextTab: 1000, nextGroup: 500, nextWindow: 20, createdTabs: [], createdWindows: [],
        createAttempts: 0, failCreateAt: null, blockQuery: null,
    };
    storageEvent.emit({}, 'local');
}
function tab(id, url = `https://example.test/${id}`, groupId = -1, windowId = 7) {
    return { id, url, title: `Tab ${id}`, groupId, windowId, index: id, pinned: false, active: false, incognito: false };
}
function nativeGroup(id, title, color = 'blue', windowId = 7) {
    return { id, title, color, windowId, collapsed: false, shared: false };
}
function snapshot(tabs, groups = [], windowId = 7) {
    return { version: 1, windowId, sessionId: 'previous-browser-session', updatedAt: 1000,
        tabs: tabs.map(value => ({ id: value.id, url: value.url, title: value.title, pinned: !!value.pinned, active: !!value.active, groupId: value.groupId })), groups };
}
function pruneGroups() {
    for (const group of [...state.groups]) {
        if (!state.tabs.some(tab => tab.groupId === group.id)) {
            state.groups.splice(state.groups.indexOf(group), 1);
            groupEvents.onRemoved.emit(clone(group));
        }
    }
}
reset();
globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://sir-tab/${path}`, onStartup: eventSource(), onInstalled: eventSource() },
    storage: {
        onChanged: storageEvent,
        local: {
            get: async keys => read(state.storage, keys),
            set: async updates => {
                const changes = Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, { oldValue: clone(state.storage[key]), newValue: clone(value) }]));
                Object.assign(state.storage, clone(updates));
                storageEvent.emit(changes, 'local');
            },
            remove: async keys => {
                const changes = {};
                for (const key of ids(keys)) { changes[key] = { oldValue: clone(state.storage[key]) }; delete state.storage[key]; }
                storageEvent.emit(changes, 'local');
            },
        },
        session: {
            get: async keys => read(state.session, keys),
            set: async updates => Object.assign(state.session, clone(updates)),
            remove: async keys => { for (const key of ids(keys)) delete state.session[key]; },
        },
    },
    windows: {
        ...windowEvents,
        getAll: async options => state.windows.filter(window => !options?.windowTypes || options.windowTypes.includes(window.type)).map(window => ({ ...clone(window), ...(options?.populate ? { tabs: clone(state.tabs.filter(tab => tab.windowId === window.id)) } : {}) })),
        create: async options => {
            const window = { id: state.nextWindow++, type: 'normal', incognito: false };
            state.windows.push(window); state.createdWindows.push(clone(window));
            const initial = tab(state.nextTab++, options?.url ?? 'chrome://newtab/', -1, window.id);
            initial.index = 0; state.tabs.push(initial);
            windowEvents.onCreated.emit(clone(window));
            return clone(window);
        },
    },
    tabs: {
        ...tabsEvents,
        query: async query => {
            if (state.blockQuery && query?.windowId === state.blockQuery.windowId) {
                const gate = state.blockQuery;
                state.blockQuery = null;
                gate.started.resolve();
                await gate.release.promise;
            }
            return clone(state.tabs.filter(tab => (query?.windowId == null || tab.windowId === query.windowId) && (query?.active == null || tab.active === query.active)));
        },
        get: async id => {
            const value = state.tabs.find(tab => tab.id === id);
            if (!value) throw Error(`Missing tab ${id}`);
            return clone(value);
        },
        create: async options => {
            state.createAttempts++;
            if (state.createAttempts === state.failCreateAt) throw Error('Injected tab creation interruption');
            const value = { ...tab(state.nextTab++, options.url, -1, options.windowId), pinned: !!options.pinned, active: !!options.active };
            value.index = state.tabs.filter(tab => tab.windowId === value.windowId).length;
            state.tabs.push(value); state.createdTabs.push(clone(value));
            tabsEvents.onCreated.emit(clone(value));
            return clone(value);
        },
        update: async (id, changes) => {
            const value = state.tabs.find(tab => tab.id === id);
            if (!value) throw Error(`Missing tab ${id}`);
            Object.assign(value, changes);
            tabsEvents.onUpdated.emit(id, clone(changes), clone(value));
            return clone(value);
        },
        group: async ({ tabIds, groupId, createProperties }) => {
            const moving = ids(tabIds);
            const id = groupId ?? state.nextGroup++;
            if (groupId == null) {
                const group = nativeGroup(id, '', 'grey', createProperties.windowId);
                state.groups.push(group); groupEvents.onCreated.emit(clone(group));
            }
            if (!state.groups.some(group => group.id === id)) throw Error(`Missing group ${id}`);
            for (const value of state.tabs) if (moving.includes(value.id)) value.groupId = id;
            pruneGroups();
            return id;
        },
        ungroup: async tabIds => {
            const moving = ids(tabIds);
            for (const value of state.tabs) if (moving.includes(value.id)) value.groupId = -1;
            pruneGroups();
        },
        remove: async tabIds => {
            for (const id of ids(tabIds)) {
                const value = state.tabs.find(tab => tab.id === id);
                if (!value) continue;
                state.tabs.splice(state.tabs.indexOf(value), 1);
                tabsEvents.onRemoved.emit(id, { windowId: value.windowId, isWindowClosing: false });
            }
            pruneGroups();
        },
    },
    tabGroups: {
        ...groupEvents,
        TAB_GROUP_ID_NONE: -1,
        query: async query => clone(state.groups.filter(group => query?.windowId == null || group.windowId === query.windowId)),
        get: async id => {
            const value = state.groups.find(group => group.id === id);
            if (!value) throw Error(`Missing group ${id}`);
            return clone(value);
        },
        update: async (id, changes) => {
            const value = state.groups.find(group => group.id === id);
            if (!value) throw Error(`Missing group ${id}`);
            Object.assign(value, changes);
            groupEvents.onUpdated.emit(clone(value));
            return clone(value);
        },
    },
};
const { setupWorkspacePersistence } = await import('../dist/background/workspace.js');
const { loadLogicalTabGroupData } = await import('../dist/shared/groupOrder.js');
function controller(t) {
    const instance = setupWorkspacePersistence();
    t.after(() => instance.dispose());
    return instance;
}

test('background capture records tab changes without opening a sidebar and excludes incognito and extension UI', async t => {
    reset({
        tabs: [tab(1), tab(2, 'chrome-extension://sir-tab/sidebar/sidebar.html'), tab(3, 'https://private.example/', -1, 8)],
        windows: [{ id: 7, type: 'normal', incognito: false }, { id: 8, type: 'normal', incognito: true }],
        session: { workspaceRecoveryComplete: true },
    });
    const instance = controller(t);
    await instance.ready;
    await instance.captureWindow(8);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs.map(tab => tab.id), [1]);
    assert.equal(state.storage['workspaceSnapshot:8'], undefined);
    state.tabs[0].url = 'https://navigated.example/';
    tabsEvents.onUpdated.emit(1, { url: state.tabs[0].url }, clone(state.tabs[0]));
    await instance.captureWindow(7);
    assert.equal(state.storage['workspaceSnapshot:7'].tabs[0].url, 'https://navigated.example/');
    assert.equal(JSON.stringify(Object.entries(state.storage).filter(([key]) => key.startsWith('workspaceSnapshot:'))).includes('private.example'), false);
});

test('a queued capture cannot replace the workspace with a closing window inventory', async t => {
    reset({ tabs: [tab(1), tab(2), tab(3)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    const saved = clone(state.storage['workspaceSnapshot:7']);
    tabsEvents.onMoved.emit(1, { windowId: 7 });
    state.tabs = [tab(1)];
    tabsEvents.onRemoved.emit(2, { windowId: 7, isWindowClosing: true });
    state.windows = [];
    windowEvents.onRemoved.emit(7);
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs, saved.tabs);
    assert.equal(state.storage['workspaceSnapshot:7'].updatedAt, saved.updatedAt);
    assert.ok(state.storage['workspaceSnapshot:7'].closedAt);
});

test('a closing event invalidates a capture already awaiting the browser inventory', async t => {
    reset({ tabs: [tab(1), tab(2), tab(3)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    const saved = clone(state.storage['workspaceSnapshot:7']);
    const gate = { windowId: 7, started: deferred(), release: deferred() };
    state.blockQuery = gate;
    const capture = instance.captureWindow(7);
    await gate.started.promise;
    state.tabs = [tab(1)];
    tabsEvents.onRemoved.emit(2, { windowId: 7, isWindowClosing: true });
    gate.release.resolve();
    await capture;
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs, saved.tabs);
    assert.equal(state.storage['workspaceSnapshot:7'].updatedAt, saved.updatedAt);
});

test('an individually closed tab stays closed when the remaining workspace is restored', async t => {
    reset({ tabs: [tab(1), tab(2), tab(3)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    await chrome.tabs.remove(2);
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs.map(tab => tab.id), [1, 3]);
    await instance.restore();
    assert.deepEqual(state.tabs.map(tab => tab.url).sort(), ['https://example.test/1', 'https://example.test/3']);
    assert.equal(state.createdTabs.length, 0);
});

test('repeated restoration preserves duplicate URL multiplicity without creating extra tabs', async t => {
    const saved = snapshot([tab(1, 'https://same.example/'), tab(2, 'https://same.example/')]);
    reset({ tabs: [tab(800, 'chrome://newtab/', -1, 8)], windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    const instance = controller(t);
    await instance.ready;
    assert.equal(state.createdTabs.length, 2);
    assert.deepEqual(state.tabs.map(tab => tab.url), ['https://same.example/', 'https://same.example/']);
    await instance.restore();
    await instance.restore();
    assert.equal(state.createdTabs.length, 2);
    assert.equal(state.tabs.length, 2);
    assert.equal(state.storage.workspaceRecoveryJournal, undefined);
});

test('browser-restored tabs and separate groups are reused, retaining logical order and empty groups', async t => {
    const same = 'https://same.example/';
    const saved = snapshot([tab(3, 'https://outside.example/'), tab(2, same, 20), tab(1, same, 10)], [
        { id: 20, title: 'Second', color: 'green', collapsed: false },
        { id: 30, title: 'Empty', color: 'pink', collapsed: false },
        { id: 10, title: 'First', color: 'blue', collapsed: false },
    ]);
    reset({ tabs: [tab(101, same, 100, 8), tab(102, same, 200, 8), tab(103, 'https://outside.example/', -1, 8)],
        groups: [nativeGroup(100, 'First', 'blue', 8), nativeGroup(200, 'Second', 'green', 8)],
        windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    const instance = controller(t);
    await instance.ready;
    assert.equal(state.createdTabs.length, 0);
    assert.equal(state.groups.length, 2);
    assert.notEqual(state.tabs.find(tab => tab.id === 101).groupId, state.tabs.find(tab => tab.id === 102).groupId);
    const data = await loadLogicalTabGroupData(8);
    assert.deepEqual(data.groupOrder, [20, 30, 10]);
    assert.deepEqual(data.tabOrder, [103, 102, 101]);
    assert.deepEqual(data.tabs.map(tab => tab.groupId), [-1, 20, 10]);
    assert.equal(data.groups.find(group => group.id === 30).title, 'Empty');
});

test('a partial recovery resumes from its durable journal without duplicating identical URLs', async t => {
    const saved = snapshot([tab(1, 'https://same.example/'), tab(2, 'https://same.example/'), tab(3, 'https://third.example/')]);
    reset({ tabs: [tab(800, 'chrome://newtab/', -1, 8)], windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    t.mock.method(console, 'error', () => {});
    state.failCreateAt = 2;
    const failed = controller(t);
    await assert.rejects(failed.ready, /Injected tab creation interruption/);
    assert.equal(state.createdTabs.length, 1);
    assert.equal(state.storage.workspaceRecoveryJournal.windows['7'], 8);
    assert.ok(state.storage.workspaceRecoveryJournal.tabs['7']['1']);
    failed.dispose();
    state.failCreateAt = null;
    const resumed = controller(t);
    await resumed.ready;
    assert.equal(state.createdTabs.length, 3);
    assert.deepEqual(state.tabs.map(tab => tab.url).sort(), ['https://same.example/', 'https://same.example/', 'https://third.example/']);
    assert.equal(state.storage.workspaceRecoveryJournal, undefined);
});

test('matching windows with identical URL inventories restore into distinct existing windows', async t => {
    const first = snapshot([tab(1, 'https://same.example/')], [{ id: 10, title: 'First empty', color: 'blue', collapsed: false }], 7);
    const second = snapshot([tab(2, 'https://same.example/', -1, 9)], [{ id: 20, title: 'Second empty', color: 'green', collapsed: false }], 9);
    reset({ tabs: [tab(101, 'https://same.example/', -1, 8), tab(102, 'https://same.example/', -1, 10)],
        windows: [{ id: 8, type: 'normal', incognito: false }, { id: 10, type: 'normal', incognito: false }],
        storage: { 'workspaceSnapshot:7': first, 'workspaceSnapshot:9': second } });
    const instance = controller(t);
    await instance.ready;
    assert.equal(state.createdTabs.length, 0);
    assert.equal(state.createdWindows.length, 0);
    assert.equal(state.tabs.length, 2);
    const names = [8, 10].flatMap(windowId => state.storage[`workspaceSnapshot:${windowId}`].groups.map(group => group.title)).sort();
    assert.deepEqual(names, ['First empty', 'Second empty']);
});

test('reopening the last closed window restores within a still-running browser session', async t => {
    reset({ tabs: [tab(1), tab(2)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    state.tabs = []; state.windows = [];
    tabsEvents.onRemoved.emit(1, { windowId: 7, isWindowClosing: true });
    windowEvents.onRemoved.emit(7);
    await instance.captureWindow(7);
    assert.equal(state.session.workspaceNeedsRecovery, true);
    state.windows = [{ id: 8, type: 'normal', incognito: false }];
    state.tabs = [tab(800, 'chrome://newtab/', -1, 8)];
    windowEvents.onCreated.emit(clone(state.windows[0]));
    await instance.captureWindow(8);
    assert.deepEqual(state.tabs.map(tab => tab.url).sort(), ['https://example.test/1', 'https://example.test/2']);
    assert.equal(state.session.workspaceNeedsRecovery, false);
});

test('a temporary page address does not leave the previous page in the saved workspace', async t => {
    reset({ tabs: [tab(1)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    state.tabs[0].url = 'data:text/plain,temporary';
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs, []);
});

test('a transient recovery failure retries automatically without creating duplicate tabs', async t => {
    const saved = snapshot([tab(1), tab(2)]);
    reset({ tabs: [tab(800, 'chrome://newtab/', -1, 8)], windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    t.mock.method(console, 'error', () => {});
    state.failCreateAt = 2;
    const instance = controller(t);
    await assert.rejects(instance.ready, /Injected tab creation interruption/);
    const deadline = Date.now() + 4000;
    while (!state.session.workspaceRecoveryComplete && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(state.session.workspaceRecoveryComplete, true);
    assert.deepEqual(state.tabs.map(tab => tab.url).sort(), ['https://example.test/1', 'https://example.test/2']);
    assert.equal(state.createdTabs.length, 2);
});

test('recovery separates saved groups even if the browser restored their tabs into one group', async t => {
    const saved = snapshot([tab(1, 'https://one.example/', 10), tab(2, 'https://two.example/', 20)], [
        { id: 10, title: 'First', color: 'blue', collapsed: false },
        { id: 20, title: 'Second', color: 'green', collapsed: false },
    ]);
    reset({ tabs: [tab(101, 'https://one.example/', 100, 8), tab(102, 'https://two.example/', 100, 8)], groups: [nativeGroup(100, 'Merged', 'blue', 8)],
        windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    const instance = controller(t);
    await instance.ready;
    const data = await loadLogicalTabGroupData(8);
    assert.deepEqual(data.groupOrder, [10, 20]);
    assert.deepEqual(data.tabs.map(tab => tab.groupId), [10, 20]);
    assert.notEqual(state.tabs[0].groupId, state.tabs[1].groupId);
});

test('an interrupted multi-window recovery retains the original complete workspace', async t => {
    const first = snapshot([tab(1, 'https://first.example/')], [], 7);
    const second = snapshot([tab(2, 'https://second.example/', -1, 9)], [], 9);
    reset({ tabs: [tab(800, 'chrome://newtab/', -1, 8)], windows: [{ id: 8, type: 'normal', incognito: false }],
        storage: { 'workspaceSnapshot:7': first, 'workspaceSnapshot:9': second } });
    t.mock.method(console, 'error', () => {});
    state.failCreateAt = 2;
    const interrupted = controller(t);
    await assert.rejects(interrupted.ready, /Injected tab creation interruption/);
    assert.equal(state.storage.workspaceRecoveryJournal.snapshots.length, 2);
    interrupted.dispose();
    state.failCreateAt = null;
    const resumed = controller(t);
    await resumed.ready;
    assert.deepEqual(state.tabs.map(tab => tab.url).sort(), ['https://first.example/', 'https://second.example/']);
    assert.equal(new Set(state.tabs.map(tab => tab.windowId)).size, 2);
    assert.equal(state.createdTabs.length, 2);
});

test('a tab opened immediately before window closure is saved without waiting for the capture timer', async t => {
    reset({ tabs: [tab(1)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    const created = tab(2);
    state.tabs.push(created);
    tabsEvents.onCreated.emit(clone(created));
    state.tabs = []; state.windows = [];
    tabsEvents.onRemoved.emit(1, { windowId: 7, isWindowClosing: true });
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs.map(tab => tab.url), ['https://example.test/1', 'https://example.test/2']);
});

test('durable ordering and a newly created empty group survive immediate closure', async t => {
    reset({ tabs: [tab(1, 'https://one.example/', 10), tab(2, 'https://two.example/', 20)], groups: [nativeGroup(10, 'First'), nativeGroup(20, 'Second')], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    await instance.captureWindow(7);
    const groupOrder = clone(state.storage['groupOrderSnapshot:7']);
    groupOrder.order = [20, 10];
    await chrome.storage.local.set({ 'groupOrderByWindow:7': groupOrder, 'groupOrderSnapshot:7': groupOrder });
    await chrome.storage.local.set({ 'persistentGroups:7': [...state.storage['persistentGroups:7'], { id: -222, windowId: 7, title: 'Empty', color: 'pink', collapsed: false, shared: false, nativeId: null, members: [] }] });
    state.tabs = []; state.windows = [];
    tabsEvents.onRemoved.emit(1, { windowId: 7, isWindowClosing: true });
    await instance.captureWindow(7);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].groups.map(group => group.id), [20, 10, -222]);
});

test('moving the final tab out of a window does not restore a duplicate copy', async t => {
    reset({ tabs: [tab(1), tab(2, 'https://second.example/', -1, 8)], windows: [{ id: 7, type: 'normal', incognito: false }, { id: 8, type: 'normal', incognito: false }], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    state.tabs[0].windowId = 8;
    tabsEvents.onDetached.emit(1, { oldWindowId: 7, oldPosition: 0 });
    state.windows = state.windows.filter(window => window.id !== 7);
    windowEvents.onRemoved.emit(7);
    tabsEvents.onAttached.emit(1, { newWindowId: 8, newPosition: 1 });
    await new Promise(resolve => setImmediate(resolve));
    await instance.captureWindow(8);
    assert.deepEqual(state.storage['workspaceSnapshot:7'].tabs, []);
    await instance.restore();
    assert.equal(state.tabs.length, 2);
    assert.equal(state.createdTabs.length, 0);
    assert.equal(state.createdWindows.length, 0);
});

test('an individual tab closed during recovery is removed from the recovery journal', async t => {
    const saved = snapshot([tab(1, 'https://one.example/'), tab(2, 'https://two.example/')]);
    reset({ tabs: [tab(101, 'https://one.example/', -1, 8)], windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    const create = chrome.tabs.create;
    t.mock.method(chrome.tabs, 'create', async details => {
        state.tabs = state.tabs.filter(tab => tab.id !== 101);
        tabsEvents.onRemoved.emit(101, { windowId: 8, isWindowClosing: false });
        return create(details);
    });
    const instance = controller(t);
    await instance.ready;
    assert.deepEqual(state.tabs.map(tab => tab.url), ['https://two.example/']);
    await instance.restore();
    assert.deepEqual(state.tabs.map(tab => tab.url), ['https://two.example/']);
});

test('closing one of two identical URLs during recovery retains the surviving tab in its own group', async t => {
    const same = 'https://same.example/';
    const saved = snapshot([tab(2, same, 20), tab(1, same, 10)], [
        { id: 20, title: 'Second', color: 'green', collapsed: false },
        { id: 10, title: 'First', color: 'blue', collapsed: false },
    ]);
    reset({ tabs: [tab(101, same, 100, 8), tab(102, same, 200, 8)], groups: [nativeGroup(100, 'First', 'blue', 8), nativeGroup(200, 'Second', 'green', 8)],
        windows: [{ id: 8, type: 'normal', incognito: false }], storage: { 'workspaceSnapshot:7': saved } });
    const query = chrome.tabGroups.query;
    let closed = false;
    t.mock.method(chrome.tabGroups, 'query', async options => {
        if (!closed) {
            closed = true;
            const removed = state.groups.find(group => group.id === 100);
            state.tabs = state.tabs.filter(tab => tab.id !== 101);
            state.groups = state.groups.filter(group => group.id !== 100);
            groupEvents.onRemoved.emit(clone(removed));
            tabsEvents.onRemoved.emit(101, { windowId: 8, isWindowClosing: false });
        }
        return query(options);
    });
    const instance = controller(t);
    await instance.ready;
    const data = await loadLogicalTabGroupData(8);
    assert.equal(state.createdTabs.length, 0);
    assert.deepEqual(data.tabs.map(tab => ({ id: tab.id, groupId: tab.groupId })), [{ id: 102, groupId: 20 }]);
});

test('a background-only browser does not reopen windows until the user opens one', async t => {
    reset({ tabs: [], windows: [], storage: { 'workspaceSnapshot:7': snapshot([tab(1)]) } });
    const instance = controller(t);
    await instance.ready;
    assert.equal(state.createdWindows.length, 0);
    assert.equal(state.createdTabs.length, 0);
    assert.equal(state.session.workspaceNeedsRecovery, true);
    state.windows = [{ id: 8, type: 'normal', incognito: false }];
    state.tabs = [tab(800, 'chrome://newtab/', -1, 8)];
    windowEvents.onCreated.emit(clone(state.windows[0]));
    await instance.captureWindow(8);
    assert.deepEqual(state.tabs.map(tab => tab.url), ['https://example.test/1']);
});

test('browser restart commands retain the committed page and are never saved for replay', async t => {
    reset({ tabs: [tab(1)], session: { workspaceRecoveryComplete: true } });
    const instance = controller(t);
    await instance.ready;
    for (const command of ['chrome://restart/', 'brave://quit/', 'edge://crash/', 'about:restart', 'chrome://%72estart/']) {
        state.tabs[0].pendingUrl = command;
        tabsEvents.onUpdated.emit(1, { url: command }, clone(state.tabs[0]));
        await instance.captureWindow(7);
        assert.equal(state.storage['workspaceSnapshot:7'].tabs[0].url, 'https://example.test/1');
        assert.equal(JSON.stringify(state.storage['workspaceSnapshot:7']).includes(command), false);
    }
});
