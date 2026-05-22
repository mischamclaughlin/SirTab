import type { RequestRender, TabSelectionView } from "../types.js";
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
    tabSelection?: TabSelectionView;
    visibleTabIds?: number[];
};

export function cycleTabs(
    tabElement: HTMLElement,
    tabList: chrome.tabs.Tab[],
    {
        grouped = false,
        windowId,
        enableDragDrop = false,
        requestRender,
        tabSelection,
        visibleTabIds = tabList
            .map((tab) => tab.id)
            .filter((tabId): tabId is number => tabId != null),
    }: TabRenderOptions = {},
) {
    for (const tab of tabList) {
        if (tab.id == null) continue;

        const li = document.createElement("li");
        li.className = "tab-item";
        li.dataset.tabId = String(tab.id);

        const btn = document.createElement("button");
        btn.className = grouped ? "tab-button tab-button--grouped" : "tab-button";
        btn.type = "button";
        const isSelected = tabSelection?.isSelected(tab.id) ?? false;
        const isSelectionMode = tabSelection?.isSelectionMode() ?? false;
        btn.setAttribute("aria-pressed", String(isSelected));
        if (isSelectionMode) btn.classList.add("is-selecting");
        if (isSelected) btn.classList.add("is-selected");

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

        if (isSelectionMode) {
            const checkbox = document.createElement("span");
            checkbox.className = "tab-select-box";
            checkbox.setAttribute("aria-hidden", "true");
            checkbox.textContent = isSelected ? "✓" : "";
            btn.append(checkbox);
        }

        btn.append(icon, label);

        btn.addEventListener("click", async (event) => {
            if (
                tabSelection &&
                (event.shiftKey || tabSelection.isSelectionMode())
            ) {
                event.preventDefault();
                if (event.shiftKey) {
                    tabSelection.selectRange(visibleTabIds, tab.id!);
                } else {
                    tabSelection.toggleTab(tab.id!);
                }
                return;
            }

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
                tabSelection?.getDragTabIds,
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
