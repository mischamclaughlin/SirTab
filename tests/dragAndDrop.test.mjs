import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
    constructor(classes = [], parent = null, dataset = {}) {
        this.classes = new Set(classes);
        this.parent = parent;
        this.children = [];
        this.dataset = dataset;
        this.listeners = new Map();
        this.bounds = { top: 100, left: 10, width: 240, height: 40 };
        this.hidden = false;
        this.style = {
            setProperty() {},
            removeProperty() {},
        };
        this.classList = {
            add: (name) => this.classes.add(name),
            remove: (name) => this.classes.delete(name),
            contains: (name) => this.classes.has(name),
        };
        parent?.children.push(this);
    }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) ?? [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }
    dispatch(name, event) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
    }
    contains(other) {
        for (let node = other; node; node = node.parent) {
            if (node === this) return true;
        }
        return false;
    }
    closest(selector) {
        const className = selector.slice(1);
        for (let node = this; node; node = node.parent) {
            if (node.classes.has(className)) return node;
        }
        return null;
    }
    querySelector(selector) {
        const className = selector.slice(1);
        const pending = [...this.children];
        while (pending.length) {
            const node = pending.shift();
            if (node.classes.has(className)) return node;
            pending.push(...node.children);
        }
        return null;
    }
    getBoundingClientRect() {
        return {
            ...this.bounds,
            bottom: this.bounds.top + this.bounds.height,
            right: this.bounds.left + this.bounds.width,
        };
    }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
globalThis.document = new FakeElement();
document.getElementById = () => null;
document.scrollingElement = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
let hitTarget = null;
document.elementFromPoint = () => hitTarget;
globalThis.window = { innerHeight: 500 };
const frames = new Map();
let nextFrameId = 1;
globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);

const state = { tabs: [], groups: [], storage: {}, groupCalls: [], bookmarks: [] };
globalThis.chrome = {
    tabGroups: { TAB_GROUP_ID_NONE: -1, query: async () => state.groups },
    tabs: {
        query: async () => state.tabs,
        get: async (id) => state.tabs.find((tab) => tab.id === id),
        group: async ({ groupId, tabIds }) => {
            state.groupCalls.push({ groupId, tabIds: [...tabIds] });
            for (const tab of state.tabs) if (tabIds.includes(tab.id)) tab.groupId = groupId;
        },
        ungroup: async (tabIds) => {
            for (const tab of state.tabs) if (tabIds.includes(tab.id)) tab.groupId = -1;
        },
    },
    storage: {
        local: {
            get: async () => structuredClone(state.storage),
            set: async (updates) => Object.assign(state.storage, structuredClone(updates)),
        },
    },
    windows: { getAll: async () => [{ id: 1 }] },
    bookmarks: {
        getTree: async () => [{ id: "0", children: [{ id: "1", folderType: "bookmarks-bar" }] }],
        create: async (details) => { state.bookmarks.push(details); },
    },
};

const {
    deferRenderUntilDragSettles,
    makeGroupDraggable,
    makeTabDraggable,
    setupSidebarDropZones,
} = await import("../dist/sidebar/helpers/dragAndDrop.js");

function dragEvent(target, clientY = 110) {
    return {
        target,
        clientX: 35,
        clientY,
        defaultPrevented: false,
        dataTransfer: {
            effectAllowed: "none",
            dropEffect: "none",
            setData() {},
            setDragImage(element, x, y) {
                assert.ok(element instanceof FakeElement);
                assert.ok(x >= 0 && y >= 0);
            },
        },
        preventDefault() { this.defaultPrevented = true; },
    };
}

function nextFrame() {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
}

function tab(id, groupId = -1) {
    return { id, groupId, index: id, windowId: 1, url: `https://example.test/${id}` };
}

