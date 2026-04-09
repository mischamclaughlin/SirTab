import { setupSearchAction } from "./actions/actionSearch.js";
import { cycleTabs, buildTabSearchState } from "./tab/tab.js";

import { setupEventListeners } from "./helpers/sidebarEvents.js";
import { loadAllData } from "./helpers/loadData.js";
import { loadThemePreference } from "./helpers/theme.js";
import { loadCollapse } from "./helpers/collapseState.js";
import { createEmptySearchState } from "./helpers/domFactory.js";
import { queueRender } from "./helpers/renderScheduler.js";

import { setupGroupAction } from "./actions/actionGroup.js";
import { setupBookmarkAction } from "./actions/actionBookmark.js";
import { setupTabAction } from "./actions/actionTab.js";
import { setupSettingAction } from "./actions/actionSetting.js";
import { buildGroup, groupCollapse } from "./group/group.js";
import { cycleBookmarks, filterBookmarkNodes } from "./bookmark/bookmark.js";

document.addEventListener("DOMContentLoaded", async () => {
    // Setup event listeners
    let renderToken = 0;
    let renderQueued = false;

    setupEventListeners(() => renderQueued, render);

    // Load and apply theme preference
    await loadThemePreference();

    // Action Section
    const actions = document.getElementById("actions");
    if (!actions) return;

    const actionBtnSection = document.createElement("div");
    if (!actionBtnSection) return;

    //  - Search
    const getSearchQuery = await setupSearchAction(
        actions,
        renderQueued,
        render,
    );

    // - Action Btn Section
    actionBtnSection.className = "action-btn-section";
    actions.appendChild(actionBtnSection);
    // -- Group +
    await setupGroupAction(actions, actionBtnSection);
    // -- Bookmark +
    await setupBookmarkAction(actions, actionBtnSection);
    // -- Tab +
    await setupTabAction(actionBtnSection);

    // -- Settings
    const settings = document.getElementById("settings");
    if (!settings) return;
    await setupSettingAction(settings);

    // Tabs & Groups Section
    const collapsedGroups = new Set<string>();
    const tabList = document.getElementById("tabs-and-groups");
    if (!tabList) return;

    // Bookmarks Section
    const collapsedBookmarkFolders = new Set<string>();
    const bookmarksList = document.getElementById("bookmarks-list");
    if (!bookmarksList) return;

    // Initial load
    await loadCollapse(collapsedBookmarkFolders, "bookmark");
    await loadCollapse(collapsedGroups, "tab");
    queueRender(renderQueued, render);

    // Render function
    async function render() {
        const token = ++renderToken;
        if (token !== renderToken) return;

        const [tabs, groups, tree] = await loadAllData();
        await groupCollapse(groups, collapsedGroups);

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
            render,
        );

        tabList?.replaceChildren(...Array.from(next.children));

        if (bookmarksList) {
            const nextBookmarks = document.createElement("ul");
            const bookmarkNodes = isSearching
                ? filterBookmarkNodes(tree, searchQuery)
                : tree;
            cycleBookmarks(
                nextBookmarks,
                bookmarkNodes,
                isSearching,
                collapsedBookmarkFolders,
                () => void render(),
            );
            if (isSearching && nextBookmarks.childElementCount === 0) {
                nextBookmarks.appendChild(
                    createEmptySearchState("No matching bookmarks."),
                );
            }
            bookmarksList.replaceChildren(
                ...Array.from(nextBookmarks.children),
            );
        }
    }
});
