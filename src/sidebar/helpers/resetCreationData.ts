import type { ToggleType } from "../types.js";

export function resetCreationState(
    actions: HTMLElement,
    btn: HTMLElement,
    type: ToggleType,
) {
    actions.querySelector(".info-dropdown")?.remove();
    if (type === "bookmark")
        actions.querySelector(".add-current-tab-btn")?.remove();
    btn.textContent = type === "bookmark" ? "bookmark +" : "group +";

    return false;
}
