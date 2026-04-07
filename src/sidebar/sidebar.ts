import {
    createDeleteButton,
    buildCycle,
    resetCreationState,
    nodeQuery,
    persistCollapse,
    getCurrentWindowId,
    toggleInList,
} from "./helpers.js";
import {
    DEFAULT_TAB_ICON_URL,
    THEMES,
    THEME_STORAGE_KEY,
    groupColorMap,
    chromeToUiColor,
    type SidebarTheme,
    type GroupColorChoice,
} from "./config.js";
import {
    collectBookmarkFolderChoices,
    isAllowedBookmarkUrl,
} from "./bookmark/bookmark.js";

document.addEventListener("DOMContentLoaded", async () => {
    function applyTheme(theme: SidebarTheme) {
        document.documentElement.setAttribute("data-theme", theme);
    }

    async function loadThemePreference() {
        const storage = await chrome.storage.local.get(THEME_STORAGE_KEY);
        const savedTheme = storage[THEME_STORAGE_KEY];
        const normalizedSavedTheme =
            savedTheme === "standard-dark"
                ? "dark"
                : savedTheme === "standard-light"
                  ? "light"
                  : savedTheme === "catppuccin-dark"
                    ? "mocha"
                    : savedTheme === "catppuccin-light"
                      ? "latte"
                      : savedTheme === "cappucin-light"
                        ? "latte"
                        : savedTheme === "claude" || savedTheme === "retro"
                          ? "retro-dark"
                          : savedTheme;
        const theme = THEMES.includes(savedTheme as SidebarTheme)
            ? (savedTheme as SidebarTheme)
            : THEMES.includes(normalizedSavedTheme as SidebarTheme)
              ? (normalizedSavedTheme as SidebarTheme)
              : "dark";
        applyTheme(theme);
    }

    await loadThemePreference();

    // Action Section
    const actions = document.getElementById("actions");
    if (!actions) return;

    //  -- Search
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "search tabs and bookmarks";
    searchInput.className = "search-input";
    searchInput.autofocus = true;
    actions.appendChild(searchInput);
    let searchQuery = "";

    searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        queueRender();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || searchInput.value.length === 0) return;
        searchInput.value = "";
        searchQuery = "";
        queueRender();
    });

    chrome.sidePanel.onOpened.addListener(() => {
        window.focus();
        searchInput.focus();
    });

    document.addEventListener("keydown", (event) => {
        const isFocusShortcut =
            (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b";
        if (!isFocusShortcut) return;

        event.preventDefault();
        window.focus();
        searchInput.focus();
    });

    const actionBtnSection = document.createElement("div");
    actionBtnSection.className = "action-btn-section";
    actions.appendChild(actionBtnSection);

    // -- Group +
    const btnGroup = document.createElement("button");
    btnGroup.textContent = "group +";
    btnGroup.className = "action-btn";
    actionBtnSection.appendChild(btnGroup);

    let creatingGroup = false;

    btnGroup.addEventListener("click", async () => {
        if (creatingGroup) {
            creatingGroup = resetCreationState(actions, btnGroup, "tab");
            return;
        }

        const groupInfoDropdown = document.createElement("div");
        groupInfoDropdown.className = "info-dropdown";

        creatingGroup = true;
        btnGroup.textContent = "cancel !";

        actions?.appendChild(groupInfoDropdown);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "group name";
        textInput.className = "group-name-input";

        const colourSelect = document.createElement("select");
        colourSelect.className = "group-colour-select";

        const colourChoices = Object.keys(groupColorMap) as GroupColorChoice[];
        for (const choice of colourChoices) {
            const option = document.createElement("option");
            option.value = choice;
            option.textContent = choice;
            colourSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "confirm";
        confirmBtn.className = "group-confirm-btn";

        groupInfoDropdown.append(textInput, colourSelect, confirmBtn);

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", async () => {
            const homeTab = await chrome.tabs.create({
                url: "chrome://newtab",
                active: false,
            });

            if (homeTab?.id == null) {
                creatingGroup = resetCreationState(actions, btnGroup, "tab");
                return;
            }

            const groupName = textInput.value.trim() || "";
            const selectedColour = colourSelect.value as GroupColorChoice;

            const groupId = await chrome.tabs.group({ tabIds: [homeTab.id] });
            await chrome.tabGroups.update(groupId, {
                title: groupName,
                color: groupColorMap[selectedColour] ?? "grey",
                collapsed: false,
            });

            creatingGroup = resetCreationState(actions, btnGroup, "tab");
        });
    });

    // -- Bookmark +
    const btnNewBookmark = document.createElement("button");
    btnNewBookmark.textContent = "bookmark +";
    btnNewBookmark.className = "action-btn";
    actionBtnSection.appendChild(btnNewBookmark);

    let isAddCurrentTab = false;
    let creatingBookmark = false;

    btnNewBookmark.addEventListener("click", async () => {
        if (creatingBookmark) {
            creatingBookmark = resetCreationState(
                actions,
                btnNewBookmark,
                "bookmark",
            );
            return;
        }

        const addCurrentTab = document.createElement("button");
        addCurrentTab.type = "button";
        addCurrentTab.className = "add-current-tab-btn";
        addCurrentTab.textContent = `add current tab: ${isAddCurrentTab}`;
        actions.append(addCurrentTab);

        const bookmarkInfoDropdown = document.createElement("div");
        bookmarkInfoDropdown.className = "info-dropdown";
        addCurrentTab.className = isAddCurrentTab
            ? "add-current-tab-btn add-current-tab-btn--active"
            : "add-current-tab-btn";

        creatingBookmark = true;
        btnNewBookmark.textContent = "cancel !";

        actions.append(bookmarkInfoDropdown);

        addCurrentTab.addEventListener("click", async () => {
            isAddCurrentTab = !isAddCurrentTab;
            addCurrentTab.className = isAddCurrentTab
                ? "add-current-tab-btn add-current-tab-btn--active"
                : "add-current-tab-btn";
            addCurrentTab.textContent = `add current tab: ${isAddCurrentTab}`;
        });

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "folder / bookmark name";
        textInput.className = "bookmark-name-input";

        const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] =
            await chrome.bookmarks.getTree();
        const folderChoices = collectBookmarkFolderChoices(bookmarkTree);
        if (folderChoices.length === 0) {
            creatingBookmark = resetCreationState(
                actions,
                btnNewBookmark,
                "bookmark",
            );
            return;
        }

        const bookmarkSelect = document.createElement("select");
        bookmarkSelect.className = "bookmark-select";

        for (const folder of folderChoices) {
            const option = document.createElement("option");
            option.value = folder.id;
            option.textContent = folder.label;
            bookmarkSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "confirm";
        confirmBtn.className = "bookmark-confirm-btn";

        bookmarkInfoDropdown.append(textInput, bookmarkSelect, confirmBtn);
        textInput.focus();

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", async () => {
            const selectedFolderId = bookmarkSelect.value;
            if (!selectedFolderId) return;

            const typedName = textInput.value.trim();

            if (isAddCurrentTab) {
                const bookmarkName = typedName || "new bookmark";
                const [currentTab] = await chrome.tabs.query({
                    active: true,
                    lastFocusedWindow: true,
                });
                if (!currentTab) return;

                await chrome.bookmarks.create({
                    title: bookmarkName,
                    url: currentTab.url,
                    parentId: selectedFolderId,
                });
            } else if (!isAddCurrentTab) {
                const folderName = typedName || "new folder";

                await chrome.bookmarks.create({
                    title: folderName,
                    parentId: selectedFolderId,
                });
            }
            creatingBookmark = resetCreationState(
                actions,
                btnNewBookmark,
                "bookmark",
            );
        });
    });

    // -- Tab +
    const btnNewTab = document.createElement("button");
    btnNewTab.textContent = "tab +";
    btnNewTab.className = "action-btn";
    actionBtnSection.appendChild(btnNewTab);

    btnNewTab.addEventListener("click", async () => {
        await chrome.tabs.create({
            url: "chrome://newtab",
            active: false,
        });
    });

    // -- Settings
    const settings = document.getElementById("settings");

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.textContent = "settings";
    settingsBtn.className = "action-btn settings-btn";

    const settingInfoSection = document.createElement("div");
    settingInfoSection.className = "setting-info-section";
    settingInfoSection.hidden = true;

    const themeOptions = document.createElement("div");
    themeOptions.className = "theme-options";

    const themeLabels: Record<SidebarTheme, string> = {
        dark: "dark",
        light: "light",
        mocha: "mocha",
        latte: "latte",
        "retro-dark": "retro dark",
        "retro-light": "retro light",
    };

    const themeButtons = new Map<SidebarTheme, HTMLButtonElement>();
    for (const theme of THEMES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "theme-option-btn";
        button.textContent = themeLabels[theme];
        button.addEventListener("click", async () => {
            applyTheme(theme);
            await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
            for (const [id, btn] of themeButtons) {
                btn.classList.toggle("active-theme", id === theme);
            }
        });
        themeButtons.set(theme, button);
        themeOptions.append(button);
    }

    const currentTheme = document.documentElement.getAttribute(
        "data-theme",
    ) as SidebarTheme | null;
    const initialTheme =
        currentTheme && THEMES.includes(currentTheme) ? currentTheme : "dark";
    for (const [id, btn] of themeButtons) {
        btn.classList.toggle("active-theme", id === initialTheme);
    }

    settingInfoSection.appendChild(themeOptions);

    let isSettingOpen = false;

    settingsBtn.addEventListener("click", () => {
        isSettingOpen = !isSettingOpen;
        settingInfoSection.hidden = !isSettingOpen;
    });

    settings?.append(settingsBtn, settingInfoSection);

    // Tabs & Groups Section
    const collapsedGroups = new Set<string>();
    const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedGroupsByWindow";

    async function loadCollapsedGroups() {
        const windowId = await getCurrentWindowId();
        if (windowId == null) return;

        const storage = await chrome.storage.local.get(
            COLLAPSED_GROUPS_STORAGE_KEY,
        );
        const rawByWindow = storage[COLLAPSED_GROUPS_STORAGE_KEY];
        const byWindow: Record<string, number[]> =
            typeof rawByWindow === "object" && rawByWindow != null
                ? (rawByWindow as Record<string, number[]>)
                : {};
        const storedGroupIds = byWindow[String(windowId)] ?? [];

        collapsedGroups.clear();
        for (const groupId of storedGroupIds) {
            if (Number.isInteger(groupId)) collapsedGroups.add(String(groupId));
        }
    }

    function isCollapsedInList(groupId: string) {
        return collapsedGroups.has(groupId);
    }

    const list = document.getElementById("tabs-and-groups");
    if (!list) return;

    function filterBookmarkNodes(
        nodes: chrome.bookmarks.BookmarkTreeNode[],
        query: string,
    ): chrome.bookmarks.BookmarkTreeNode[] {
        if (query.length === 0) return nodes;

        const filteredNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
        for (const node of nodes) {
            const filteredChildren = node.children
                ? filterBookmarkNodes(node.children, query)
                : undefined;
            const matchesSelf = nodeQuery(node, query);
            const hasMatchingChildren = (filteredChildren?.length ?? 0) > 0;
            if (!matchesSelf && !hasMatchingChildren) continue;

            filteredNodes.push({
                ...node,
                children: filteredChildren,
            });
        }

        return filteredNodes;
    }

    // Bookmarks Section
    const bookmarksList = document.getElementById("bookmarks-list");
    const collapsedBookmarkFolders = new Set<string>();
    const COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY = "collapsedBookmarkFolders";

    async function loadCollapsedBookmarkFolders() {
        const storage = await chrome.storage.local.get(
            COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY,
        );
        const raw = storage[COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY];
        const folderIds = Array.isArray(raw)
            ? raw.filter((id): id is string => typeof id === "string")
            : [];

        collapsedBookmarkFolders.clear();
        for (const folderId of folderIds) {
            collapsedBookmarkFolders.add(folderId);
        }
    }

    async function persistCollapsedBookmarkFolders() {
        await chrome.storage.local.set({
            [COLLAPSED_BOOKMARK_FOLDERS_STORAGE_KEY]: Array.from(
                collapsedBookmarkFolders,
            ),
        });
    }

    async function toggleBookmarkFolderInList(folderId: string) {
        if (collapsedBookmarkFolders.has(folderId)) {
            collapsedBookmarkFolders.delete(folderId);
        } else {
            collapsedBookmarkFolders.add(folderId);
        }

        await persistCollapsedBookmarkFolders();
    }

    function isBookmarkFolderCollapsed(folderId: string) {
        return collapsedBookmarkFolders.has(folderId);
    }

    function removeBookmarkFolderSubtreeFromCollapsed(
        node: chrome.bookmarks.BookmarkTreeNode,
    ) {
        if (node.url) return;

        collapsedBookmarkFolders.delete(node.id);
        if (!node.children) return;

        for (const childNode of node.children) {
            removeBookmarkFolderSubtreeFromCollapsed(childNode);
        }
    }

    function orderBookmarkNodesForDisplay(
        nodes: chrome.bookmarks.BookmarkTreeNode[],
    ) {
        const passthroughNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
        const bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
        const folderNodes: chrome.bookmarks.BookmarkTreeNode[] = [];

        for (const node of nodes) {
            const nodeTitle = node.title?.trim() ?? "";
            const isRootPlaceholder = !node.url && nodeTitle.length === 0;
            const isBookmarksBar =
                node.folderType === "bookmarks-bar" ||
                node.id === "1" ||
                nodeTitle.toLowerCase() === "bookmarks bar";
            if (isRootPlaceholder || isBookmarksBar) {
                passthroughNodes.push(node);
                continue;
            }

            if (node.url) bookmarkNodes.push(node);
            else folderNodes.push(node);
        }

        return [...passthroughNodes, ...bookmarkNodes, ...folderNodes];
    }

    function cycleBookmarks(
        parentElement: HTMLElement,
        nodes: chrome.bookmarks.BookmarkTreeNode[],
        forceExpandFolders = false,
    ) {
        const orderedNodes = orderBookmarkNodesForDisplay(nodes);
        for (const node of orderedNodes) {
            const nodeTitle = node.title?.trim() ?? "";
            if (
                nodeTitle === "Other bookmarks" ||
                nodeTitle === "Other Bookmarks"
            )
                continue;

            const isRootPlaceholder = !node.url && nodeTitle.length === 0;
            const isBookmarksBar =
                node.folderType === "bookmarks-bar" ||
                node.id === "1" ||
                nodeTitle.toLowerCase() === "bookmarks bar";
            if (isRootPlaceholder || isBookmarksBar) {
                if (node.children) cycleBookmarks(parentElement, node.children);
                continue;
            }

            const li = document.createElement("li");
            li.className = "tab-item";

            if (node.url) {
                const btn = document.createElement("button");
                btn.className = "ungroup-tab";
                btn.type = "button";
                btn.addEventListener("click", async () => {
                    if (!isAllowedBookmarkUrl(node.url!)) {
                        console.warn(
                            "Blocked bookmark URL with unsupported scheme:",
                            node.url,
                        );
                        return;
                    }
                    await chrome.tabs.create({ url: node.url });
                });

                const icon = document.createElement("img");
                icon.className = "tab-icon";
                icon.src = DEFAULT_TAB_ICON_URL;
                icon.height = 16;
                icon.width = 16;

                const label = document.createElement("span");
                label.className = "tab-label";
                label.textContent = nodeTitle || node.url || "(Untitled tab)";

                btn.append(icon, label);

                const row = document.createElement("div");
                row.className = "tab-row";

                const deleteBookmarkBtn = createDeleteButton(
                    "Delete bookmark",
                    async () => {
                        await chrome.bookmarks.remove(node.id);
                    },
                );
                row.append(btn, deleteBookmarkBtn);
                li.appendChild(row);
                parentElement.appendChild(li);
                continue;
            }

            const hasChildren = (node.children?.length ?? 0) > 0;
            const isCollapsed =
                !forceExpandFolders && isBookmarkFolderCollapsed(node.id);
            const toggleIcon = isCollapsed ? "▸" : "▾";

            const btn = document.createElement("button");
            btn.className = "group-toggle";
            btn.type = "button";
            btn.addEventListener("click", async () => {
                if (forceExpandFolders || !hasChildren) return;
                await toggleBookmarkFolderInList(node.id);
                void render();
            });

            const toggleIconLabel = document.createElement("h4");
            toggleIconLabel.className = "group-toggle-icon";
            toggleIconLabel.textContent = hasChildren ? toggleIcon : " ";

            const label = document.createElement("h4");
            label.className = "group-toggle-title";
            label.textContent = nodeTitle || "(untitled)";

            btn.append(toggleIconLabel, label);

            const row = document.createElement("div");
            row.className = "group-row";
            const deleteFolderBtn = createDeleteButton(
                "Delete folder",
                async () => {
                    if (hasChildren) {
                        const folderName = nodeTitle || "(untitled)";
                        const confirmed = window.confirm(
                            `Delete folder "${folderName}" and all nested bookmarks?`,
                        );
                        if (!confirmed) return;
                    }

                    removeBookmarkFolderSubtreeFromCollapsed(node);
                    await persistCollapsedBookmarkFolders();

                    if (hasChildren) {
                        await chrome.bookmarks.removeTree(node.id);
                    } else {
                        await chrome.bookmarks.remove(node.id);
                    }
                },
            );
            row.append(btn, deleteFolderBtn);
            li.appendChild(row);
            parentElement.appendChild(li);

            if (hasChildren && !isCollapsed) {
                const nestedList = document.createElement("ul");
                nestedList.className = "bookmark-nested-list";
                li.appendChild(nestedList);
                cycleBookmarks(nestedList, node.children!, forceExpandFolders);
            }
        }
    }

    function createEmptyState(message: string) {
        const li = document.createElement("li");
        li.className = "empty-state-message";
        li.textContent = message;
        return li;
    }

    let renderToken = 0;
    let renderQueued = false;

    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;

        queueMicrotask(() => {
            renderQueued = false;
            void render();
        });
    }

    const handleTabChange = () => queueRender();
    const handleTabGroupChange = () => queueRender();
    const handleBookmarkChange = () => queueRender();

    chrome.tabs.onCreated.addListener(handleTabChange);
    chrome.tabs.onRemoved.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);
    chrome.tabs.onMoved.addListener(handleTabChange);
    chrome.tabs.onAttached.addListener(handleTabChange);
    chrome.tabs.onDetached.addListener(handleTabChange);
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabGroups.onCreated.addListener(handleTabGroupChange);
    chrome.tabGroups.onRemoved.addListener(handleTabGroupChange);
    chrome.tabGroups.onUpdated.addListener(handleTabGroupChange);
    chrome.tabGroups.onMoved.addListener(handleTabGroupChange);
    chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
    chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
    chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);
    chrome.bookmarks.onImportEnded.addListener(handleBookmarkChange);

    window.addEventListener("unload", () => {
        chrome.tabs.onCreated.removeListener(handleTabChange);
        chrome.tabs.onRemoved.removeListener(handleTabChange);
        chrome.tabs.onUpdated.removeListener(handleTabChange);
        chrome.tabs.onMoved.removeListener(handleTabChange);
        chrome.tabs.onAttached.removeListener(handleTabChange);
        chrome.tabs.onDetached.removeListener(handleTabChange);
        chrome.tabs.onActivated.removeListener(handleTabChange);
        chrome.tabGroups.onCreated.removeListener(handleTabGroupChange);
        chrome.tabGroups.onRemoved.removeListener(handleTabGroupChange);
        chrome.tabGroups.onUpdated.removeListener(handleTabGroupChange);
        chrome.tabGroups.onMoved.removeListener(handleTabGroupChange);
        chrome.bookmarks.onCreated.removeListener(handleBookmarkChange);
        chrome.bookmarks.onRemoved.removeListener(handleBookmarkChange);
        chrome.bookmarks.onChanged.removeListener(handleBookmarkChange);
        chrome.bookmarks.onMoved.removeListener(handleBookmarkChange);
        chrome.bookmarks.onChildrenReordered.removeListener(
            handleBookmarkChange,
        );
        chrome.bookmarks.onImportEnded.removeListener(handleBookmarkChange);
    });

    await loadCollapsedBookmarkFolders();
    await loadCollapsedGroups();
    queueRender();

    async function render() {
        const token = ++renderToken;

        const [tabs, groups, tree] = await Promise.all([
            chrome.tabs.query({ currentWindow: true }),
            chrome.tabGroups.query({
                windowId: chrome.windows.WINDOW_ID_CURRENT,
            }),
            chrome.bookmarks.getTree(),
        ]);
        if (token !== renderToken) return;

        const activeGroupIds = new Set(
            groups
                .map((group) => group.id)
                .filter((groupId): groupId is number => groupId != null),
        );
        let removedStaleGroupId = false;
        for (const groupId of collapsedGroups) {
            if (!activeGroupIds.has(Number(groupId))) {
                collapsedGroups.delete(groupId);
                removedStaleGroupId = true;
            }
        }
        if (removedStaleGroupId) {
            await persistCollapse(collapsedGroups, "tab");
        }

        const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
        const ungroupedTabs: chrome.tabs.Tab[] = [];
        for (const tab of tabs) {
            if (tab.groupId == null) continue;
            if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                ungroupedTabs.push(tab);
                continue;
            }
            const groupedTabs = tabsByGroup.get(tab.groupId);
            if (groupedTabs) groupedTabs.push(tab);
            else tabsByGroup.set(tab.groupId, [tab]);
        }

        const isSearching = searchQuery.length > 0;
        const visibleUngroupedTabs = isSearching
            ? ungroupedTabs.filter((tab) => nodeQuery(tab, searchQuery))
            : ungroupedTabs;

        const next = document.createElement("ul");
        buildCycle(next, visibleUngroupedTabs, false);

        let renderedTabResults = visibleUngroupedTabs.length > 0;
        let hasRenderedGroupSection = false;

        for (const group of groups) {
            const groupId = group.id;
            if (groupId == null) continue;

            const tabsInGroup = tabsByGroup.get(groupId) ?? [];
            const groupTitleMatches = isSearching
                ? nodeQuery(group, searchQuery)
                : false;
            const visibleTabsInGroup = isSearching
                ? groupTitleMatches
                    ? tabsInGroup
                    : tabsInGroup.filter((tab) => nodeQuery(tab, searchQuery))
                : tabsInGroup;
            const shouldRenderGroup =
                !isSearching ||
                groupTitleMatches ||
                visibleTabsInGroup.length > 0;
            if (!shouldRenderGroup) continue;

            if (!hasRenderedGroupSection) {
                const li = document.createElement("li");
                li.className = "group-section";
                next.appendChild(li);
                hasRenderedGroupSection = true;
            }

            const groupColour = group.color;

            const li = document.createElement("li");
            li.className = "group";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "group-toggle";
            btn.style.background = groupColour
                ? chromeToUiColor[groupColour]
                : "var(--blue)";

            const isCollapsed =
                !isSearching && isCollapsedInList(String(groupId));
            const toggleIcon = isCollapsed ? "▸" : "▾";
            const groupTitle = group.title?.trim() || "(untitled)";
            const toggleIconLabel = document.createElement("h4");
            toggleIconLabel.className = "group-toggle-icon";
            toggleIconLabel.textContent = toggleIcon;

            const groupTitleElement = document.createElement("h4");
            groupTitleElement.className = "group-toggle-title";
            groupTitleElement.textContent = groupTitle;

            btn.append(toggleIconLabel, groupTitleElement);

            btn.addEventListener("click", async () => {
                await toggleInList(collapsedGroups, String(groupId), "tab");
                void render();
            });

            const groupRow = document.createElement("div");
            groupRow.className = "group-row";
            const deleteGroupBtn = createDeleteButton(
                "Close group",
                async () => {
                    const tabIds = (tabsByGroup.get(groupId) ?? [])
                        .map((tab) => tab.id)
                        .filter((tabId): tabId is number => tabId != null);
                    if (tabIds.length === 0) return;

                    const tabCount = tabIds.length;
                    const confirmed = window.confirm(
                        `Close group "${groupTitle}" and ${tabCount} tab${tabCount === 1 ? "" : "s"}?`,
                    );
                    if (!confirmed) return;

                    await chrome.tabs.remove(tabIds);
                    if (collapsedGroups.has(String(groupId))) {
                        collapsedGroups.delete(String(groupId));
                        await persistCollapse(collapsedGroups, "tab");
                    }
                },
            );
            groupRow.append(btn, deleteGroupBtn);

            if (!isCollapsed) {
                buildCycle(li, visibleTabsInGroup, true, groupColour);
            }

            next.appendChild(groupRow);
            if (!isCollapsed) {
                next.appendChild(li);
            }
            renderedTabResults = true;
        }

        if (isSearching && !renderedTabResults) {
            next.appendChild(createEmptyState("No matching tabs."));
        }

        list?.replaceChildren(...Array.from(next.children));

        if (bookmarksList) {
            const nextBookmarks = document.createElement("ul");
            const bookmarkNodes = isSearching
                ? filterBookmarkNodes(tree, searchQuery)
                : tree;
            cycleBookmarks(nextBookmarks, bookmarkNodes, isSearching);
            if (isSearching && nextBookmarks.childElementCount === 0) {
                nextBookmarks.appendChild(
                    createEmptyState("No matching bookmarks."),
                );
            }
            bookmarksList.replaceChildren(
                ...Array.from(nextBookmarks.children),
            );
        }
    }
});