async function waitForDrop(completed) {
    const deadline = Date.now() + 1000;
    while (!completed()) {
        if (Date.now() >= deadline) throw new Error("Drop did not complete");
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

test("marker follows rows during bottom auto-scroll; selected tabs drop together into group gap", async () => {
    state.tabs = [tab(10), tab(20), tab(30), tab(40), tab(50, 7)];
    state.groups = [{ id: 7, windowId: 1, title: "Group", color: "blue" }];
    state.storage = {};
    const tabsList = new FakeElement(["tabs-list"]);
    const groupsList = new FakeElement(["groups-list"]);
    const bookmarksList = new FakeElement(["bookmarks-list"]);
    const sourceItem = new FakeElement(["tab-item"], tabsList, { tabId: "10" });
    const sourceRow = new FakeElement(["tab-row"], sourceItem);
    const sourceHandle = new FakeElement([], sourceRow);
    const secondItem = new FakeElement(["tab-item"], tabsList, { tabId: "20" });
    const secondRow = new FakeElement(["tab-row"], secondItem);
    const lastItem = new FakeElement(["tab-item"], tabsList, { tabId: "40" });
    const lastRow = new FakeElement(["tab-row"], lastItem);
    const groupItem = new FakeElement(["group-item"], groupsList, { groupId: "7" });
    const groupRow = new FakeElement(["tree-row"], groupItem);
    const groupHandle = new FakeElement([], groupRow);
    const groupTabs = new FakeElement(["group-tabs"], groupItem);
    const enabled = () => true;
    let renders = 0;
    const requestRender = () => { renders++; };

    setupSidebarDropZones(tabsList, groupsList, bookmarksList, 1, enabled, requestRender, requestRender);
    setupSidebarDropZones(tabsList, groupsList, bookmarksList, 1, enabled, requestRender, requestRender);
    assert.equal(document.listeners.get("dragover").length, 1);
    assert.equal(document.listeners.get("drop").length, 1);
    makeTabDraggable(sourceHandle, sourceRow, 1, 10, enabled, requestRender, () => [10, 30]);
    makeGroupDraggable(groupHandle, groupRow, 1, 7, enabled, requestRender);

    sourceHandle.dispatch("dragstart", dragEvent(sourceHandle));
    assert.equal(sourceRow.classList.contains("is-dragging"), true);
    assert.equal(deferRenderUntilDragSettles(requestRender), true);
    const directlyOverGap = dragEvent(tabsList, 98);
    document.dispatch("dragover", directlyOverGap);
    assert.equal(directlyOverGap.defaultPrevented, true);
    assert.equal(secondRow.classList.contains("drop-before"), true);
    const overSecond = dragEvent(secondRow, 105);
    document.dispatch("dragover", overSecond);
    assert.equal(overSecond.defaultPrevented, true);
    assert.equal(secondRow.classList.contains("drop-before"), true);

    const overOpenGap = dragEvent(tabsList, 98);
    document.dispatch("dragover", overOpenGap);
    assert.equal(overOpenGap.defaultPrevented, true);
    assert.equal(secondRow.classList.contains("drop-before"), true);
    assert.equal(tabsList.classList.contains("drop-append"), false);

    hitTarget = lastRow;
    document.dispatch("dragover", dragEvent(secondRow, 490));
    assert.equal(frames.size, 1);
    nextFrame();
    assert.equal(document.scrollingElement.scrollTop, 16);
    assert.equal(secondRow.classList.contains("drop-after"), false);
    assert.equal(lastRow.classList.contains("drop-after"), true);

    document.dispatch("dragover", dragEvent(groupTabs, 110));
    assert.equal(groupRow.classList.contains("drop-inside"), true);
    assert.equal(groupTabs.classList.contains("drop-tab-preview"), true);
    assert.equal(lastRow.classList.contains("drop-after"), false);
    hitTarget = groupTabs;
    document.dispatch("drop", dragEvent(groupTabs, 110));
    await waitForDrop(() => state.groupCalls.length === 1 &&
        state.storage["tabOrderByWindow:1"]?.order?.length === 5);
    assert.deepEqual(state.groupCalls, [{ groupId: 7, tabIds: [10, 30] }]);
    assert.deepEqual(state.storage["tabOrderByWindow:1"].order, [20, 40, 50, 10, 30]);
    assert.equal(sourceRow.classList.contains("is-dragging"), false);
    assert.equal(groupTabs.classList.contains("drop-tab-preview"), false);
    assert.equal(renders, 1);

    groupHandle.dispatch("dragstart", dragEvent(groupHandle));
    document.dispatch("dragover", dragEvent(groupRow, 105));
    assert.equal(groupItem.classList.contains("drop-before"), false);
    document.dispatch("dragend", dragEvent(groupHandle));
    assert.equal(deferRenderUntilDragSettles(requestRender), false);

    state.tabs.push(tab(60, 8), tab(70, 9));
    state.groups.push(
        { id: 8, windowId: 1, title: "Second", color: "green" },
        { id: 9, windowId: 1, title: "Third", color: "red" },
    );
    const secondGroup = new FakeElement(["group-item"], groupsList, { groupId: "8" });
    secondGroup.bounds.top = 160;
    new FakeElement(["tree-row"], secondGroup).bounds.top = 160;
    const thirdGroup = new FakeElement(["group-item"], groupsList, { groupId: "9" });
    thirdGroup.bounds.top = 220;
    const thirdRow = new FakeElement(["tree-row"], thirdGroup);
    thirdRow.bounds.top = 220;
    const thirdTabs = new FakeElement(["group-tabs"], thirdGroup);
    const thirdTabRow = new FakeElement(["tab-row"], thirdTabs);
    thirdTabRow.bounds.top = 270;

    groupHandle.dispatch("dragstart", dragEvent(groupHandle));
    assert.equal(groupItem.classList.contains("is-dragging"), true);
    document.dispatch("dragover", dragEvent(groupsList, 210));
    assert.equal(thirdGroup.classList.contains("drop-before"), true);
    const overAnotherGroupsTab = dragEvent(thirdTabRow, 280);
    document.dispatch("dragover", overAnotherGroupsTab);
    assert.equal(overAnotherGroupsTab.defaultPrevented, false);
    assert.equal(thirdGroup.classList.contains("drop-before"), false);
    assert.equal(thirdGroup.classList.contains("drop-after"), false);
    hitTarget = thirdTabRow;
    document.dispatch("drop", dragEvent(thirdTabRow, 280));
    assert.equal(state.storage["groupOrderByWindow:1"], undefined);

    groupHandle.dispatch("dragstart", dragEvent(groupHandle));
    document.dispatch("dragover", dragEvent(thirdRow, 250));
    assert.equal(thirdGroup.classList.contains("drop-after"), true);
    hitTarget = thirdRow;
    document.dispatch("drop", dragEvent(thirdRow, 250));
    await waitForDrop(() => state.storage["groupOrderByWindow:1"]?.order?.[2] === 7);
    assert.deepEqual(state.storage["groupOrderByWindow:1"].order, [8, 9, 7]);
    assert.equal(groupItem.classList.contains("is-dragging"), false);

    state.tabs.find((item) => item.id === 10).title = "  Named tab  ";
    state.tabs.find((item) => item.id === 30).url = "chrome://settings";
    const folderItem = new FakeElement(["tab-item"], bookmarksList, {
        bookmarkId: "22", bookmarkFolderId: "22",
    });
    const folderRow = new FakeElement(["tree-row"], folderItem);
    const bookmarkDrag = dragEvent(sourceHandle);
    sourceHandle.dispatch("dragstart", bookmarkDrag);
    assert.equal(bookmarkDrag.dataTransfer.effectAllowed, "copyMove");
    const overFolder = dragEvent(folderRow);
    document.dispatch("dragover", overFolder);
    assert.equal(overFolder.dataTransfer.dropEffect, "copy");
    assert.equal(folderRow.classList.contains("drop-inside"), true);
    hitTarget = folderRow;
    document.dispatch("drop", dragEvent(folderRow));
    await waitForDrop(() => state.bookmarks.length === 1);
    assert.deepEqual(state.bookmarks, [{
        parentId: "22", title: "Named tab", url: "https://example.test/10",
    }]);
    assert.equal(state.tabs.find((item) => item.id === 10).groupId, 7);

    const bookmarkItem = new FakeElement(["tab-item"], bookmarksList, {
        bookmarkId: "23", bookmarkParentId: "24",
    });
    const bookmarkRow = new FakeElement(["tab-row"], bookmarkItem);
    sourceHandle.dispatch("dragstart", dragEvent(sourceHandle));
    hitTarget = bookmarkRow;
    document.dispatch("drop", dragEvent(bookmarkRow));
    await waitForDrop(() => state.bookmarks.length === 2);
    assert.equal(state.bookmarks.at(-1).parentId, "24");

    sourceHandle.dispatch("dragstart", dragEvent(sourceHandle));
    hitTarget = bookmarksList;
    document.dispatch("drop", dragEvent(bookmarksList));
    await waitForDrop(() => state.bookmarks.length === 3);
    assert.equal(state.bookmarks.at(-1).parentId, "1");
});
