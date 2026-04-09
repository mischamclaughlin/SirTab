export async function loadAllData() {
    return Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
        chrome.bookmarks.getTree(),
    ]);
}
