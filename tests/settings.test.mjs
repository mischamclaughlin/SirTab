import assert from "node:assert/strict";
import test from "node:test";
globalThis.chrome = { runtime: { getURL: (path) => path } };
const { setupSettingAction } = await import("../dist/sidebar/actions/actionSetting.js");
const { loadThemePreference } = await import("../dist/sidebar/helpers/theme.js");
const { SHORTCUT_PROMPT_DISMISSED_STORAGE_KEY, THEME_STORAGE_KEY, THEMES } = await import("../dist/sidebar/config.js");

class Element {
    children = [];
    attributes = new Map();
    listeners = new Map();
    disabled = false;
    hidden = false;
    textContent = "";
    className = "";
    classList = {
        add: (name) => { this.className += ` ${name}`; },
        toggle: (name, enabled) => {
            const names = new Set(this.className.split(" ").filter(Boolean));
            enabled ? names.add(name) : names.delete(name);
            this.className = [...names].join(" ");
        },
    };
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { if (!this.disabled) this.listeners.get("click")?.(); }
    all() { return [this, ...this.children.flatMap((child) => child.all())]; }
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(t) {
    const original = { chrome: globalThis.chrome, document: globalThis.document, error: console.error };
    const state = { storage: {}, commands: [], writes: [], errors: [], opened: [] };
    const root = new Element();
    globalThis.document = { documentElement: root, createElement: () => new Element(), createElementNS: () => new Element() };
    globalThis.chrome = {
        commands: { getAll: async () => state.commands },
        storage: { local: {
            get: async (key) => ({ [key]: state.storage[key] }),
            set: async (values) => { state.writes.push(values); Object.assign(state.storage, values); },
        } },
        tabs: { create: async (options) => { state.opened.push(options); } },
    };
    console.error = (...args) => state.errors.push(args);
    t.after(() => { globalThis.chrome = original.chrome; globalThis.document = original.document; console.error = original.error; });
    const settings = new Element();
    const find = (className) => settings.all().find((el) => el.className.split(" ").includes(className));
    const button = (text) => settings.all().find((el) => el.textContent === text && el.listeners.has("click"));
    return { state, root, settings, find, button, setup: () => setupSettingAction(settings, new Element()) };
}

test("theme restoration supports every theme and legacy aliases and defaults invalid values", async (t) => {
    const { state, root } = harness(t);
    for (const [stored, expected] of [
        ...THEMES.map((theme) => [theme, theme]),
        ["standard-dark", "dark"], ["standard-light", "light"],
        ["catppuccin-dark", "mocha"], ["catppuccin-light", "latte"],
        ["cappucin-light", "latte"], ["claude", "retro-dark"], ["retro", "retro-dark"],
        ["invalid", "dark"], [undefined, "dark"], [true, "dark"],
    ]) {
        state.storage[THEME_STORAGE_KEY] = stored;
        await loadThemePreference();
        assert.equal(root.getAttribute("data-theme"), expected, String(stored));
    }
    chrome.storage.local.get = async () => { throw Error("storage unavailable"); };
    await loadThemePreference();
    assert.equal(root.getAttribute("data-theme"), "dark");
    assert.equal(state.errors.length, 1);
});

test("settings survive command and storage startup failures and shortcuts can retry", async (t) => {
    const { state, settings, setup, find, button } = harness(t);
    chrome.commands.getAll = async () => { throw Error("commands unavailable"); };
    chrome.storage.local.get = async () => { throw Error("storage unavailable"); };
    await setup();
    assert.equal(settings.children.length, 3);
    assert.equal(find("shortcut-prompt").hidden, true);
    find("settings-btn").click();
    await settle();
    assert.equal(find("setting-info-section").hidden, false);
    assert.equal(find("settings-btn").disabled, false);
    assert.equal(state.errors.length, 2);
    chrome.commands.getAll = async () => [{ name: "_execute_action", shortcut: "Alt+S" }];
    chrome.storage.local.get = async () => ({});
    button("refresh").click();
    await settle();
    assert.equal(find("shortcut-list").children.length, 6);
    assert.equal(find("shortcut-prompt-count").textContent, "5 missing shortcuts");
    assert.equal(find("shortcut-prompt").hidden, false);
});

test("shortcut counts ignore whitespace and unknown commands; dismissal persists and failures permit retry", async (t) => {
    const { state, setup, find, button } = harness(t);
    state.commands = [{ name: "_execute_action", shortcut: " Alt+S " }, { name: "cycle_next_visible_tab", shortcut: "   " }, { name: "unrelated", shortcut: "Alt+T" }, { shortcut: "Alt+X" }];
    await setup();
    assert.equal(find("shortcut-prompt-count").textContent, "5 missing shortcuts");
    chrome.storage.local.set = async () => { throw Error("write failed"); };
    find("shortcut-prompt-dismiss").click();
    await settle();
    assert.equal(find("shortcut-prompt").hidden, false);
    assert.equal(find("shortcut-prompt-dismiss").disabled, false);
    chrome.storage.local.set = async (values) => Object.assign(state.storage, values);
    find("shortcut-prompt-dismiss").click();
    await settle();
    assert.equal(state.storage[SHORTCUT_PROMPT_DISMISSED_STORAGE_KEY], true);
    assert.equal(find("shortcut-prompt").hidden, true);
    button("refresh").click();
    await settle();
    assert.equal(find("shortcut-prompt").hidden, true);
    const reopened = new Element();
    await setupSettingAction(reopened, new Element());
    assert.equal(reopened.all().find((el) => el.className === "shortcut-prompt").hidden, true);
    button("set shortcuts").click();
    await settle();
    assert.deepEqual(state.opened, [{ url: "chrome://extensions/shortcuts" }]);
});

test("fully assigned shortcuts hide the prompt", async (t) => {
    const { state, setup, find } = harness(t);
    state.commands = ["_execute_action", "cycle_next_visible_tab", "cycle_previous_visible_tab", "move_active_tab_next", "move_active_tab_previous", "open_quick_search"].map((name) => ({ name, shortcut: "Alt+S" }));
    await setup();
    assert.equal(find("shortcut-prompt-count").textContent, "0 missing shortcuts");
    assert.equal(find("shortcut-prompt").hidden, true);
});

test("theme saves are serialised and failed persistence retains the applied and selected theme", async (t) => {
    const { state, root, setup, button } = harness(t);
    root.setAttribute("data-theme", "mocha");
    await setup();
    assert.equal(button("mocha").getAttribute("aria-pressed"), "true");
    let resolve;
    chrome.storage.local.set = (values) => {
        state.writes.push(values);
        return new Promise((done) => { resolve = done; });
    };
    button("light").click();
    button("dark").click();
    assert.equal(state.writes.length, 1);
    assert.equal(root.getAttribute("data-theme"), "mocha");
    resolve();
    await settle();
    assert.equal(root.getAttribute("data-theme"), "light");
    assert.equal(button("light").getAttribute("aria-pressed"), "true");
    assert.equal(button("mocha").getAttribute("aria-pressed"), "false");
    chrome.storage.local.set = async () => { throw Error("write failed"); };
    button("dark").click();
    await settle();
    assert.equal(root.getAttribute("data-theme"), "light");
    assert.equal(button("light").getAttribute("aria-pressed"), "true");
    assert.ok(THEMES.every((theme) => !button(theme.replaceAll("-", " ")).disabled));
    assert.equal(state.errors.length, 1);
});


test("shortcut settings failures release both open buttons for retry", async (t) => {
    const { state, setup, button } = harness(t);
    await setup();
    chrome.tabs.create = async () => { throw Error("tab creation failed"); };
    button("set").click();
    button("set shortcuts").click();
    await settle();
    assert.equal(state.errors.length, 2);
    assert.equal(button("set").disabled, false);
    assert.equal(button("set shortcuts").disabled, false);
    chrome.tabs.create = async (options) => state.opened.push(options);
    button("set").click();
    await settle();
    assert.deepEqual(state.opened, [{ url: "chrome://extensions/shortcuts" }]);
});
