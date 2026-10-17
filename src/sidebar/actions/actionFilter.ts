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
    let stored: unknown;
    try {
        stored = (await chrome.storage.local.get(HIDDEN_SECTIONS_STORAGE_KEY))[
            HIDDEN_SECTIONS_STORAGE_KEY
        ];
    } catch (error) {
        console.error("Load section filters failed:", error);
    }
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
    let pendingSaveCount = 0;
    let deferredStorageChange: { newValue: unknown } | undefined;
    const checkboxes = new Map<SectionName, HTMLInputElement>();

    const applyStoredSections = (stored: unknown) => {
        const nextHidden = new Set<SectionName>();
        if (Array.isArray(stored)) {
            for (const name of stored) {
                if (SECTION_NAMES.some((section) => section === name)) {
                    nextHidden.add(name as SectionName);
                }
            }
        }
        if (SECTION_NAMES.every((name) => hiddenSections.has(name) === nextHidden.has(name))) {
            return;
        }
        hiddenSections.clear();
        for (const name of nextHidden) hiddenSections.add(name);
        for (const name of SECTION_NAMES) {
            const checkbox = checkboxes.get(name);
            if (checkbox) checkbox.checked = hiddenSections.has(name);
        }
        applyVisibility();
        requestRender();
    };

    for (const name of SECTION_NAMES) {
        const label = document.createElement("label");
        label.className = "filter-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = hiddenSections.has(name);
        checkboxes.set(name, checkbox);
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
            pendingSaveCount++;
            pendingSave = pendingSave.catch(() => {}).then(async () => {
                try {
                    await chrome.storage.local.set({
                        [HIDDEN_SECTIONS_STORAGE_KEY]: nextHiddenSections,
                    });
                } finally {
                    pendingSaveCount--;
                    if (pendingSaveCount === 0 && deferredStorageChange) {
                        const { newValue } = deferredStorageChange;
                        deferredStorageChange = undefined;
                        applyStoredSections(newValue);
                    }
                }
            });
            void pendingSave.catch((error) => {
                console.error("Save section filters failed:", error);
            });
        });
    }

    const handleStorageChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
    ) => {
        if (areaName !== "local" || !(HIDDEN_SECTIONS_STORAGE_KEY in changes)) return;
        const { newValue } = changes[HIDDEN_SECTIONS_STORAGE_KEY];
        // Storage echoes from earlier saves must not reset newer local choices.
        // Reconcile the latest observed value once every queued save has settled.
        if (pendingSaveCount > 0) {
            deferredStorageChange = { newValue };
            return;
        }
        applyStoredSections(newValue);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener("pagehide", () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
    }, { once: true });

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
