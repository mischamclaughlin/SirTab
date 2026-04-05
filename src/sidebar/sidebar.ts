document.addEventListener("DOMContentLoaded", async () => {
    const DEFAULT_TAB_ICON_URL = chrome.runtime.getURL(
        "src/sidebar/assets/default-tab-icon.svg",
    );
    const THEME_STORAGE_KEY = "sidebarTheme";
    const THEMES = [
        "dark",
        "light",
        "mocha",
        "latte",
        "retro-dark",
        "retro-light",
    ] as const;
    type SidebarTheme = (typeof THEMES)[number];

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
    const actionBtnSection = document.createElement("div");
    actionBtnSection.className = "action-btn-section";
    actions?.appendChild(actionBtnSection);

    // -- Group +
    const btnGroup = document.createElement("button");
    btnGroup.textContent = "group +";
    btnGroup.className = "action-btn";
    actionBtnSection.appendChild(btnGroup);

    let creatingGroup = false;

    const groupColorMap = {
        none: "grey",
        blue: "blue",
        red: "red",
        yellow: "yellow",
        green: "green",
        pink: "pink",
        lavender: "purple",
        sky: "cyan",
        peach: "orange",
    } as const;
    type GroupColorChoice = keyof typeof groupColorMap;

    const chromeToUiColor: Record<string, string> = {
        grey: "var(--group-grey)",
        blue: "var(--group-blue)",
        red: "var(--group-red)",
        yellow: "var(--group-yellow)",
        green: "var(--group-green)",
        pink: "var(--group-pink)",
        purple: "var(--group-lavender)",
        cyan: "var(--group-sky)",
        orange: "var(--group-peach)",
    };

    function resetGroupCreationState() {
        actions?.querySelector(".group-info-dropdown")?.remove();
        creatingGroup = false;
        btnGroup.textContent = "group +";
    }

    btnGroup.addEventListener("click", async () => {
        if (creatingGroup) {
            resetGroupCreationState();
            return;
        }

        const groupInfoDropdown = document.createElement("div");
        groupInfoDropdown.className = "group-info-dropdown";

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
            const groupName = textInput.value.trim() || "";

            const selectedColour = colourSelect.value as GroupColorChoice;
            const homeTab = await chrome.tabs.create({
                url: "chrome://newtab",
                active: false,
            });

            if (homeTab?.id == null) {
                resetGroupCreationState();
                return;
            }

            const groupId = await chrome.tabs.group({ tabIds: [homeTab.id] });
            await chrome.tabGroups.update(groupId, {
                title: groupName,
                color: groupColorMap[selectedColour] ?? "grey",
                collapsed: false,
            });

            resetGroupCreationState();
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

    actionBtnSection?.append(settingsBtn, settingInfoSection);

    // Tabs & Groups Section
    const collapsedGroups = new Set<number>();
    const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedGroupsByWindow";
    let currentWindowId: number | null = null;

    async function getCurrentWindowId() {
        if (currentWindowId != null) return currentWindowId;
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow.id == null) return null;
        currentWindowId = currentWindow.id;
        return currentWindowId;
    }

    async function persistCollapsedGroups() {
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

        byWindow[String(windowId)] = Array.from(collapsedGroups);

        await chrome.storage.local.set({
            [COLLAPSED_GROUPS_STORAGE_KEY]: byWindow,
        });
    }

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
            if (Number.isInteger(groupId)) collapsedGroups.add(groupId);
        }
    }

    async function toggleGroupInList(groupId: number) {
        const willCollapse = !collapsedGroups.has(groupId);
        if (willCollapse) collapsedGroups.add(groupId);
        else collapsedGroups.delete(groupId);

        await persistCollapsedGroups();
        await chrome.tabGroups.update(groupId, { collapsed: willCollapse });
    }

    function isCollapsedInList(groupId: number) {
        return collapsedGroups.has(groupId);
    }

    const list = document.getElementById("tabs-and-groups");
    if (!list) return;

    function createDeleteButton(
        title: string,
        onClick: () => Promise<void> | void,
    ) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "row-delete-btn";
        deleteBtn.title = title;
        deleteBtn.setAttribute("aria-label", title);
        deleteBtn.textContent = "x";
        deleteBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await onClick();
        });
        return deleteBtn;
    }

    function isAllowedBookmarkUrl(rawUrl: string) {
        try {
            const parsedUrl = new URL(rawUrl);
            return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
        } catch {
            return false;
        }
    }

    function cycleTabs(
        tabElement: HTMLElement,
        tabList: chrome.tabs.Tab[],
        grouped = false,
        groupColour?: string,
    ) {
        for (const tab of tabList) {
            if (tab.id == null) continue;

            const li = document.createElement("li");
            li.className = "tab-item";

            const btn = document.createElement("button");
            btn.className = grouped ? "group-tab" : "ungroup-tab";
            btn.type = "button";

            const icon = document.createElement("img");
            icon.className = "tab-icon";
            icon.src = tab.favIconUrl || DEFAULT_TAB_ICON_URL;
            icon.alt = "";
            icon.width = 16;
            icon.height = 16;
            icon.addEventListener("error", () => {
                icon.src = DEFAULT_TAB_ICON_URL;
            });

            const label = document.createElement("span");
            label.className = "tab-label";

            if (tab.active) label.className += " active-tab";
            const title = tab.title?.trim() ?? "";
            const text = title || tab.url || "(Untitled tab)";
            label.textContent = text;

            btn.append(icon, label);

            btn.addEventListener("click", async () => {
                await chrome.tabs.update(tab.id!, { active: true });
            });

            const row = document.createElement("div");
            row.className = "tab-row";

            const deleteBtn = createDeleteButton("Close tab", async () => {
                await chrome.tabs.remove(tab.id!);
            });

            row.append(btn, deleteBtn);
            li.appendChild(row);
            tabElement.appendChild(li);
            tabElement.style.background = groupColour
                ? chromeToUiColor[groupColour]
                : "var(--blue)";
        }
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

    function cycleBookmarks(
        parentElement: HTMLElement,
        nodes: chrome.bookmarks.BookmarkTreeNode[],
    ) {
        for (const node of nodes) {
            const nodeTitle = node.title?.trim() ?? "";
            if (nodeTitle === "Other bookmarks") continue;

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
                        console.warn("Blocked bookmark URL with unsupported scheme:", node.url);
                        return;
                    }
                    await chrome.tabs.create({ url: node.url });
                });

                const icon = document.createElement("img");
                icon.className = "tab-icon";
                icon.src = DEFAULT_TAB_ICON_URL;

                const label = document.createElement("span");
                label.className = "tab-label";
                label.textContent = nodeTitle || node.url || "(Untitled tab)";

                btn.append(icon, label);
                li.appendChild(btn);
                parentElement.appendChild(li);
                continue;
            }

            const hasChildren = (node.children?.length ?? 0) > 0;
            const isCollapsed = isBookmarkFolderCollapsed(node.id);
            const toggleIcon = isCollapsed ? "▸" : "▾";

            const btn = document.createElement("button");
            btn.className = "group-toggle";
            btn.type = "button";
            btn.addEventListener("click", async () => {
                if (!hasChildren) return;
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
            li.appendChild(btn);
            parentElement.appendChild(li);

            if (hasChildren && !isCollapsed) {
                const nestedList = document.createElement("ul");
                nestedList.className = "bookmark-nested-list";
                li.appendChild(nestedList);
                cycleBookmarks(nestedList, node.children!);
            }
        }
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
            if (!activeGroupIds.has(groupId)) {
                collapsedGroups.delete(groupId);
                removedStaleGroupId = true;
            }
        }
        if (removedStaleGroupId) {
            await persistCollapsedGroups();
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

        const next = document.createElement("ul");
        cycleTabs(next, ungroupedTabs, false);

        const li = document.createElement("li");
        li.className = "group-section";
        next.appendChild(li);

        for (const group of groups) {
            const groupId = group.id;
            if (groupId == null) continue;

            const groupColour = group.color;

            const li = document.createElement("li");
            li.className = "group";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "group-toggle";
            btn.style.background = groupColour
                ? chromeToUiColor[groupColour]
                : "var(--blue)";

            const isCollapsed = isCollapsedInList(groupId);
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
                await toggleGroupInList(groupId);
                void render();
            });

            const groupRow = document.createElement("div");
            groupRow.className = "group-row";
            const deleteGroupBtn = createDeleteButton("Close group", async () => {
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
                if (collapsedGroups.has(groupId)) {
                    collapsedGroups.delete(groupId);
                    await persistCollapsedGroups();
                }
            });
            groupRow.append(btn, deleteGroupBtn);

            if (!isCollapsed) {
                cycleTabs(li, tabsByGroup.get(groupId) ?? [], true, groupColour);
            }

            next.appendChild(groupRow);
            if (!isCollapsed) {
                next.appendChild(li);
            }
        }

        list?.replaceChildren(...Array.from(next.children));

        if (bookmarksList) {
            const nextBookmarks = document.createElement("ul");
            cycleBookmarks(nextBookmarks, tree);
            bookmarksList.replaceChildren(
                ...Array.from(nextBookmarks.children),
            );
        }
    }
});
