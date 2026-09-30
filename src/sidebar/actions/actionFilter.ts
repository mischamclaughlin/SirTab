import { HIDDEN_SECTIONS_STORAGE_KEY } from "../config.js";
import { setButtonIcon } from "../helpers/icons.js";
import type { RequestRender } from "../types.js";

export const SECTION_NAMES = ["tabs", "groups", "bookmarks"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

export async function setupFilterAction(
    searchControls: HTMLElement,
    sections: Record<SectionName, HTMLElement>,
    hiddenSections: Set<SectionName>,
    requestRender: RequestRender,
) {
    const stored = (await chrome.storage.local.get(HIDDEN_SECTIONS_STORAGE_KEY))[
        HIDDEN_SECTIONS_STORAGE_KEY
    ];
    if (Array.isArray(stored)) {
        for (const name of stored) {
            if (SECTION_NAMES.some((section) => section === name)) {
                hiddenSections.add(name as SectionName);
            }
        }
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "control filter-button";
    setButtonIcon(button, "filter", "Filter sections");
    button.setAttribute("aria-expanded", "false");

    const panel = document.createElement("div");
    panel.className = "filter-panel";
    panel.id = "sidebar-filter-panel";
    panel.hidden = true;
    button.setAttribute("aria-controls", panel.id);

    const updateButton = () => {
        button.classList.toggle("is-selected", hiddenSections.size > 0 || !panel.hidden);
    };
    const applyVisibility = () => {
        for (const name of SECTION_NAMES) {
            sections[name].hidden = hiddenSections.has(name);
        }
        updateButton();
    };
    let pendingSave: Promise<unknown> = Promise.resolve();

    for (const name of SECTION_NAMES) {
        const label = document.createElement("label");
        label.className = "filter-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = hiddenSections.has(name);
        checkbox.setAttribute("aria-label", `Hide ${name}`);
        const text = document.createElement("span");
        text.textContent = name;
        label.append(checkbox, text);
        panel.append(label);

        checkbox.addEventListener("change", () => {
            if (checkbox.checked) hiddenSections.add(name);
            else hiddenSections.delete(name);
            applyVisibility();
            requestRender();
            const nextHiddenSections = [...hiddenSections];
            pendingSave = pendingSave.catch(() => {}).then(() =>
                chrome.storage.local.set({
                    [HIDDEN_SECTIONS_STORAGE_KEY]: nextHiddenSections,
                }),
            );
            void pendingSave.catch((error) => {
                console.error("Save section filters failed:", error);
            });
        });
    }

    const close = () => {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
        updateButton();
    };
    button.addEventListener("click", () => {
        const isOpen = panel.hidden;
        panel.hidden = !isOpen;
        button.setAttribute("aria-expanded", String(isOpen));
        updateButton();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || panel.hidden) return;
        close();
        button.focus();
        event.preventDefault();
    });

    searchControls.append(button);
    searchControls.after(panel);
    applyVisibility();
}
