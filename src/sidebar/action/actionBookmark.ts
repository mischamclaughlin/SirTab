import { collectBookmarkFolderChoices } from "../bookmark/bookmark.js";
import { resetCreationState } from "../helpers.js";

export async function setupBookmarkAction(
    actionSection: HTMLElement,
    actionBtnSection: HTMLElement,
): Promise<void> {
    const btnNewBookmark = document.createElement("button");
    btnNewBookmark.textContent = "bookmark +";
    btnNewBookmark.className = "action-btn";
    actionBtnSection.appendChild(btnNewBookmark);

    let isAddCurrentTab = false;
    let creatingBookmark = false;

    btnNewBookmark.addEventListener("click", async () => {
        if (creatingBookmark) {
            creatingBookmark = resetCreationState(
                actionSection,
                btnNewBookmark,
                "bookmark",
            );
            return;
        }

        const addCurrentTab = document.createElement("button");
        addCurrentTab.type = "button";
        addCurrentTab.className = "add-current-tab-btn";
        addCurrentTab.textContent = `add current tab: ${isAddCurrentTab}`;
        actionSection.append(addCurrentTab);

        const bookmarkInfoDropdown = document.createElement("div");
        bookmarkInfoDropdown.className = "info-dropdown";
        addCurrentTab.className = isAddCurrentTab
            ? "add-current-tab-btn add-current-tab-btn--active"
            : "add-current-tab-btn";

        creatingBookmark = true;
        btnNewBookmark.textContent = "cancel !";

        actionSection.append(bookmarkInfoDropdown);

        addCurrentTab.addEventListener("click", async () => {
            isAddCurrentTab = !isAddCurrentTab;
            addCurrentTab.className = isAddCurrentTab
                ? "add-current-tab-btn add-current-tab-btn--active"
                : "add-current-tab-btn";
            addCurrentTab.textContent = `add current tab: ${isAddCurrentTab}`;
        });

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "folder / bookmark name";
        textInput.className = "bookmark-name-input";

        const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] =
            await chrome.bookmarks.getTree();
        const folderChoices = collectBookmarkFolderChoices(bookmarkTree);
        if (folderChoices.length === 0) {
            creatingBookmark = resetCreationState(
                actionSection,
                btnNewBookmark,
                "bookmark",
            );
            return;
        }

        const bookmarkSelect = document.createElement("select");
        bookmarkSelect.className = "bookmark-select";

        for (const folder of folderChoices) {
            const option = document.createElement("option");
            option.value = folder.id;
            option.textContent = folder.label;
            bookmarkSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "confirm";
        confirmBtn.className = "bookmark-confirm-btn";

        bookmarkInfoDropdown.append(textInput, bookmarkSelect, confirmBtn);
        textInput.focus();

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", async () => {
            const selectedFolderId = bookmarkSelect.value;
            if (!selectedFolderId) return;

            const typedName = textInput.value.trim();

            if (isAddCurrentTab) {
                const bookmarkName = typedName || "new bookmark";
                const [currentTab] = await chrome.tabs.query({
                    active: true,
                    lastFocusedWindow: true,
                });
                if (!currentTab) return;

                await chrome.bookmarks.create({
                    title: bookmarkName,
                    url: currentTab.url,
                    parentId: selectedFolderId,
                });
            } else if (!isAddCurrentTab) {
                const folderName = typedName || "new folder";

                await chrome.bookmarks.create({
                    title: folderName,
                    parentId: selectedFolderId,
                });
            }
            creatingBookmark = resetCreationState(
                actionSection,
                btnNewBookmark,
                "bookmark",
            );
        });
    });
}
