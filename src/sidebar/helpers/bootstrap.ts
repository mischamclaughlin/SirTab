import type {
    SidebarElements,
    RequestRender,
    RenderStaleCheck,
} from "../types.js";

import { setupSearchAction } from "../actions/actionSearch.js";
import { cycleTabs, buildTabSearchState } from "../tab/tab.js";

import { setupEventListeners } from "./events.js";
import { loadBookmarkTree, loadTabAndGroupData } from "./loadData.js";
import { loadThemePreference } from "./theme.js";
import { loadCollapse } from "./collapseState.js";
import { createEmptySearchState } from "./domFactory.js";
import { createRenderScheduler } from "./renderScheduler.js";
import { createActionPanelController } from "./actionPanel.js";
import { setupSidebarDropZones } from "./dragAndDrop.js";
import { matchesNodeQuery } from "./nodeSearch.js";

import { setupGroupAction } from "../actions/actionGroup.js";
import { setupBookmarkAction } from "../actions/actionBookmark.js";
import { setupTabAction } from "../actions/actionTab.js";
import { setupSettingAction } from "../actions/actionSetting.js";
import { setupSelectAction } from "../actions/actionSelect.js";
import { buildGroup, groupCollapse } from "../group/group.js";
import { cycleBookmarks, filterBookmarkNodes } from "../bookmark/bookmark.js";
import { createTabSelectionController } from "./tabSelection.js";

function buildVisibleTabIds(
    visibleUngroupedTabs: chrome.tabs.Tab[],
    groups: chrome.tabGroups.TabGroup[],
    tabsByGroup: Map<number, chrome.tabs.Tab[]>,
    collapsedGroups: Set<string>,
    isSearching: boolean,
    searchQuery: string,
) {
    const visibleTabIds: number[] = [];
    const pushTabId = (tab: chrome.tabs.Tab) => {
        if (tab.id != null) visibleTabIds.push(tab.id);
    };

    visibleUngroupedTabs.forEach(pushTabId);

    for (const group of groups) {
        const groupId = group.id;
        if (groupId == null) continue;
        if (!isSearching && collapsedGroups.has(String(groupId))) continue;

        const tabsInGroup = tabsByGroup.get(groupId) ?? [];
        const groupTitleMatches = isSearching
            ? matchesNodeQuery(group, searchQuery)
            : false;
        const visibleTabsInGroup = isSearching
            ? groupTitleMatches
                ? tabsInGroup
                : tabsInGroup.filter((tab) =>
                      matchesNodeQuery(tab, searchQuery),
                  )
            : tabsInGroup;
        visibleTabsInGroup.forEach(pushTabId);
    }

    return visibleTabIds;
}

function getSidebarElements(): SidebarElements | null {
    const actions = document.getElementById("actions");
    const actionBtnSection = document.createElement("div");
    const actionPanelSection = document.createElement("div");
    const tabsList = document.getElementById("tabs-list");
    const groupsList = document.getElementById("groups-list");
    const bookmarksList = document.getElementById("bookmarks-list");
    const settings = document.getElementById("settings");

    if (!actions || !tabsList || !groupsList || !bookmarksList || !settings) {
        return null;
    }

    actionBtnSection.className = "action-controls";
    actionPanelSection.className = "action-panel";

    return {
        actions,
        actionBtnSection,
        actionPanelSection,
        tabsList,
        groupsList,
        bookmarksList,
        settings,
    };
}

