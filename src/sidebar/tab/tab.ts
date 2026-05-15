import type { RequestRender } from "../types.js";
import { DEFAULT_TAB_ICON_URL } from "../config.js";
import { createDeleteButton } from "../helpers/domFactory.js";
import { makeTabDraggable } from "../helpers/dragAndDrop.js";
import { matchesNodeQuery } from "../helpers/nodeSearch.js";
import { buildTabsByLogicalGroup } from "../../shared/groupOrder.js";

type TabRenderOptions = {
    grouped?: boolean;
    windowId?: number;
    enableDragDrop?: boolean;
    requestRender?: RequestRender;
};

export function cycleTabs(
    tabElement: HTMLElement,
    tabList: chrome.tabs.Tab[],
    {
        grouped = false,
        windowId,
        enableDragDrop = false,
        requestRender,
    }: TabRenderOptions = {},
) {
    for (const tab of tabList) {
        if (tab.id == null) continue;

        const li = document.createElement("li");
        li.className = "tab-item";

        const btn = document.createElement("button");
        btn.className = grouped ? "tab-button tab-button--grouped" : "tab-button";
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

        if (tab.active) label.classList.add("is-current");
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
        if (enableDragDrop && requestRender && windowId != null) {
            makeTabDraggable(
                btn,
                row,
                windowId,
                tab.id,
                () => enableDragDrop,
                requestRender,
            );
        }
        li.appendChild(row);
        tabElement.appendChild(li);
    }
}

export function buildTabSearchState(
    tabs: chrome.tabs.Tab[],
    searchQuery: string,
) {
    const { ungroupedTabs, tabsByGroup } = buildTabsByLogicalGroup(tabs);

    const visibleUngroupedTabs = searchQuery
        ? ungroupedTabs.filter((tab) => matchesNodeQuery(tab, searchQuery))
        : ungroupedTabs;

    const isSearching = searchQuery.length > 0;

    return [visibleUngroupedTabs, tabsByGroup, isSearching] as const;
}
