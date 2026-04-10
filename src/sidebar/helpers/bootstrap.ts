import type {
    SidebarElements,
    RequestRender,
    RenderStaleCheck,
} from "../types.js";

import { setupSearchAction } from "../actions/actionSearch.js";
import { cycleTabs, buildTabSearchState } from "../tab/tab.js";

import { setupEventListeners } from "./events.js";
import { loadAllData } from "./loadData.js";
import { loadThemePreference } from "./theme.js";
import { loadCollapse } from "./collapseState.js";
import { createEmptySearchState } from "./domFactory.js";
import { createRenderScheduler } from "./renderScheduler.js";
import { createActionPanelController } from "./actionPanel.js";
import { setupSidebarDropZones } from "./dragAndDrop.js";

import { setupGroupAction } from "../actions/actionGroup.js";
import { setupBookmarkAction } from "../actions/actionBookmark.js";
import { setupTabAction } from "../actions/actionTab.js";
import { setupSettingAction } from "../actions/actionSetting.js";
import { buildGroup, groupCollapse } from "../group/group.js";
import { cycleBookmarks, filterBookmarkNodes } from "../bookmark/bookmark.js";

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

    const collapsedGroups = new Set<string>();
    const collapsedBookmarkFolders = new Set<string>();

    let getSearchQuery = () => "";
    let requestRender: RequestRender = () => {};

    async function render(isStale: RenderStaleCheck) {
        const [tabs, groups, tree] = await loadAllData();
        if (isStale()) return;

        await groupCollapse(groups, collapsedGroups);
        if (isStale()) return;

        const searchQuery = getSearchQuery();
        const enableDragDrop = searchQuery.length === 0;

        const [visibleUngroupedTabs, tabsByGroup, isSearching] =
            buildTabSearchState(tabs, searchQuery);

        const nextTabs = document.createElement("ul");
        cycleTabs(nextTabs, visibleUngroupedTabs, {
            grouped: false,
            enableDragDrop,
            requestRender,
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
            requestRender,
            enableDragDrop,
        );
        elements.groupsList.replaceChildren(...Array.from(nextGroups.children));

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
    setupSidebarDropZones(
        elements.tabsList,
        elements.groupsList,
        () => getSearchQuery().length === 0,
        requestRender,
    );

    setupEventListeners(requestRender);
    await loadThemePreference();

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
    await setupSettingAction(elements.settings);

    await loadCollapse(collapsedBookmarkFolders, "bookmark");
    await loadCollapse(collapsedGroups, "tab");

    requestRender();
}
