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
        controlsId,
    }: ToggleViewOptions = {},
) {
    const nodeId = String(node.id);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-toggle";
    if (colour) {
        btn.dataset.colour = colour;
    }
    if (hasChildren) {
        btn.setAttribute("aria-expanded", String(!isCollapsed));
    }
    if (controlsId) {
        btn.setAttribute("aria-controls", controlsId);
    }

    const icon = document.createElement("span");
    icon.className = "tree-toggle-icon";
    icon.setAttribute("aria-hidden", "true");
    const toggleIcon = hasChildren ? (isCollapsed ? "▸" : "▾") : " ";
    icon.textContent = toggleIcon;

    const title = document.createElement("span");
    title.className = "tree-toggle-title";
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
