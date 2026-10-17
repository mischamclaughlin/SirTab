import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Capture the actual built extension, with native APIs and disposable demo data.
// Brave supports loading unpacked extensions in headless mode. Chrome releases
// that disable --load-extension cannot be used; SIRTAB_BROWSER can select Chromium.
const root = fileURLToPath(new URL("..", import.meta.url));
const browser = [
    process.env.SIRTAB_BROWSER,
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/brave-browser",
    "/usr/bin/chromium",
].filter(Boolean).find(existsSync);
assert.ok(browser, "Brave or Chromium with unpacked-extension support is required");
const profile = await mkdtemp(path.join(tmpdir(), "sirtab-screenshots-"));
const connections = [];
const server = createServer((request, response) => {
    const title = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title>`);
});
let child;

async function until(read, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
    });
    connections.push(socket);
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
        const result = JSON.parse(data);
        const callback = pending.get(result.id);
        if (!callback) return;
        pending.delete(result.id);
        clearTimeout(callback.timeout);
        if (result.error) callback.reject(new Error(JSON.stringify(result.error)));
        else callback.resolve(result.result);
    });
    return (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timed out: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(send, expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}

try {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const demoOrigin = `http://127.0.0.1:${server.address().port}`;
    let browserErrors = "";
    child = spawn(browser, [
        "--headless=new", "--no-first-run", "--no-default-browser-check",
        `--user-data-dir=${profile}`, "--remote-debugging-port=0",
        `--disable-extensions-except=${path.join(root, "dist")}`,
        `--load-extension=${path.join(root, "dist")}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (data) => { browserErrors = (browserErrors + data).slice(-4000); });
    child.on("error", (error) => { browserErrors += error.message; });
    const port = await until(async () => {
        try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; }
        catch { return null; }
    }, "browser debugging port").catch((error) => { throw new Error(`${error.message}: ${browserErrors}`); });
    const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const worker = await until(async () => (await targets()).find((target) =>
        target.type === "service_worker" && target.url.endsWith("/background/background.js")), "Sir Tab service worker");
    const background = await connect(worker.webSocketDebuggerUrl);
    const extensionUrl = `${worker.url.split("/background/")[0]}/sidebar/sidebar.html`;
    await evaluate(background, `(async () => {
        await chrome.storage.local.set({sidebarTheme:'dark',shortcutPromptDismissed:true});
        const titles = ['Sir Tab · GitHub','Cloudflare Dashboard','TypeScript Handbook','MDN Web Docs','CSS Grid Layout','Chrome Extensions','Weekend walks'];
        const tabs = [];
        for (const title of titles) tabs.push(await chrome.tabs.create({url:${JSON.stringify(demoOrigin)}+'/'+encodeURIComponent(title),active:false}));
        const development = await chrome.tabs.group({tabIds:tabs.slice(2,5).map(tab=>tab.id)});
        await chrome.tabGroups.update(development,{title:'development',color:'blue'});
        const reading = await chrome.tabs.group({tabIds:tabs.slice(5).map(tab=>tab.id)});
        await chrome.tabGroups.update(reading,{title:'reading',color:'green'});
        const tree = await chrome.bookmarks.getTree();
        const bar = tree[0].children.find(node=>node.folderType==='bookmarks-bar'||node.id==='1');
        for (const [title, entries] of [
            ['dev', [['TypeScript Handbook','https://www.typescriptlang.org/docs/'],['MDN Web Docs','https://developer.mozilla.org/'],['Cloudflare Docs','https://developers.cloudflare.com/']]],
            ['web', [['CSS-Tricks','https://css-tricks.com/'],['Chrome for Developers','https://developer.chrome.com/']]],
            ['weekend', [['Walking routes','https://example.com/walks']]],
        ]) {
            const folder = await chrome.bookmarks.create({parentId:bar.id,title});
            for (const [title,url] of entries) await chrome.bookmarks.create({parentId:folder.id,title,url});
        }
        // Use the existing new-tab tab to view the extension in the demo window.
        const initial = (await chrome.tabs.query({})).find(tab=>!tabs.some(demo=>demo.id===tab.id));
        await chrome.tabs.update(initial.id,{url:${JSON.stringify(extensionUrl)},active:true});
    })()`);
    const page = await until(async () => (await targets()).find((target) => target.type === "page" && target.url === extensionUrl), "sidebar page");
    const send = await connect(page.webSocketDebuggerUrl);
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 440, height: 800, deviceScaleFactor: 2, mobile: false });
    await until(() => evaluate(send, "document.querySelectorAll('.tab-row').length >= 8 && !!document.querySelector('[aria-label=Settings]')"), "rendered demo tabs");
    const run = (expression) => evaluate(send, expression);
    // Verify the README's ordering distinction against a real browser inventory.
    await run(`(async () => {
        const order = await import(chrome.runtime.getURL('shared/groupOrder.js'));
        const {id:windowId} = await chrome.windows.getCurrent();
        const before = await chrome.tabs.query({windowId});
        const loose = before.filter(tab=>tab.groupId===chrome.tabGroups.TAB_GROUP_ID_NONE);
        const first=loose[1].id, second=loose[2].id;
        await order.moveStoredTabRelative(windowId,second,first,'before');
        const after = await chrome.tabs.query({windowId});
        if(JSON.stringify(before.map(tab=>tab.id))!==JSON.stringify(after.map(tab=>tab.id))) throw new Error('Sidebar reorder changed native tab order');
        const logical = await order.loadLogicalTabGroupData(windowId);
        if(logical.tabOrder.indexOf(second)>=logical.tabOrder.indexOf(first)) throw new Error('Sidebar order did not change');
        await order.moveStoredTabRelative(windowId,second,first,'after');
        const groups=await chrome.tabGroups.query({windowId});
        await order.moveStoredGroupRelative(windowId,groups[1].id,groups[0].id,'before');
        const afterGroups=await chrome.tabs.query({windowId});
        if(JSON.stringify(before.map(tab=>tab.id))!==JSON.stringify(afterGroups.map(tab=>tab.id))) throw new Error('Sidebar group reorder changed native tab order');
        await order.moveStoredGroupRelative(windowId,groups[1].id,groups[0].id,'after');
    })()`);
    console.log("Verified: sidebar tab/group reordering preserves native tab-strip order");
    const settled = () => run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
    const click = async (label) => {
        await run(`(() => { const button = [...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)} || button.textContent.trim()===${JSON.stringify(label)}); if(!button) throw new Error('Missing button: '+${JSON.stringify(label)}); button.click(); })()`);
        await settled();
    };
    const capture = async (name) => {
        await settled();
        assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true, `${name}: horizontal overflow`);
        const { data } = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(root, "docs/images", `sir-tab-${name}.png`), Buffer.from(data, "base64"));
        console.log(`Captured ${name}`);
    };
    await mkdir(path.join(root, "docs/images"), { recursive: true });
    await click("web");
    await click("weekend");
    await capture("sidebar");
    await run(`(() => { const search=document.querySelector('input[type=search], .search-input'); search.value='Cloudflare'; search.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await until(() => run("document.querySelectorAll('#tabs-list .tab-row').length === 1 && document.querySelectorAll('#bookmarks-list .tab-row').length === 1"), "search results");
    await capture("search");
    await run(`(() => { const search=document.querySelector('.search-input'); search.value=''; search.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await until(() => run("document.querySelectorAll('.tab-row').length >= 8"), "cleared search");
    await click("Create group");
    await run("document.querySelector('#group-name-input').value='research'; document.querySelector('#group-colour-select').value='lavender'");
    await capture("create-group");
    await click("Cancel group creation");
    // Dispatch native mouse input so the image includes the production drop preview.
    const point = (selector) => run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    const from = await point('#tabs-list .tab-button');
    const to = await point('#groups-list .tab-button');
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x-from.x)*step/12, y: from.y + (to.y-from.y)*step/12, button: "left", buttons: 1 });
    }
    assert.equal(await run("!!document.querySelector('.is-dragging')"), true, "drag source is active");
    await capture("organise-tabs");
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
    await until(() => run("!document.querySelector('.is-dragging')"), "completed drag");
    await click("Select tabs and edit. Shift-click a tab to select a range.");
    await run("document.querySelectorAll('.tab-button')[1].click()");
    await settled();
    await run("document.querySelectorAll('.tab-button')[2].click()");
    await settled();
    await click("Edit group development. Available in select mode.");
    await capture("batch-edit");
    await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await settled();
    await click("Create bookmark or folder");
    await click("Bookmark current tab");
    await run("document.querySelector('#bookmark-name-input').value='Sir Tab source'; document.querySelector('#bookmark-folder-select').value=[...document.querySelector('#bookmark-folder-select').options].find(option=>option.textContent.trim().endsWith('dev')).value");
    await capture("create-bookmark");
    await click("Cancel bookmark creation");
    await click("Settings");
    await capture("settings");
} finally {
    for (const socket of connections) socket.close();
    if (child && child.exitCode == null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
