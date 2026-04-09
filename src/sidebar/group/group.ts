import type { RequestRender } from "../types.js";
import { chromeToUiColor } from "../config.js";
import { cycleTabs } from "../tab/tab.js";
import {
    createDeleteButton,
    createToggleButton,
} from "../helpers/domFactory.js";
import { matchesNodeQuery } from "../helpers/nodeSearch.js";
import {
    isCollapsedCheck,
    persistCollapse,
} from "../helpers/collapseState.js";
import { createEmptySearchState } from "../helpers/domFactory.js";

export async function buildGroup(
    visibleUngroupedTabs: chrome.tabs.Tab[],
    groups: chrome.tabGroups.TabGroup[],
    tabsByGroup: Map<number, chrome.tabs.Tab[]>,
    collapsedGroups: Set<string>,
    isSearching: boolean,
    searchQuery: string,
    next: HTMLElement,
    requestRender: RequestRender,
) {
    let renderedTabResults = visibleUngroupedTabs.length > 0;
    let hasRenderedGroupSection = false;

    for (const group of groups) {
        const groupId = group.id;
        if (groupId == null) continue;

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
        const shouldRenderGroup =
            !isSearching || groupTitleMatches || visibleTabsInGroup.length > 0;
        if (!shouldRenderGroup) continue;

        if (!hasRenderedGroupSection) {
            const li = document.createElement("li");
            li.className = "group-section";
            next.appendChild(li);
            hasRenderedGroupSection = true;
        }

        const groupColour = group.color;
        const groupTitle = group.title?.trim() || "(untitled)";

        const li = document.createElement("li");
        li.className = "group";

        const isCollapsed =
            !isSearching && isCollapsedCheck(String(groupId), collapsedGroups);
        const btn = createToggleButton(isCollapsed, group, collapsedGroups, {
            type: "tab",
            onToggle: requestRender,
            hasChildren: visibleTabsInGroup.length > 0,
            colour: groupColour ? chromeToUiColor[groupColour] : "var(--blue)",
            canToggle: !isSearching,
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
            if (collapsedGroups.has(String(groupId))) {
                collapsedGroups.delete(String(groupId));
                await persistCollapse(collapsedGroups, "tab");
            }
        });
        groupRow.append(btn, deleteGroupBtn);

        if (!isCollapsed) {
            cycleTabs(li, visibleTabsInGroup, true, groupColour);
        }

        next.appendChild(groupRow);
        if (!isCollapsed) {
            next.appendChild(li);
        }
        renderedTabResults = true;
    }

    if (isSearching && !renderedTabResults) {
        next.appendChild(createEmptySearchState("No matching tabs."));
    }
}

export async function groupCollapse(
    groups: chrome.tabGroups.TabGroup[],
    collapsedGroups: Set<string>,
) {
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
}
