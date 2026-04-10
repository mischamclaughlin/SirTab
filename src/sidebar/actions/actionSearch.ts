import type { RequestRender } from "../types.js";

export function setupSearchAction(
    actionSection: HTMLElement,
    requestRender: RequestRender,
): () => string {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.id = "sidebar-search";
    searchInput.name = "sidebar-search";
    searchInput.placeholder = "search tabs and bookmarks";
    searchInput.className = "search-input";
    searchInput.autofocus = true;
    searchInput.setAttribute("aria-label", "Search tabs and bookmarks");
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

    const handleSidePanelOpened = () => {
        window.focus();
        searchInput.focus();
    };
    chrome.sidePanel.onOpened.addListener(handleSidePanelOpened);

    const handleDocumentKeydown = (event: KeyboardEvent) => {
        const isFocusShortcut =
            (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b";
        if (!isFocusShortcut) return;

        event.preventDefault();
        window.focus();
        searchInput.focus();
    };
    document.addEventListener("keydown", handleDocumentKeydown);

    const cleanup = () => {
        chrome.sidePanel.onOpened.removeListener(handleSidePanelOpened);
        document.removeEventListener("keydown", handleDocumentKeydown);
    };
    window.addEventListener("pagehide", cleanup, { once: true });

    return () => searchQuery;
}
