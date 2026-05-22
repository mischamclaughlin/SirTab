import type { ActionPanelController } from "../types.js";
import {
    collectBookmarkFolderChoices,
    isAllowedBookmarkUrl,
} from "../bookmark/bookmark.js";
import { runButtonAction } from "../helpers/domFactory.js";
import { setButtonIcon } from "../helpers/icons.js";

export async function setupBookmarkAction(
    actionBtnSection: HTMLElement,
    actionPanel: ActionPanelController,
): Promise<void> {
    const btnNewBookmark = document.createElement("button");
    btnNewBookmark.className = "control";
    setButtonIcon(btnNewBookmark, "bookmark", "Create bookmark or folder");
    actionBtnSection.appendChild(btnNewBookmark);

    let isAddCurrentTab = false;

    const closeBookmarkForm = () => {
        isAddCurrentTab = false;
        btnNewBookmark.classList.remove("is-selected");
        setButtonIcon(btnNewBookmark, "bookmark", "Create bookmark or folder");
    };

    btnNewBookmark.addEventListener("click", async () => {
        if (actionPanel.isOpen("bookmark")) {
            actionPanel.close("bookmark");
            return;
        }

        btnNewBookmark.classList.add("is-selected");
        setButtonIcon(btnNewBookmark, "bookmark", "Cancel bookmark creation");

        const bookmarkForm = document.createElement("div");
        bookmarkForm.className = "action-form";

        const addCurrentTab = document.createElement("button");
        addCurrentTab.type = "button";
        addCurrentTab.className = "action-toggle";
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.id = "bookmark-name-input";
        textInput.name = "bookmark-name";
        textInput.className = "control";

        const updateCurrentTabToggle = () => {
            addCurrentTab.classList.toggle("is-selected", isAddCurrentTab);
            setButtonIcon(
                addCurrentTab,
                "addTab",
                isAddCurrentTab
                    ? "Create bookmark from current tab"
                    : "Create folder instead of current tab bookmark",
            );
            addCurrentTab.setAttribute("aria-pressed", String(isAddCurrentTab));
            textInput.placeholder = isAddCurrentTab
                ? "bookmark name"
                : "folder name";
        };

        const bookmarkInfoDropdown = document.createElement("div");
        bookmarkInfoDropdown.className = "info-dropdown";
        bookmarkForm.append(addCurrentTab, bookmarkInfoDropdown);
        actionPanel.open("bookmark", bookmarkForm, closeBookmarkForm);
        updateCurrentTabToggle();

        addCurrentTab.addEventListener("click", () => {
            isAddCurrentTab = !isAddCurrentTab;
            updateCurrentTabToggle();
        });

        const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] =
            await chrome.bookmarks.getTree();
        if (!actionPanel.isOpen("bookmark")) return;

        const folderChoices = collectBookmarkFolderChoices(bookmarkTree);
        if (folderChoices.length === 0) {
            actionPanel.close("bookmark");
            return;
        }

        const bookmarkSelect = document.createElement("select");
        bookmarkSelect.id = "bookmark-folder-select";
        bookmarkSelect.name = "bookmark-folder";
        bookmarkSelect.className = "control";

        for (const folder of folderChoices) {
            const option = document.createElement("option");
            option.value = folder.id;
            option.textContent = folder.label;
            bookmarkSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "control";
        setButtonIcon(confirmBtn, "confirm", "Confirm bookmark creation");

        bookmarkInfoDropdown.append(textInput, bookmarkSelect, confirmBtn);
        textInput.focus();

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", () => {
            void runButtonAction(confirmBtn, async () => {
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
                    if (!currentTab.url || !isAllowedBookmarkUrl(currentTab.url)) {
                        console.warn(
                            "Blocked bookmark creation for unsupported tab URL:",
                            currentTab.url,
                        );
                        return;
                    }

                    await chrome.bookmarks.create({
                        title: bookmarkName,
                        url: currentTab.url,
                        parentId: selectedFolderId,
                    });
                } else {
                    const folderName = typedName || "new folder";

                    await chrome.bookmarks.create({
                        title: folderName,
                        parentId: selectedFolderId,
                    });
                }

                actionPanel.close("bookmark");
            }, "Create bookmark entry failed:");
        });
    });
}
