import assert from "node:assert/strict";
import test from "node:test";

const listeners = new Map();
const frames = new Map();
let nextFrameId = 0;

const searchInput = {
    value: "",
    style: {},
    setAttribute() {},
    addEventListener(name, listener) { listeners.set(`input:${name}`, listener); },
    focus() {},
};

globalThis.document = {
    createElement() { return searchInput; },
    addEventListener(name, listener) { listeners.set(`document:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`document:${name}`); },
};
globalThis.window = {
    addEventListener(name, listener) { listeners.set(`window:${name}`, listener); },
    focus() {},
    requestAnimationFrame(callback) {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
};
globalThis.chrome = {
    sidePanel: {
        onOpened: {
            addListener() {},
            removeListener() {},
        },
    },
};

const { setupSearchAction } = await import("../dist/sidebar/actions/actionSearch.js");

test("search coalesces input into one render with the latest query", () => {
    let renders = 0;
    const query = setupSearchAction({ appendChild() {} }, () => { renders += 1; });

    searchInput.value = "First";
    listeners.get("input:input")();
    searchInput.value = "Second";
    listeners.get("input:input")();

    assert.equal(query(), "second");
    assert.equal(frames.size, 1);
    assert.equal(renders, 0);

    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
    assert.equal(renders, 1);

    listeners.get("window:pagehide")();
    assert.equal(frames.size, 0);
});