export async function bootstrapSidebar() {
    const sidebarElements = getSidebarElements();
    if (!sidebarElements) return;
    const elements: SidebarElements = sidebarElements;
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id == null) return;
    const currentWindowId = currentWindow.id;

    const collapsedGroups = new Set<string>();
    const collapsedBookmarkFolders = new Set<string>();

    let getSearchQuery = () => "";
    let requestTabGroupRender: RequestRender = () => {};
    let requestTabGroupRefresh: RequestRender = () => {};
    let requestBookmarkRender: RequestRender = () => {};
    let requestBookmarkRefresh: RequestRender = () => {};
    let updateSelectAction: RequestRender = () => {};

    let tabs: chrome.tabs.Tab[] = [];
    let groups: chrome.tabGroups.TabGroup[] = [];
    let bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [];
    const tabSelection = createTabSelectionController(() => {
        requestTabGroupRender();
        requestBookmarkRender();
    });

    async function renderTabGroups(isStale: RenderStaleCheck) {
        await groupCollapse(groups, collapsedGroups);
        if (isStale()) return;

        const searchQuery = getSearchQuery();
        const enableDragDrop = searchQuery.length === 0;

        const [visibleUngroupedTabs, tabsByGroup, isSearching] =
            buildTabSearchState(tabs, searchQuery);
        const visibleTabIds = buildVisibleTabIds(
            visibleUngroupedTabs,
            groups,
            tabsByGroup,
            collapsedGroups,
            isSearching,
            searchQuery,
        );

        const nextTabs = document.createElement("ul");
        cycleTabs(nextTabs, visibleUngroupedTabs, {
            grouped: false,
            windowId: currentWindowId,
            enableDragDrop,
            requestRender: requestTabGroupRefresh,
            tabSelection,
            visibleTabIds,
        });
        elements.tabsList.replaceChildren(...Array.from(nextTabs.children));

        const nextGroups = document.createElement("ul");
        buildGroup(
            visibleUngroupedTabs.length > 0,
            groups,
            tabsByGroup,
            collapsedGroups,
            isSearching,
            searchQuery,
            nextGroups,
            currentWindowId,
            requestTabGroupRefresh,
            enableDragDrop,
            tabSelection,
            visibleTabIds,
        );
        elements.groupsList.replaceChildren(...Array.from(nextGroups.children));
        updateSelectAction();
    }

    async function renderBookmarks(_isStale: RenderStaleCheck) {
        const searchQuery = getSearchQuery();
        const isSearching = searchQuery.length > 0;
        const nextBookmarks = document.createElement("ul");
        const bookmarkNodes = isSearching
            ? filterBookmarkNodes(bookmarkTree, searchQuery)
            : bookmarkTree;
        cycleBookmarks(
            nextBookmarks,
            bookmarkNodes,
            isSearching,
            collapsedBookmarkFolders,
            requestBookmarkRefresh,
            tabSelection,
        );
        if (isSearching && nextBookmarks.childElementCount === 0) {
            nextBookmarks.appendChild(
                createEmptySearchState("No matching bookmarks."),
            );
        }
        elements.bookmarksList.replaceChildren(
            ...Array.from(nextBookmarks.children),
        );
    }

    requestTabGroupRender = createRenderScheduler(renderTabGroups);
    requestBookmarkRender = createRenderScheduler(renderBookmarks);
    requestTabGroupRefresh = createRenderScheduler(async (isStale) => {
        [tabs, groups] = await loadTabAndGroupData(currentWindowId);
        tabSelection.prune(
            tabs
                .map((tab) => tab.id)
                .filter((tabId): tabId is number => tabId != null),
        );
        if (isStale()) return;
        await renderTabGroups(isStale);
    });
    requestBookmarkRefresh = createRenderScheduler(async (isStale) => {
        bookmarkTree = await loadBookmarkTree();
        if (isStale()) return;
        await renderBookmarks(isStale);
    });

    const requestRender: RequestRender = () => {
        requestTabGroupRender();
        requestBookmarkRender();
    };

    getSearchQuery = setupSearchAction(elements.actions, requestRender);
    setupSidebarDropZones(
        elements.tabsList,
        elements.groupsList,
        currentWindowId,
        () => getSearchQuery().length === 0,
        requestTabGroupRefresh,
    );

    elements.actions.appendChild(elements.actionBtnSection);
    elements.actions.appendChild(elements.actionPanelSection);

    const actionPanelController = createActionPanelController(
        elements.actionPanelSection,
    );

    await setupGroupAction(elements.actionBtnSection, actionPanelController);
    await setupBookmarkAction(
        elements.actionBtnSection,
        actionPanelController,
    );
    await setupTabAction(elements.actionBtnSection);
    updateSelectAction = setupSelectAction(
        elements.actionBtnSection,
        actionPanelController,
        tabSelection,
        requestTabGroupRefresh,
    );
    await loadThemePreference();
    await setupSettingAction(elements.settings);

    const loadInitialData = async () => {
        const [[loadedTabs, loadedGroups], loadedBookmarkTree] =
            await Promise.all([
                loadTabAndGroupData(currentWindowId),
                loadBookmarkTree(),
            ]);

        tabs = loadedTabs;
        groups = loadedGroups;
        bookmarkTree = loadedBookmarkTree;
    };

    await Promise.all([
        loadInitialData(),
        loadCollapse(collapsedBookmarkFolders, "bookmark"),
        loadCollapse(collapsedGroups, "tab"),
    ]);

    setupEventListeners(currentWindowId, {
        requestTabGroupRefresh,
        requestBookmarkRefresh,
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !tabSelection.isSelectionMode()) return;
        tabSelection.clear();
    });

    requestRender();
}
