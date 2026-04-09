import type { SidebarElements, RequestRender } from "../types.js";

import { setupSearchAction } from "../actions/actionSearch.js";
import { cycleTabs, buildTabSearchState } from "../tab/tab.js";

import { setupEventListeners } from "./events.js";
import { loadAllData } from "./loadData.js";
import { loadThemePreference } from "./theme.js";
import { loadCollapse } from "./collapseState.js";
import { createEmptySearchState } from "./domFactory.js";
import { createRenderScheduler } from "./renderScheduler.js";

import { setupGroupAction } from "../actions/actionGroup.js";
import { setupBookmarkAction } from "../actions/actionBookmark.js";
import { setupTabAction } from "../actions/actionTab.js";
import { setupSettingAction } from "../actions/actionSetting.js";
import { buildGroup, groupCollapse } from "../group/group.js";
import { cycleBookmarks, filterBookmarkNodes } from "../bookmark/bookmark.js";

function getSidebarElements(): SidebarElements | null {
    const actions = document.getElementById("actions");
    const actionBtnSection = document.createElement("div");
    const tabList = document.getElementById("tabs-and-groups");
    const bookmarksList = document.getElementById("bookmarks-list");
    const settings = document.getElementById("settings");

    if (!actions || !tabList || !bookmarksList || !settings) return null;

    actionBtnSection.className = "action-btn-section";

    return {
        actions,
        actionBtnSection,
        tabList,
        bookmarksList,
        settings,
    };
}

export async function bootstrapSidebar() {
    const sidebarElements = getSidebarElements();
    if (!sidebarElements) return;
    const elements: SidebarElements = sidebarElements;

    let renderToken = 0;
    const collapsedGroups = new Set<string>();
    const collapsedBookmarkFolders = new Set<string>();

    let getSearchQuery = () => "";
    let requestRender: RequestRender = () => {};

    async function render() {
        const token = ++renderToken;

        const [tabs, groups, tree] = await loadAllData();
        if (token !== renderToken) return;

        await groupCollapse(groups, collapsedGroups);
        if (token !== renderToken) return;

        const searchQuery = getSearchQuery();

        const [visibleUngroupedTabs, tabsByGroup, isSearching] =
            buildTabSearchState(tabs, searchQuery);

        const next = document.createElement("ul");
        cycleTabs(next, visibleUngroupedTabs, false);

        buildGroup(
            visibleUngroupedTabs,
            groups,
            tabsByGroup,
            collapsedGroups,
            isSearching,
            searchQuery,
            next,
            requestRender,
        );

        elements.tabList.replaceChildren(...Array.from(next.children));

        const nextBookmarks = document.createElement("ul");
        const bookmarkNodes = isSearching
            ? filterBookmarkNodes(tree, searchQuery)
            : tree;
        cycleBookmarks(
            nextBookmarks,
            bookmarkNodes,
            isSearching,
            collapsedBookmarkFolders,
            requestRender,
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

    requestRender = createRenderScheduler(render);
    getSearchQuery = setupSearchAction(elements.actions, requestRender);

    setupEventListeners(requestRender);
    await loadThemePreference();

    elements.actions.appendChild(elements.actionBtnSection);
    await setupGroupAction(elements.actions, elements.actionBtnSection);
    await setupBookmarkAction(elements.actions, elements.actionBtnSection);
    await setupTabAction(elements.actionBtnSection);
    await setupSettingAction(elements.settings);

    await loadCollapse(collapsedBookmarkFolders, "bookmark");
    await loadCollapse(collapsedGroups, "tab");

    requestRender();
}
