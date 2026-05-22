import type { RequestRender, TabSelectionView } from "../types.js";
import { cycleTabs } from "../tab/tab.js";
import {
    createDeleteButton,
    createToggleButton,
    runButtonAction,
} from "../helpers/domFactory.js";
import { makeGroupDraggable } from "../helpers/dragAndDrop.js";
import { matchesNodeQuery } from "../helpers/nodeSearch.js";
import {
    isCollapsedCheck,
    persistCollapse,
} from "../helpers/collapseState.js";
import { createEmptySearchState } from "../helpers/domFactory.js";
import { groupColorMap, GroupColorChoice } from "../config.js";
import { setButtonIcon } from "../helpers/icons.js";

function getGroupColorChoice(color: chrome.tabGroups.TabGroup["color"]) {
    const choices = Object.keys(groupColorMap) as GroupColorChoice[];

    return (
        choices.find((choice) => groupColorMap[choice] === color) ?? "none"
    );
}

function createGroupEditForm(
    group: chrome.tabGroups.TabGroup,
    groupTitle: string,
    groupColour: chrome.tabGroups.TabGroup["color"],
    requestRender: RequestRender,
    onClose: () => void,
) {
    const form = document.createElement("div");
    form.className = "group-edit-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "control";
    nameInput.value = group.title?.trim() ?? "";
    nameInput.placeholder = "group name";
    nameInput.setAttribute("aria-label", `Name for ${groupTitle}`);

    const colourSelect = document.createElement("select");
    colourSelect.className = "control";
    colourSelect.setAttribute("aria-label", `Colour for ${groupTitle}`);

    const colourChoices = Object.keys(groupColorMap) as GroupColorChoice[];
    for (const choice of colourChoices) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = choice;
        colourSelect.append(option);
    }
    colourSelect.value = getGroupColorChoice(groupColour);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "control";
    setButtonIcon(saveBtn, "confirm", "Save group changes");

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "control";
    setButtonIcon(cancelBtn, "clear", "Cancel group editing");

    form.append(nameInput, colourSelect, saveBtn, cancelBtn);

    nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") saveBtn.click();
        if (event.key === "Escape") cancelBtn.click();
    });

    cancelBtn.addEventListener("click", onClose);
    saveBtn.addEventListener("click", () => {
        void runButtonAction(saveBtn, async () => {
            if (group.id == null) return;

            await chrome.tabGroups.update(group.id, {
                title: nameInput.value.trim(),
                color: groupColorMap[colourSelect.value as GroupColorChoice],
            });
            onClose();
            requestRender();
        }, "Update group failed:");
    });

    requestAnimationFrame(() => nameInput.focus());

    return form;
}

export function buildGroup(
    hasUngroupedTabs: boolean,
    groups: chrome.tabGroups.TabGroup[],
    tabsByGroup: Map<number, chrome.tabs.Tab[]>,
    collapsedGroups: Set<string>,
    isSearching: boolean,
    searchQuery: string,
    next: HTMLElement,
    windowId: number,
    requestRender: RequestRender,
    enableDragDrop: boolean,
    tabSelection?: TabSelectionView,
    visibleTabIds?: number[],
) {
    let renderedTabResults = hasUngroupedTabs;

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

        const groupColour = group.color;
        const groupTitle = group.title?.trim() || "(untitled)";

        const groupItem = document.createElement("li");
        groupItem.className = "group-item";

        const isCollapsed =
            !isSearching && isCollapsedCheck(String(groupId), collapsedGroups);
        const nestedListId = `group-tabs-${groupId}`;
        const btn = createToggleButton(isCollapsed, group, collapsedGroups, {
            type: "tab",
            onToggle: requestRender,
            hasChildren: visibleTabsInGroup.length > 0,
            colour: groupColour ?? "grey",
            canToggle: !isSearching,
            controlsId: visibleTabsInGroup.length > 0 ? nestedListId : undefined,
        });

        const groupRow = document.createElement("div");
        groupRow.className = "tree-row";
        const isSelectionMode = tabSelection?.isSelectionMode() ?? false;
        if (isSelectionMode) groupRow.classList.add("tree-row--with-edit");
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

        let editGroupBtn: HTMLButtonElement | null = null;
        if (isSelectionMode) {
            editGroupBtn = document.createElement("button");
            editGroupBtn.type = "button";
            editGroupBtn.className = "row-icon-btn";
            setButtonIcon(
                editGroupBtn,
                "edit",
                `Edit group ${groupTitle}. Available in select mode.`,
            );
            groupRow.append(btn, editGroupBtn, deleteGroupBtn);
        } else {
            groupRow.append(btn, deleteGroupBtn);
        }
        if (enableDragDrop) {
            makeGroupDraggable(
                btn,
                groupRow,
                windowId,
                groupId,
                () => enableDragDrop,
                requestRender,
            );
        }
        groupItem.appendChild(groupRow);

        let editForm: HTMLElement | null = null;
        editGroupBtn?.addEventListener("click", () => {
            if (!editGroupBtn) return;

            if (editForm) {
                editForm.remove();
                editForm = null;
                editGroupBtn.classList.remove("is-selected");
                return;
            }

            editGroupBtn.classList.add("is-selected");
            editForm = createGroupEditForm(
                group,
                groupTitle,
                groupColour,
                requestRender,
                () => {
                    editForm?.remove();
                    editForm = null;
                    editGroupBtn.classList.remove("is-selected");
                },
            );
            groupRow.after(editForm);
        });

        if (visibleTabsInGroup.length > 0) {
            const nestedList = document.createElement("ul");
            nestedList.className = "group-tabs";
            nestedList.id = nestedListId;
            nestedList.hidden = isCollapsed;
            nestedList.dataset.groupColor = groupColour ?? "grey";
            groupItem.appendChild(nestedList);

            if (!isCollapsed) {
                cycleTabs(nestedList, visibleTabsInGroup, {
                    grouped: true,
                    windowId,
                    enableDragDrop,
                    requestRender,
                    tabSelection,
                    visibleTabIds,
                });
            }
        }

        next.appendChild(groupItem);
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
