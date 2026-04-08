import { queueRender } from "../helpers.js";

export async function setupSearchAction(
    actionSection: HTMLElement,
    renderQueued: boolean,
    render: () => Promise<void>,
): Promise<() => string> {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "search tabs and bookmarks";
    searchInput.className = "search-input";
    searchInput.autofocus = true;
    actionSection.appendChild(searchInput);

    let searchQuery = "";
    searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        queueRender(renderQueued, render);
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || searchInput.value.length === 0) return;
        searchInput.value = "";
        searchQuery = "";
        queueRender(renderQueued, render);
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
