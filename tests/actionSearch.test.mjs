import assert from "node:assert/strict";
import test from "node:test";

function harness(t) {
    const original = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome };
    const listeners = new Map(), frames = new Map(), opened = new Set();
    let nextFrameId = 0, inputFocuses = 0, windowFocuses = 0, renders = 0;
    const searchInput = {
        value: "", setAttribute() {},
        addEventListener: (name, listener) => listeners.set(`input:${name}`, listener),
        focus: () => { inputFocuses++; },
    };
    globalThis.document = {
        createElement: () => searchInput,
        addEventListener: (name, listener) => listeners.set(`document:${name}`, listener),
        removeEventListener: (name) => listeners.delete(`document:${name}`),
    };
    globalThis.window = {
        addEventListener: (name, listener) => listeners.set(`window:${name}`, listener),
        focus: () => { windowFocuses++; },
        requestAnimationFrame(callback) { const id = ++nextFrameId; frames.set(id, callback); return id; },
        cancelAnimationFrame: (id) => frames.delete(id),
    };
    globalThis.chrome = { sidePanel: { onOpened: {
        addListener: (listener) => opened.add(listener), removeListener: (listener) => opened.delete(listener),
    } } };
    t.after(() => {
        listeners.get('window:pagehide')?.();
        Object.assign(globalThis, original);
    });
    return {
        listeners, frames, opened, searchInput,
        render: () => { renders++; },
        counts: () => ({ inputFocuses, windowFocuses, renders }),
        flush: () => { for (const [id, callback] of frames) { frames.delete(id); callback(); } },
    };
}
const { setupSearchAction } = await import("../dist/sidebar/actions/actionSearch.js");

test("search coalesces input into one render with the latest normalised query", (t) => {
    const h = harness(t);
    const query = setupSearchAction({ appendChild() {} }, h.render);
    h.searchInput.value = "First"; h.listeners.get('input:input')();
    h.searchInput.value = "  SECOND  "; h.listeners.get('input:input')();
    assert.equal(query(), 'second');
    assert.equal(h.frames.size, 1);
    assert.equal(h.counts().renders, 0);
    h.flush();
    assert.equal(h.counts().renders, 1);
});

test("Escape clears the visible search and queued query; other keys and empty Escape do nothing", (t) => {
    const h = harness(t), query = setupSearchAction({ appendChild() {} }, h.render);
    h.listeners.get('input:keydown')({ key: 'Escape' });
    assert.equal(h.frames.size, 0);
    h.searchInput.value = '  Match  '; h.listeners.get('input:input')();
    h.listeners.get('input:keydown')({ key: 'Enter' });
    assert.equal(query(), 'match');
    h.listeners.get('input:keydown')({ key: 'Escape' });
    assert.equal(h.searchInput.value, '');
    assert.equal(query(), '');
    assert.equal(h.frames.size, 1);
    h.flush();
    assert.equal(h.counts().renders, 1);
});

test("opening the side panel and either focus shortcut focus the search", (t) => {
    const h = harness(t); setupSearchAction({ appendChild() {} }, h.render);
    for (const listener of h.opened) listener();
    let prevented = 0;
    const event = (options) => ({ key: 'b', ctrlKey: false, metaKey: false, preventDefault: () => { prevented++; }, ...options });
    const keydown = h.listeners.get('document:keydown');
    keydown(event({ ctrlKey: true }));
    keydown(event({ metaKey: true, key: 'B' }));
    assert.deepEqual(h.counts(), { inputFocuses: 3, windowFocuses: 3, renders: 0 });
    assert.equal(prevented, 2);
    keydown(event({}));
    keydown(event({ ctrlKey: true, key: 'x' }));
    assert.equal(h.counts().inputFocuses, 3);
    assert.equal(prevented, 2);
});

test("pagehide cancels a pending render and removes panel and document listeners", (t) => {
    const h = harness(t); setupSearchAction({ appendChild() {} }, h.render);
    h.searchInput.value = 'Pending'; h.listeners.get('input:input')();
    assert.equal(h.frames.size, 1);
    assert.equal(h.opened.size, 1);
    h.listeners.get('window:pagehide')();
    assert.equal(h.frames.size, 0);
    assert.equal(h.opened.size, 0);
    assert.equal(h.listeners.has('document:keydown'), false);
    h.flush();
    assert.equal(h.counts().renders, 0);
});
