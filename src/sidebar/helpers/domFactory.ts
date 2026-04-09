import type { ToggleNode, ToggleViewOptions } from "../types.js";
import { toggleInList } from "./collapseState.js";

export function createDeleteButton(
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

export function createToggleButton(
    isCollapsed: boolean,
    node: ToggleNode,
    list: Set<string>,
    {
        type = "bookmark",
        onToggle,
        hasChildren = true,
        colour,
        canToggle = hasChildren,
    }: ToggleViewOptions = {},
) {
    const nodeId = String(node.id);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-toggle";
    btn.style.background = colour ? colour : "transparent";

    const icon = document.createElement("h4");
    icon.className = "group-toggle-icon";
    const toggleIcon = hasChildren ? (isCollapsed ? "▸" : "▾") : " ";
    icon.textContent = toggleIcon;

    const title = document.createElement("h4");
    title.className = "group-toggle-title";
    title.textContent = node.title?.trim() || "(untitled)";

    btn.append(icon, title);

    btn.addEventListener("click", async () => {
        if (!canToggle || !hasChildren) return;
        await toggleInList(list, nodeId, type);
        onToggle?.();
    });

    return btn;
}

export function createEmptySearchState(message: string) {
    const li = document.createElement("li");
    li.className = "empty-search-state-message";
    li.textContent = message;
    return li;
}
