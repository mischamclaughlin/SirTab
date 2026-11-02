import assert from 'node:assert/strict';
import test from 'node:test';

let tabs, groups, storage, session, nextId, failUpdate, failWrite;
const prune = () => { groups = groups.filter(group => tabs.some(tab => tab.groupId === group.id)); };
const reset = () => {
    tabs = [{ id: 1, windowId: 7, groupId: -1, url: 'https://one.test/', index: 0 }];
    groups = []; storage = {}; session = {}; nextId = 100; failUpdate = false; failWrite = false;
};
reset();
globalThis.chrome = {
    storage: {
        local: {
            get: async key => structuredClone(key == null ? storage : { [key]: storage[key] }),
            set: async updates => {
                if (failWrite) { failWrite = false; throw new Error('Storage unavailable'); }
                Object.assign(storage, structuredClone(updates));
            },
        },
        session: {
            get: async key => ({ [key]: session[key] }),
            set: async updates => Object.assign(session, updates),
        },
    },
    tabs: {
        query: async ({ windowId }) => structuredClone(tabs.filter(tab => tab.windowId === windowId)),
        group: async ({ groupId, tabIds, createProperties }) => {
            const id = groupId ?? nextId++;
            if (groupId == null) groups.push({ id, windowId: createProperties.windowId, title: '', color: 'grey', collapsed: false, shared: false });
            if (!groups.some(group => group.id === id)) throw new Error('Missing native group');
            for (const tab of tabs) if (tabIds.includes(tab.id)) tab.groupId = id;
            prune();
            return id;
        },
        ungroup: async tabIds => { for (const tab of tabs) if (tabIds.includes(tab.id)) tab.groupId = -1; prune(); },
    },
    tabGroups: {
        query: async ({ windowId }) => structuredClone(groups.filter(group => group.windowId === windowId)),
        get: async id => {
            const group = groups.find(group => group.id === id);
            if (!group) throw new Error('Missing native group');
            return structuredClone(group);
        },
        update: async (id, changes) => {
            if (failUpdate) { failUpdate = false; throw new Error('Update unavailable'); }
            Object.assign(groups.find(group => group.id === id), changes);
        },
    },
};
const { createPersistentGroup, reconcilePersistentGroups, groupTabsPersistently, restorePersistentGroups, updatePersistentGroup } = await import('../dist/shared/persistentGroups.js');

test('an empty group keeps its identity and metadata through native recreation', async () => {
    reset();
    const group = await createPersistentGroup(7, 'Work', 'blue');
    assert.equal(groups.length, 0);
    await groupTabsPersistently([1], group.id, 7);
    let data = await reconcilePersistentGroups(7);
    assert.equal(data.tabs[0].groupId, group.id);
    assert.equal(groups[0].title, 'Work');
    const nativeId = groups[0].id;
    await chrome.tabs.ungroup([1]);
    data = await reconcilePersistentGroups(7);
    assert.equal(data.groups[0].id, group.id);
    await updatePersistentGroup(group.id, 7, { title: 'Projects', color: 'green' });
    await groupTabsPersistently([1], group.id, 7);
    assert.notEqual(groups[0].id, nativeId);
    assert.equal(groups[0].title, 'Projects');
    assert.equal(groups[0].color, 'green');
    assert.equal((await reconcilePersistentGroups(7)).tabs[0].groupId, group.id);
});

test('a new native group with the same label does not consume an empty sidebar group', async () => {
    reset();
    const saved = await createPersistentGroup(7, 'Work', 'blue');
    await groupTabsPersistently([1], saved.id, 7);
    await chrome.tabs.ungroup([1]);
    await reconcilePersistentGroups(7);
    const nativeId = await chrome.tabs.group({ tabIds: [1], createProperties: { windowId: 7 } });
    await chrome.tabGroups.update(nativeId, { title: 'Work', color: 'blue' });
    const data = await reconcilePersistentGroups(7);
    assert.equal(data.groups.length, 2);
    assert.notEqual(data.tabs[0].groupId, saved.id);
});

test('concurrent group creation retains every group', async () => {
    reset();
    await Promise.all(['First', 'Second', 'Third'].map(name => createPersistentGroup(7, name, 'grey')));
    assert.deepEqual((await reconcilePersistentGroups(7)).groups.map(group => group.title), ['First', 'Second', 'Third']);
});

for (const failure of ['metadata', 'storage']) {
    test(`failed first-tab ${failure} restores the original source group`, async () => {
        reset();
        const sourceId = await chrome.tabs.group({ tabIds: [1], createProperties: { windowId: 7 } });
        await chrome.tabGroups.update(sourceId, { title: 'Source', color: 'green' });
        await reconcilePersistentGroups(7);
        const target = await createPersistentGroup(7, 'Target', 'blue');
        if (failure === 'metadata') failUpdate = true;
        else failWrite = true;
        await assert.rejects(groupTabsPersistently([1], target.id, 7), /unavailable/);
        const data = await reconcilePersistentGroups(7);
        assert.equal(data.groups.find(group => group.id === data.tabs[0].groupId).title, 'Source');
        assert.equal(data.groups.length, 2);
        assert.equal(tabs.length, 1);
    });
}

test('moving a native group between windows transfers its stable sidebar identity', async () => {
    reset();
    const saved = await createPersistentGroup(7, 'Work', 'blue');
    await groupTabsPersistently([1], saved.id, 7);
    groups[0].windowId = 8; tabs[0].windowId = 8;
    await reconcilePersistentGroups(8); // The destination event can arrive first.
    assert.equal((await reconcilePersistentGroups(7)).groups.length, 0);
    const data = await reconcilePersistentGroups(8);
    assert.equal(data.groups.length, 1);
    assert.equal(data.groups[0].id, saved.id);
    assert.equal(data.tabs[0].groupId, saved.id);
});

test('restoring a window transfers an empty group once and ignores same-window requests', async () => {
    reset();
    const saved = await createPersistentGroup(7, 'Empty', 'blue');
    assert.equal(await restorePersistentGroups(7, 7), false);
    assert.equal(await restorePersistentGroups(7, 8), true);
    assert.equal(await restorePersistentGroups(7, 8), false);
    assert.equal((await reconcilePersistentGroups(8)).groups[0].id, saved.id);
});
