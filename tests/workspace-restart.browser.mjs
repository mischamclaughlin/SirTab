import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchExtension, until } from './helpers/extension-browser.mjs';

// This suite keeps one disposable profile across real process exits. Run after
// building, outside node --test; the local web server stays alive across restarts.
const root = fileURLToPath(new URL('..', import.meta.url));
const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>${new URL(request.url, 'http://localhost').pathname.slice(1)}</title>`);
});
let browser, profile;
try {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = name => `${origin}/${name}`;
    browser = await launchExtension(root, { keepProfile: true });
    profile = browser.profile;
    let background = expression => browser.background.evaluate(expression);
    let apiPage, apiBrowser;
    const moduleEvaluate = async expression => {
        if (!apiPage || apiBrowser !== browser) {
            let target = (await browser.targets()).find(target => target.type === 'page' && target.url === browser.extensionUrl);
            if (!target) {
                await background(`chrome.tabs.create({url:${JSON.stringify(browser.extensionUrl)},active:false})`);
                target = await until(async () => (await browser.targets()).find(target => target.type === 'page' && target.url === browser.extensionUrl), 'extension module page');
            }
            apiPage = await browser.connect(target, false);
            await apiPage.send('Page.navigate', {url:browser.extensionUrl});
            await apiPage.send('Runtime.enable');
            apiBrowser = browser;
        }
        return apiPage.evaluate(expression);
    };
    const setup = await moduleEvaluate(`(async()=>{
        await chrome.storage.local.set({shortcutPromptDismissed:true});
        const initialTabs=await chrome.tabs.query({});
        const windowId=initialTabs[0].windowId;
        const names=['Outside-a','Outside-b','A-one','A-two','B-one','B-two','Closed-deliberately','Duplicate','Duplicate'];
        const tabs=[];
        for(const name of names) tabs.push(await chrome.tabs.create({windowId,url:${JSON.stringify(origin)}+'/'+name,active:false}));
        await chrome.tabs.remove(initialTabs.filter(tab=>tab.url!==${JSON.stringify(browser.extensionUrl)}).map(tab=>tab.id));
        const first=await chrome.tabs.group({tabIds:[tabs[2].id,tabs[3].id]});
        const second=await chrome.tabs.group({tabIds:[tabs[4].id,tabs[5].id]});
        await chrome.tabGroups.update(first,{title:'First',color:'blue'});
        await chrome.tabGroups.update(second,{title:'Second',color:'green'});
        const persistent=await import(chrome.runtime.getURL('shared/persistentGroups.js'));
        const empty=await persistent.createPersistentGroup(windowId,'Empty','pink');
        const order=await import(chrome.runtime.getURL('shared/groupOrder.js'));
        await order.moveStoredGroupRelative(windowId,second,first,'before');
        await order.moveStoredGroupRelative(windowId,empty.id,first,'before');
        await order.moveStoredTabRelative(windowId,tabs[1].id,tabs[0].id,'before');
        await order.moveStoredTabRelative(windowId,tabs[3].id,tabs[2].id,'before');
        await order.moveStoredTabRelative(windowId,tabs[5].id,tabs[4].id,'before');
        const tree=await chrome.bookmarks.getTree();
        const bar=tree[0].children.find(node=>node.folderType==='bookmarks-bar'||node.id==='1');
        const folder=await chrome.bookmarks.create({parentId:bar.id,title:'Workspace bookmarks'});
        const bookmarks=[];
        for(const title of ['One','Two','Three']) bookmarks.push(await chrome.bookmarks.create({parentId:folder.id,title,url:${JSON.stringify(origin)}+'/bookmark-'+title}));
        await chrome.bookmarks.move(bookmarks[0].id,{parentId:folder.id,index:3});
        return {windowId,first,second,empty:empty.id,tabs:tabs.map(tab=>tab.id),folder:folder.id};
    })()`);
    const expectedUngrouped = ['Outside-b', 'Outside-a', 'Duplicate', 'Duplicate'];
    const expectedGroups = ['Second', 'Empty', 'First'];
    const expectedGroupTabs = { Second: ['B-two', 'B-one'], Empty: [], First: ['A-two', 'A-one'] };
    const expectedUrls = [...expectedUngrouped, ...expectedGroupTabs.Second, ...expectedGroupTabs.First].map(url).sort();
    await until(() => background(`chrome.storage.local.get('workspaceSnapshot:${setup.windowId}').then(storage=>{
        const snapshot=storage['workspaceSnapshot:${setup.windowId}'];
        return snapshot?.tabs?.length===9 && snapshot.groups?.map(group=>group.title).join('|')==='Second|Empty|First';
    })`), 'initial durable workspace with logical order');
    await background(`chrome.tabs.remove(${setup.tabs[6]})`);
    await until(() => background(`chrome.storage.local.get('workspaceSnapshot:${setup.windowId}').then(storage=>{
        const snapshot=storage['workspaceSnapshot:${setup.windowId}'];
        return snapshot?.tabs?.length===8 && !snapshot.tabs.some(tab=>tab.url===${JSON.stringify(url('Closed-deliberately'))});
    })`), 'individual tab close saved before shutdown');

    let lastLogical;
    const inspect = async () => {
        const all = await background(`chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>(tab.pendingUrl||tab.url||'').startsWith(${JSON.stringify(origin + '/')})).map(tab=>({id:tab.id,windowId:tab.windowId,url:tab.pendingUrl||tab.url,title:tab.title})))`);
        assert.deepEqual(all.map(tab => tab.url).sort(), expectedUrls, 'restored URL multiplicity has no missing, extra or deliberately closed tabs');
        assert.equal(new Set(all.map(tab => tab.windowId)).size, 1, 'workspace tabs share their restored window');
        const windowId = all[0].windowId;
        const logical = await moduleEvaluate(`(async()=>{
            const order=await import(chrome.runtime.getURL('shared/groupOrder.js'));
            const data=await order.loadLogicalTabGroupData(${windowId});
            const name=tab=>new URL(tab.pendingUrl||tab.url).pathname.slice(1);
            return {
                ungrouped:data.tabs.filter(tab=>tab.groupId===-1 && (tab.pendingUrl||tab.url).startsWith(${JSON.stringify(origin)})).map(name),
                groups:data.groups.map(group=>({title:group.title,tabs:data.tabs.filter(tab=>tab.groupId===group.id).map(name)})),
            };
        })()`);
        lastLogical = logical;
        assert.deepEqual(logical.ungrouped, expectedUngrouped, 'ungrouped logical tab order survives');
        assert.deepEqual(logical.groups.map(group => group.title), expectedGroups, 'logical group order and empty group survive');
        for (const group of logical.groups) assert.deepEqual(group.tabs, expectedGroupTabs[group.title], `tab order in ${group.title} survives`);
        assert.deepEqual(await background(`chrome.bookmarks.getChildren(${JSON.stringify(setup.folder)}).then(nodes=>nodes.map(node=>node.title))`), ['Two', 'Three', 'One'], 'native bookmark order survives');
        return windowId;
    };
    const waitRestored = async () => {
        await until(() => background(`chrome.tabs.query({}).then(tabs=>tabs.filter(tab=>(tab.pendingUrl||tab.url||'').startsWith(${JSON.stringify(origin + '/')})).length===8)`), 'automatic recovery of all workspace tabs', 30000);
        let lastError;
        try {
            await until(async () => {
                try { await inspect(); return true; } catch (error) { lastError = error; return false; }
            }, 'restored groups and logical orders', 30000);
        } catch (error) {
            console.log('Last logical state:', lastLogical, String(lastError));
            console.log('Saved workspaces:', await background(`chrome.storage.local.get(null).then(storage=>Object.entries(storage).filter(([key])=>key.startsWith('workspaceSnapshot:')).map(([key,value])=>({key,groups:value.groups,tabs:value.tabs.map(tab=>({id:tab.id,url:tab.url,groupId:tab.groupId}))})))`));
            throw error;
        }
        return inspect();
    };
    const assertSidebar = async windowId => {
        await background(`(async()=>{
            const existing=await chrome.tabs.query({windowId:${windowId}});
            if(!existing.some(tab=>tab.url===${JSON.stringify(browser.extensionUrl)})) await chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(browser.extensionUrl)},active:true});
        })()`);
        const target = await until(async () => (await browser.targets()).find(target => target.type === 'page' && target.url === browser.extensionUrl), 'restored sidebar target');
        const page = await browser.connect(target, false);
        await page.send('Page.navigate', {url:browser.extensionUrl});
        await page.send('Runtime.enable');
        try {
            await until(() => page.evaluate(`document.querySelectorAll('#groups-list > .group-item').length===3 && document.querySelectorAll('#tabs-list > .tab-item').length>=4`), 'restored sidebar content');
        } catch (error) {
            console.log('Sidebar diagnostics:', await page.evaluate(`({text:document.body.innerText,groups:document.querySelectorAll('#groups-list > .group-item').length,labels:[...document.querySelectorAll('#tabs-list .tab-label')].map(label=>label.textContent)})`));
            console.log('Tab diagnostics:', await background('chrome.tabs.query({}).then(tabs=>tabs.map(tab=>({url:tab.url,title:tab.title,windowId:tab.windowId,groupId:tab.groupId})))'));
            throw error;
        }
        const visible = await page.evaluate(`(async()=>{
            const tabs=await chrome.tabs.query({windowId:${windowId}});
            const names=Object.fromEntries(tabs.filter(tab=>(tab.pendingUrl||tab.url||'').startsWith(${JSON.stringify(origin + '/')})).map(tab=>[tab.id,new URL(tab.pendingUrl||tab.url).pathname.slice(1)]));
            const name=item=>names[item.dataset.tabId];
            return {
                ungrouped:[...document.querySelectorAll('#tabs-list > .tab-item')].map(name).filter(Boolean),
                groups:[...document.querySelectorAll('#groups-list > .group-item')].map(item=>({title:item.querySelector('.tree-toggle-title').textContent,tabs:[...item.querySelectorAll('.group-tabs > .tab-item')].map(name).filter(Boolean)})),
                bookmarks:[...document.querySelectorAll('[data-bookmark-folder-id="${setup.folder}"] > .bookmark-nested-list > .tab-item .tab-label')].map(label=>label.textContent),
            };
        })()`);
        assert.deepEqual(visible.ungrouped.filter(title => expectedUngrouped.includes(title)), expectedUngrouped, 'sidebar displays restored ungrouped tab order');
        assert.deepEqual(visible.groups.map(group => group.title), expectedGroups, 'sidebar displays restored group order');
        for (const group of visible.groups) assert.deepEqual(group.tabs, expectedGroupTabs[group.title], `sidebar displays restored tab order in ${group.title}`);
        assert.deepEqual(visible.bookmarks, ['Two', 'Three', 'One'], 'sidebar displays native bookmark order');
    };

    await background(`chrome.tabs.query({}).then(tabs=>chrome.tabs.remove(tabs.filter(tab=>tab.url===${JSON.stringify(browser.extensionUrl)}).map(tab=>tab.id)))`);
    apiPage = null;
    await browser.stop();
    browser = await launchExtension(root, { profile });
    background = expression => browser.background.evaluate(expression);
    let restoredWindow = await waitRestored();
    await assertSidebar(restoredWindow);
    console.log('PASS: clean browser relaunch restores saved tabs, duplicate URLs, group/tab order, empty groups and bookmarks');

    const oldWorker = (await browser.targets()).find(target => target.type === 'service_worker' && target.url.endsWith('/background/background.js'));
    const workerPage = await browser.connect((await browser.targets()).find(target => target.type === 'page' && target.url === browser.extensionUrl));
    await workerPage.send('ServiceWorker.enable');
    await workerPage.send('ServiceWorker.stopAllWorkers');
    await until(async () => !(await browser.targets()).some(target => target.id === oldWorker.id), 'old extension worker stop');
    await workerPage.send('Page.reload');
    const newWorker = await until(async () => (await browser.targets()).find(target => target.type === 'service_worker' && target.url.endsWith('/background/background.js')), 'restarted extension worker');
    browser.background = await browser.connect(newWorker);
    apiPage = null;
    await waitRestored();
    console.log('PASS: worker restart preserves the workspace without duplicate tabs');

    await browser.stop();
    browser = await launchExtension(root, { profile, args: ['--restore-last-session'] });
    background = expression => browser.background.evaluate(expression);
    restoredWindow = await waitRestored();
    await assertSidebar(restoredWindow);
    console.log('PASS: native browser session restoration and Sir Tab recovery do not duplicate tabs');

    await browser.stop({ crash: true });
    browser = await launchExtension(root, { profile });
    background = expression => browser.background.evaluate(expression);
    await waitRestored();
    console.log('PASS: abrupt browser termination preserves the last durable workspace');
} finally {
    if (browser) await browser.close();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await new Promise(resolve => server.close(resolve));
}
