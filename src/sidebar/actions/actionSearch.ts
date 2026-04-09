import type { RequestRender } from "../types.js";

export function setupSearchAction(
    actionSection: HTMLElement,
    requestRender: RequestRender,
): () => string {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "search tabs and bookmarks";
    searchInput.className = "search-input";
    searchInput.autofocus = true;
    actionSection.appendChild(searchInput);

    let searchQuery = "";
    searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        requestRender();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || searchInput.value.length === 0) return;
        searchInput.value = "";
        searchQuery = "";
        requestRender();
    });

    chrome.sidePanel.onOpened.addListener(() => {
        window.focus();
        searchInput.focus();
    });

    document.addEventListener("keydown", (event) => {
        const isFocusShortcut =
            (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b";
        if (!isFocusShortcut) return;

        event.preventDefault();
        window.focus();
        searchInput.focus();
    });

    return () => searchQuery;
}
