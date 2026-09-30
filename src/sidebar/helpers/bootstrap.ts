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
import {
    deferRenderUntilDragSettles,
    setupSidebarDropZones,
} from "./dragAndDrop.js";
import { matchesNodeQuery } from "./nodeSearch.js";
import { replaceListsPreservingInteraction } from "./preserveInteraction.js";

import { setupGroupAction } from "../actions/actionGroup.js";
import { setupBookmarkAction } from "../actions/actionBookmark.js";
import { setupTabAction } from "../actions/actionTab.js";
import { setupSettingAction } from "../actions/actionSetting.js";
import { setupSelectAction } from "../actions/actionSelect.js";
import { buildGroup, groupCollapse } from "../group/group.js";
import { cycleBookmarks, filterBookmarkNodes } from "../bookmark/bookmark.js";
import { createTabSelectionController } from "./tabSelection.js";
import { setupAutoHideScrollbars } from "./scrollbar.js";

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
    setupAutoHideScrollbars();
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
    let activationVersion = 0;
    let activatedTabId: number | null = null;

    function activateTab(tabId: number) {
        // A newly created tab may activate before its creation refresh finishes.
        if (!tabs.some((tab) => tab.id === tabId)) {
            requestTabGroupRefresh();
            return;
        }

        activationVersion += 1;
        activatedTabId = tabId;
        for (const tab of tabs) tab.active = tab.id === tabId;

        for (const list of [elements.tabsList, elements.groupsList]) {
            for (const row of list.querySelectorAll<HTMLElement>(".tab-item")) {
                const isCurrent = row.dataset.tabId === String(tabId);
                row.querySelector(".tab-label")?.classList.toggle("is-current", isCurrent);
            }
        }
    }
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
        if (deferRenderUntilDragSettles(requestTabGroupRefresh)) return;
        replaceListsPreservingInteraction([
            { host: elements.tabsList, next: nextTabs },
            { host: elements.groupsList, next: nextGroups },
        ]);
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
        replaceListsPreservingInteraction([
            { host: elements.bookmarksList, next: nextBookmarks },
        ]);
    }

    requestTabGroupRender = createRenderScheduler(renderTabGroups);
    requestBookmarkRender = createRenderScheduler(renderBookmarks);
    requestTabGroupRefresh = createRenderScheduler(async (isStale) => {
        const versionBeforeLoad = activationVersion;
        const [loadedTabs, loadedGroups] = await loadTabAndGroupData(currentWindowId);
        if (versionBeforeLoad !== activationVersion && activatedTabId != null) {
            for (const tab of loadedTabs) tab.active = tab.id === activatedTabId;
        }
        tabs = loadedTabs;
        groups = loadedGroups;
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
        elements.bookmarksList,
        currentWindowId,
        () => getSearchQuery().length === 0,
        requestTabGroupRefresh,
        requestBookmarkRefresh,
    );

    elements.settings.appendChild(elements.actionPanelSection);

    const actionPanelController = createActionPanelController(
        elements.actionPanelSection,
    );

    await setupGroupAction(elements.actionBtnSection, actionPanelController);
    await setupBookmarkAction(
        elements.actionBtnSection,
        actionPanelController,
        currentWindowId,
    );
    await setupTabAction(elements.actionBtnSection);
    updateSelectAction = setupSelectAction(
        elements.actionBtnSection,
        actionPanelController,
        tabSelection,
        requestTabGroupRefresh,
    );
    await loadThemePreference();
    await setupSettingAction(elements.settings, elements.actionBtnSection);

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
        activateTab,
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !tabSelection.isSelectionMode()) return;
        tabSelection.clear();
    });

    requestRender();
}
