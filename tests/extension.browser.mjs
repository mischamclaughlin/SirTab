import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { launchExtension, until } from './helpers/extension-browser.mjs';

// Run explicitly after building. This exercises the built extension with real
// Chrome APIs and CDP mouse input; it is deliberately outside node --test.
const root = fileURLToPath(new URL('..', import.meta.url));
const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>${new URL(request.url, 'http://localhost').pathname.slice(1)}</title>`);
});
let browser;
try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launchExtension(root);
    const background = browser.background.evaluate;
    const data = await background(`(async () => {
        await chrome.storage.local.set({shortcutPromptDismissed:true});
        const window = {id:(await chrome.tabs.query({}))[0].windowId};
        const tabs = [];
        for (const name of ['Alpha','Beta','Gamma','Delta']) tabs.push(await chrome.tabs.create({windowId:window.id,url:${JSON.stringify(origin)}+'/'+name,active:false}));
        const first = await chrome.tabs.group({tabIds:tabs.slice(0,2).map(tab=>tab.id)});
        const second = await chrome.tabs.group({tabIds:tabs.slice(2).map(tab=>tab.id)});
        await chrome.tabGroups.update(first,{title:'First',color:'blue'});
        await chrome.tabGroups.update(second,{title:'Second',color:'green'});
        const tree = await chrome.bookmarks.getTree();
        const bar = tree[0].children.find(node=>node.folderType==='bookmarks-bar'||node.id==='1');
        const folder = await chrome.bookmarks.create({parentId:bar.id,title:'Copied tabs'});
        const other = await chrome.windows.create({url:${JSON.stringify(origin + '/Other-window')},focused:false});
        const sidebar = await chrome.tabs.create({windowId:window.id,url:${JSON.stringify(browser.extensionUrl)},active:true});
        return {windowId:window.id,tabs:tabs.map(tab=>tab.id),first,second,folder:folder.id,otherId:other.id,sidebarId:sidebar.id};
    })()`);
    let page;
    const openPage = async () => {
        const target = await until(async () => (await browser.targets()).find(target => target.type === 'page' && target.url === browser.extensionUrl), 'sidebar target');
        page = await browser.connect(target);
        await page.send('Page.enable');
        await page.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 1000, deviceScaleFactor: 1, mobile: false });
        await until(() => page.evaluate(`!!document.querySelector('[aria-label="Settings"]') && !!document.querySelector('[data-tab-id="${data.tabs[0]}"]')`), 'bootstrapped real sidebar');
    };
    await openPage();
    const run = expression => page.evaluate(expression);
    const tab = id => `[data-tab-id="${id}"] .tab-button`;
    const group = id => `[data-group-id="${id}"] > .tree-row .tree-toggle`;
    const point = selector => run(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const drag = async (source, target) => {
        const from = await point(source); let to = await point(target);
        await page.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...from });
        await page.send('Input.dispatchMouseEvent', { type:'mousePressed', ...from, button:'left', clickCount:1 });
        for (let step=1; step<=16; step++) { await page.send('Input.dispatchMouseEvent', {
            type:'mouseMoved', x:from.x+(to.x-from.x)*step/16, y:from.y+(to.y-from.y)*step/16, buttons:1, button:'left' }); await new Promise(resolve=>setTimeout(resolve,20)); }
        assert.equal(await run("!!document.querySelector('.is-dragging')"), true, 'native mouse input started a drag');
        // Production previews can change row heights while the pointer travels.
        // Track the live target just as a user adjusts their pointer.
        for(let attempt=0;attempt<4;attempt++){
            to=await point(target);
            await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...to,buttons:1,button:'left'});
            await new Promise(resolve=>setTimeout(resolve,50));
        }
        await page.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...to, button:'left', clickCount:1 });
        await until(() => run("!document.querySelector('.is-dragging,.drop-inside,.drop-before,.drop-after,.drop-append,.drop-tab-preview')"), 'drag state cleanup');
    };
    // Window isolation is checked both initially and after a native event arrives.
    assert.equal(await run("document.body.textContent.includes('Other-window')"), false);
    await background(`chrome.tabs.create({windowId:${data.otherId},url:${JSON.stringify(origin + '/Other-new')},active:false})`);
    await run('new Promise(resolve=>setTimeout(resolve,150))');
    assert.equal(await run("document.body.textContent.includes('Other-new')"), false);
    console.log('PASS: real extension bootstrap and other-window isolation');

    await drag(tab(data.tabs[0]), group(data.second));
    await until(() => background(`chrome.tabs.get(${data.tabs[0]}).then(tab=>tab.groupId===${data.second})`), 'real cross-group tab move');
    await until(() => run(`!!document.querySelector('[data-group-id="${data.second}"] [data-tab-id="${data.tabs[0]}"]')`), 'moved tab render');
    console.log('PASS: native mouse cross-group drag updates real Chrome tab membership');

    // Deliberately reject only the API boundary to exercise production async
    // failure cleanup with a native drag. The retry uses the real API again.
    await run(`globalThis.originalBookmarkCreate=chrome.bookmarks.create; globalThis.dropRejected=false; chrome.bookmarks.create=async()=>{globalThis.dropRejected=true; throw new Error('Injected integration drop failure');}`);
    await drag(tab(data.tabs[0]), `[data-bookmark-folder-id="${data.folder}"] > .tree-row .tree-toggle`);
    await until(() => run('globalThis.dropRejected'), 'injected drop rejection');
    await run('chrome.bookmarks.create=globalThis.originalBookmarkCreate; delete globalThis.originalBookmarkCreate');
    assert.equal(await background(`chrome.bookmarks.getChildren(${JSON.stringify(data.folder)}).then(nodes=>nodes.length)`), 0);
    console.log('PASS: injected bookmark API rejection clears native drag state');
    await drag(tab(data.tabs[0]), `[data-bookmark-folder-id="${data.folder}"] > .tree-row .tree-toggle`);
    await until(() => background(`chrome.bookmarks.getChildren(${JSON.stringify(data.folder)}).then(nodes=>nodes.length===1&&nodes[0].url===${JSON.stringify(origin + '/Alpha')})`), 'real bookmark copy');
    assert.equal(await background(`chrome.tabs.get(${data.tabs[0]}).then(tab=>tab.groupId)`), data.second, 'copy retains original tab');
    console.log('PASS: native mouse tab-to-bookmark copy writes a real bookmark and retains tab');

    const savedBookmarks = await background(`(async()=>{
        const [first]=await chrome.bookmarks.getChildren(${JSON.stringify(data.folder)});
        const later=await chrome.bookmarks.create({parentId:${JSON.stringify(data.folder)},title:'Later',url:${JSON.stringify(origin + '/Later')}});
        const last=await chrome.bookmarks.create({parentId:${JSON.stringify(data.folder)},title:'Last',url:${JSON.stringify(origin + '/Last')}});
        const [sourceFolder]=await chrome.bookmarks.get(${JSON.stringify(data.folder)});
        const destination=await chrome.bookmarks.create({parentId:sourceFolder.parentId,title:'Destination'});
        return {first:first.id,later:later.id,last:last.id,destination:destination.id};
    })()`);
    const bookmark = id => `[data-bookmark-id="${id}"] > .tab-row .tab-button`;
    await until(() => run(`!!document.querySelector('[data-bookmark-id="${savedBookmarks.last}"]') && !!document.querySelector('[data-bookmark-folder-id="${savedBookmarks.destination}"]')`), 'bookmark move destinations rendered');
    await drag(bookmark(savedBookmarks.first), bookmark(savedBookmarks.last));
    await until(() => background(`chrome.bookmarks.getChildren(${JSON.stringify(data.folder)}).then(nodes=>nodes.at(-1)?.id===${JSON.stringify(savedBookmarks.first)})`), 'native forward bookmark reorder');
    assert.deepEqual(await background(`chrome.bookmarks.getChildren(${JSON.stringify(data.folder)}).then(nodes=>nodes.map(node=>node.id))`), [savedBookmarks.later,savedBookmarks.last,savedBookmarks.first]);
    await drag(bookmark(savedBookmarks.first), `[data-bookmark-folder-id="${savedBookmarks.destination}"] > .tree-row .tree-toggle`);
    await until(() => background(`chrome.bookmarks.get(${JSON.stringify(savedBookmarks.first)}).then(([node])=>node.parentId===${JSON.stringify(savedBookmarks.destination)})`), 'native bookmark move between folders');
    const tabCountBeforeBookmarkDrag=await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.length)`);
    await drag(bookmark(savedBookmarks.first), group(data.second));
    assert.equal(await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.length)`),tabCountBeforeBookmarkDrag,'dragging a bookmark into a tab group opens no tabs');
    assert.equal(await background(`chrome.bookmarks.get(${JSON.stringify(savedBookmarks.first)}).then(([node])=>node.parentId)`),savedBookmarks.destination,'rejected drag retains the bookmark');
    console.log('PASS: native bookmark reordering and folder moves; bookmark-to-tab-group drops rejected');


    // Persist an ordering via the production module, then verify the actual DOM
    // and the native tab strip separately after reload and a fresh sidebar page.
    const originalSidebarId = data.sidebarId;
    const nativeOrder = await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.map(tab=>tab.id))`);
    await run(`(async()=>{ const order=await import(chrome.runtime.getURL('shared/groupOrder.js')); await order.moveStoredGroupRelative(${data.windowId},${data.second},${data.first},'before'); await order.moveStoredTabRelative(${data.windowId},${data.tabs[3]},${data.tabs[2]},'before'); })()`);
    await run(`document.querySelector('[aria-label="Settings"]').click(); [...document.querySelectorAll('.theme-option')].find(button=>button.textContent==='latte').click(); document.querySelector('[aria-label="Filter sections"]').click(); document.querySelector('[aria-label="Hide tabs"]').click()`);
    await until(() => background("chrome.storage.local.get(['sidebarTheme','hiddenSidebarSections']).then(value=>value.sidebarTheme==='latte'&&value.hiddenSidebarSections?.includes('tabs'))"), 'persisted preferences');
    const assertRestored = async () => {
        await until(() => run(`document.documentElement.dataset.theme==='latte' && document.querySelector('#tabs-list').hidden && document.querySelector('#groups-list > .group-item')?.dataset.groupId==='${data.second}'`), 'restored ordering, theme and section filter');
        const renderedTabs = await run(`[...document.querySelectorAll('[data-group-id="${data.second}"] [data-tab-id]')].map(el=>Number(el.dataset.tabId))`);
        assert.ok(renderedTabs.includes(data.tabs[3]) && renderedTabs.includes(data.tabs[2]), 'both ordered tabs are rendered');
        assert.ok(renderedTabs.indexOf(data.tabs[3]) < renderedTabs.indexOf(data.tabs[2]), 'saved tab order is restored');
        assert.deepEqual(await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.filter(tab=>tab.id!==${data.sidebarId}).map(tab=>tab.id))`), nativeOrder.filter(id=>id!==originalSidebarId), 'logical group order leaves native tab order unchanged');
    };
    await page.send('Page.reload');
    await assertRestored();
    await background(`chrome.tabs.remove(${data.sidebarId})`);
    data.sidebarId = await background(`chrome.tabs.create({windowId:${data.windowId},url:${JSON.stringify(browser.extensionUrl)},active:true}).then(tab=>tab.id)`);
    await openPage();
    await assertRestored();
    console.log('PASS: saved order, section filter and theme survive reload and reopening');

    const beforeEmpty = await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.length)`);
    await run(`document.querySelector('[aria-label="Create group"]').click(); document.querySelector('#group-name-input').value='Keep empty'; document.querySelector('[aria-label="Confirm group creation"]').click()`);
    const emptyId = await until(() => run(`Number([...document.querySelectorAll('.group-item')].find(row=>row.querySelector('.tree-toggle')?.textContent.includes('Keep empty'))?.dataset.groupId) || null`), 'empty group creation');
    assert.equal(await background(`chrome.tabs.query({windowId:${data.windowId}}).then(tabs=>tabs.length)`), beforeEmpty, 'group creation opens no placeholder tab');
    await page.send('Page.reload');
    await until(() => run(`!!document.querySelector('[data-group-id="${emptyId}"]')`), 'empty group survives reload');
    await run(`document.querySelector('[aria-label^="Select tabs and edit"]').click()`);
    await until(() => run(`!!document.querySelector('[data-group-id="${emptyId}"] .row-icon-btn')`), 'empty group edit control');
    await run(`document.querySelector('[data-group-id="${emptyId}"] .row-icon-btn').click(); const form=document.querySelector('[data-group-id="${emptyId}"] .group-edit-form'); form.querySelector('input').value='Still empty'; form.querySelector('select').value='blue'; form.querySelector('[aria-label="Save group changes"]').click()`);
    await until(() => run(`document.querySelector('[data-group-id="${emptyId}"] .tree-toggle')?.textContent.includes('Still empty')`), 'empty group rename');
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await run(`document.querySelector('[data-group-id="${emptyId}"] .row-add-btn').click()`);
    const memberId = await until(() => run(`Number(document.querySelector('[data-group-id="${emptyId}"] [data-tab-id]')?.dataset.tabId) || null`), 'first real tab added to empty group');
    await background(`chrome.tabs.remove(${memberId})`);
    await until(() => run(`!!document.querySelector('[data-group-id="${emptyId}"]') && !document.querySelector('[data-group-id="${emptyId}"] [data-tab-id]')`), 'last tab closes but group remains');
    await drag(tab(data.tabs[0]), group(emptyId));
    await until(() => run(`!!document.querySelector('[data-group-id="${emptyId}"] [data-tab-id="${data.tabs[0]}"]')`), 'drag into empty group');
    await drag(tab(data.tabs[0]), group(data.second));
    await until(() => run(`!!document.querySelector('[data-group-id="${emptyId}"]') && !document.querySelector('[data-group-id="${emptyId}"] [data-tab-id]')`), 'drag out retains empty group');
    await run(`globalThis.originalConfirm=window.confirm; window.confirm=()=>true; document.querySelector('[data-group-id="${emptyId}"] .row-delete-btn').click()`);
    await until(() => run(`!document.querySelector('[data-group-id="${emptyId}"]')`), 'explicit empty group deletion');
    await run('window.confirm=globalThis.originalConfirm');
    await page.send('Page.reload');
    await until(() => run(`!!document.querySelector('[aria-label="Create group"]')`), 'sidebar reload after group deletion');
    assert.equal(await run(`!!document.querySelector('[data-group-id="${emptyId}"]')`), false, 'deleted empty group stays deleted');
    console.log('PASS: empty groups survive reload, last-tab closure and drag-out; add, drop and delete work');
    await background(`chrome.tabs.remove(${data.sidebarId})`);
    await background(`chrome.tabs.remove(${data.tabs[1]})`);
    data.sidebarId = await background(`chrome.tabs.create({windowId:${data.windowId},url:${JSON.stringify(browser.extensionUrl)},active:true}).then(tab=>tab.id)`);
    await openPage();
    await until(() => run(`!!document.querySelector('[data-group-id="${data.first}"]') && !document.querySelector('[data-group-id="${data.first}"] [data-tab-id]')`), 'last native group tab closed while sidebar absent');
    console.log('PASS: background preserves empty native groups while the sidebar is closed');


} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
