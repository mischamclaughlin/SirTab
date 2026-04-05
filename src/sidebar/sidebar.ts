document.addEventListener("DOMContentLoaded", async () => {
    const DEFAULT_TAB_ICON_URL = chrome.runtime.getURL(
        "src/sidebar/assets/default-tab-icon.svg",
    );
    const THEME_STORAGE_KEY = "sidebarTheme";

    function applyTheme(theme: "light" | "dark") {
        document.documentElement.setAttribute("data-theme", theme);
    }

    async function loadThemePreference() {
        const storage = await chrome.storage.local.get(THEME_STORAGE_KEY);
        const savedTheme = storage[THEME_STORAGE_KEY];
        const theme = savedTheme === "light" ? "light" : "dark";
        applyTheme(theme);
    }

    await loadThemePreference();

    function updateThemeToggleButtonLabel(button: HTMLButtonElement) {
        const currentTheme =
            document.documentElement.getAttribute("data-theme");
        button.textContent =
            currentTheme === "light" ? "switch to dark" : "switch to light";
    }

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
        grey: "var(--bg)",
        blue: "var(--blue)",
        red: "var(--red)",
        yellow: "var(--yellow)",
        green: "var(--green)",
        pink: "var(--pink)",
        purple: "var(--lavender)",
        cyan: "var(--sky)",
        orange: "var(--peach)",
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

    const themeToggleBtn = document.createElement("button");
    themeToggleBtn.type = "button";
    themeToggleBtn.className = "theme-toggle-btn";
    updateThemeToggleButtonLabel(themeToggleBtn);
    settingInfoSection.appendChild(themeToggleBtn);

    let isSettingOpen = false;

    settingsBtn.addEventListener("click", () => {
        isSettingOpen = !isSettingOpen;
        settingInfoSection.hidden = !isSettingOpen;
    });

    themeToggleBtn.addEventListener("click", async () => {
        const currentTheme =
            document.documentElement.getAttribute("data-theme");
        const newTheme = currentTheme === "light" ? "dark" : "light";
        applyTheme(newTheme);
        await chrome.storage.local.set({ [THEME_STORAGE_KEY]: newTheme });
        updateThemeToggleButtonLabel(themeToggleBtn);
    });

    actionBtnSection?.append(settingsBtn, settingInfoSection);

    // Tabs & Groups Section
    const list = document.getElementById("tabs-and-groups");
    if (!list) return;

    function cycleTabs(
        tabElement: HTMLElement,
        tabList: chrome.tabs.Tab[],
        groupId?: number,
        groupColour?: string,
    ) {
        for (const tab of tabList) {
            if (tab.id == null) continue;
            if (groupId != null && tab.groupId !== groupId) continue;
            if (
                groupId == null &&
                tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
            )
                continue;

            const li = document.createElement("li");
            li.className = "tab-item";

            const btn = document.createElement("button");
            btn.className = groupId ? "group-tab" : "ungroup-tab";
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

            li.appendChild(btn);
            tabElement.appendChild(li);
            tabElement.style.background = groupColour
                ? chromeToUiColor[groupColour]
                : "var(--blue)";
        }
    }

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
        if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
        else collapsedGroups.add(groupId);

        await persistCollapsedGroups();
    }

    function isCollapsedInList(groupId: number) {
        return collapsedGroups.has(groupId);
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
    });

    await loadCollapsedGroups();
    queueRender();

    async function render() {
        const token = ++renderToken;

        const tabs = await chrome.tabs.query({ currentWindow: true });
        const groups = await chrome.tabGroups.query({
            windowId: chrome.windows.WINDOW_ID_CURRENT,
        });
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

        const next = document.createElement("ul");
        cycleTabs(next, tabs);

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

            if (!isCollapsed) {
                cycleTabs(li, tabs, groupId, groupColour);
            }

            next.appendChild(btn);
            if (!isCollapsed) {
                next.appendChild(li);
            }
        }

        list?.replaceChildren(...Array.from(next.children));
    }
});
