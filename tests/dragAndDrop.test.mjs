import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
    constructor() {
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (name) => this.classes.add(name),
            remove: (name) => this.classes.delete(name),
            contains: (name) => this.classes.has(name),
        };
    }

    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) ?? [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }

    dispatch(name, event) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
    }

    getBoundingClientRect() {
        return { top: 100, height: 40 };
    }
}

globalThis.chrome = { tabGroups: { TAB_GROUP_ID_NONE: -1 } };
globalThis.document = new FakeElement();
document.scrollingElement = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
globalThis.window = { innerHeight: 500 };
let scheduledFrame = null;
let cancelledFrame = false;
globalThis.requestAnimationFrame = (callback) => {
    scheduledFrame = callback;
    return 1;
};
globalThis.cancelAnimationFrame = () => {
    cancelledFrame = true;
    scheduledFrame = null;
};

const {
    deferRenderUntilDragSettles,
    makeTabDraggable,
    setupSidebarDropZones,
} = await import(
    "../dist/sidebar/helpers/dragAndDrop.js"
);

function dragEvent(target, clientY) {
    const data = new Map();
    return {
        target,
        clientY,
        defaultPrevented: false,
        dataTransfer: {
            effectAllowed: "none",
            dropEffect: "none",
            setData: (type, value) => data.set(type, value),
            getData: (type) => data.get(type) ?? "",
        },
        preventDefault() {
            this.defaultPrevented = true;
        },
    };
}

test("drag marker clears on an invalid target and returns on a valid one", () => {
    const tabsList = new FakeElement();
    const groupsList = new FakeElement();
    const sourceHandle = new FakeElement();
    const sourceRow = new FakeElement();
    const targetHandle = new FakeElement();
    const targetRow = new FakeElement();
    const enabled = () => true;
    const requestRender = () => {};

    setupSidebarDropZones(tabsList, groupsList, 1, enabled, requestRender);
    setupSidebarDropZones(new FakeElement(), new FakeElement(), 2, enabled, requestRender);
    assert.equal(document.listeners.get("dragover").length, 1);
    assert.equal(document.listeners.get("drop").length, 1);
    makeTabDraggable(sourceHandle, sourceRow, 1, 10, enabled, requestRender);
    makeTabDraggable(targetHandle, targetRow, 1, 20, enabled, requestRender);

    sourceHandle.dispatch("dragstart", dragEvent(sourceHandle, 110));
    let deferredRenders = 0;
    const renderAfterDrag = () => {
        deferredRenders += 1;
    };
    assert.equal(deferRenderUntilDragSettles(renderAfterDrag), true);
    assert.equal(deferRenderUntilDragSettles(renderAfterDrag), true);
    assert.equal(deferredRenders, 0);

    const valid = dragEvent(targetRow, 105);
    targetRow.dispatch("dragover", valid);
    document.dispatch("dragover", valid);
    assert.equal(valid.defaultPrevented, true);
    assert.equal(targetRow.classList.contains("drop-before"), true);

    const self = dragEvent(sourceRow, 105);
    sourceRow.dispatch("dragover", self);
    document.dispatch("dragover", self);
    assert.equal(targetRow.classList.contains("drop-before"), false);

    const validAgain = dragEvent(targetRow, 135);
    targetRow.dispatch("dragover", validAgain);
    document.dispatch("dragover", validAgain);
    assert.equal(targetRow.classList.contains("drop-after"), true);

    const nearBottom = dragEvent(targetRow, 490);
    targetRow.dispatch("dragover", nearBottom);
    document.dispatch("dragover", nearBottom);
    assert.equal(typeof scheduledFrame, "function");
    scheduledFrame();
    assert.equal(document.scrollingElement.scrollTop, 16);

    document.dispatch("dragover", dragEvent(new FakeElement(), 300));
    assert.equal(targetRow.classList.contains("drop-after"), false);
    assert.equal(cancelledFrame, true);

    document.dispatch("drop", dragEvent(new FakeElement(), 300));
    assert.equal(sourceRow.classList.contains("is-dragging"), false);
    assert.equal(deferredRenders, 1);
    assert.equal(deferRenderUntilDragSettles(renderAfterDrag), false);
});
