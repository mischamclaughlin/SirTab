import type { BookmarkFolderChoice, TabSelectionView } from "../types.js";
import { persistCollapse, isCollapsedCheck } from "../helpers/collapseState.js";
import { matchesNodeQuery } from "../helpers/nodeSearch.js";
import { DEFAULT_TAB_ICON_URL } from "../config.js";
import {
    createDeleteButton,
    createToggleButton,
    runButtonAction,
} from "../helpers/domFactory.js";
import { setButtonIcon } from "../helpers/icons.js";

function getBookmarkNodeTitle(node: chrome.bookmarks.BookmarkTreeNode) {
    return node.title?.trim() ?? "";
}

function isRootPlaceholder(node: chrome.bookmarks.BookmarkTreeNode) {
    return !node.url && node.id === "0" && getBookmarkNodeTitle(node).length === 0;
}

function isBookmarksBarFolder(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) return false;

    return (
        node.folderType === "bookmarks-bar" ||
        node.id === "1" ||
        getBookmarkNodeTitle(node).toLowerCase() === "bookmarks bar"
    );
}

function isHiddenSystemFolder(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) return false;

    if (node.folderType != null) {
        return node.folderType !== "bookmarks-bar";
    }

    if (node.unmodifiable === "managed") return true;

    const nodeTitle = getBookmarkNodeTitle(node).toLowerCase();
    return nodeTitle === "other bookmarks" || nodeTitle === "mobile bookmarks";
}

export function collectBookmarkFolderChoices(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    depth = 0,
    choices: BookmarkFolderChoice[] = [],
) {
    for (const node of nodes) {
        const isFolder = !node.url;
        if (!isFolder) continue;
        if (isHiddenSystemFolder(node)) continue;

        const nodeTitle = getBookmarkNodeTitle(node);
        const isRootNode = isRootPlaceholder(node);
        const nextDepth = isRootNode ? depth : depth + 1;

        if (!isRootNode) {
            const depthPrefix =
                depth > 0 ? `${"\u00A0\u00A0".repeat(depth)}- ` : "";
            choices.push({
                id: node.id,
                label: `${depthPrefix}${nodeTitle || "(untitled folder)"}`,
            });
        }

        if (node.children?.length) {
            collectBookmarkFolderChoices(node.children, nextDepth, choices);
        }
    }

    return choices;
}

function orderBookmarkNodesForDisplay(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
) {
    const passthroughNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
    const bookmarkNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
    const folderNodes: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (const node of nodes) {
        if (isHiddenSystemFolder(node)) continue;

        if (isRootPlaceholder(node) || isBookmarksBarFolder(node)) {
            passthroughNodes.push(node);
            continue;
        }

        if (node.url) bookmarkNodes.push(node);
        else folderNodes.push(node);
    }

    return [...passthroughNodes, ...bookmarkNodes, ...folderNodes];
}

function createBookmarkEditForm(
    node: chrome.bookmarks.BookmarkTreeNode,
    fallbackTitle: string,
    onSaved?: () => void,
    onClose?: () => void,
) {
    const form = document.createElement("div");
    form.className = "bookmark-edit-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "control";
    nameInput.value = getBookmarkNodeTitle(node);
    nameInput.placeholder = node.url ? "bookmark name" : "folder name";
    nameInput.setAttribute("aria-label", `Name for ${fallbackTitle}`);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "control";
    setButtonIcon(saveBtn, "confirm", "Save bookmark name");

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "control";
    setButtonIcon(cancelBtn, "clear", "Cancel bookmark editing");

    form.append(nameInput, saveBtn, cancelBtn);

    const close = () => {
        form.remove();
        onClose?.();
    };

    nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") saveBtn.click();
        if (event.key === "Escape") cancelBtn.click();
    });

    cancelBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", () => {
        void runButtonAction(saveBtn, async () => {
            await chrome.bookmarks.update(node.id, {
                title: nameInput.value.trim(),
            });
            close();
            onSaved?.();
        }, "Update bookmark name failed:");
    });

    requestAnimationFrame(() => nameInput.focus());

    return form;
}

export function isAllowedBookmarkUrl(rawUrl: string) {
    try {
        const parsedUrl = new URL(rawUrl);
        return (
            parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
        );
    } catch {
        return false;
    }
}

export function filterBookmarkNodes(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    query: string,
): chrome.bookmarks.BookmarkTreeNode[] {
    if (query.length === 0) return nodes;

    const filteredNodes: chrome.bookmarks.BookmarkTreeNode[] = [];
    for (const node of nodes) {
        const filteredChildren = node.children
            ? filterBookmarkNodes(node.children, query)
            : undefined;
        const matchesSelf = matchesNodeQuery(node, query);
        const hasMatchingChildren = (filteredChildren?.length ?? 0) > 0;
        if (!matchesSelf && !hasMatchingChildren) continue;

        filteredNodes.push({
            ...node,
            children: filteredChildren,
        });
    }

    return filteredNodes;
}

export function cycleBookmarks(
    parentElement: HTMLElement,
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    forceExpandFolders = false,
    collapsedBookmarkFolders?: Set<string>,
    onToggle?: () => void,
    tabSelection?: TabSelectionView,
) {
    const collapsedBookmarkFoldersSet = collapsedBookmarkFolders
        ? collapsedBookmarkFolders
        : new Set<string>();
    const orderedNodes = orderBookmarkNodesForDisplay(nodes);

    for (const node of orderedNodes) {
        if (isHiddenSystemFolder(node)) continue;

        if (isRootPlaceholder(node) || isBookmarksBarFolder(node)) {
            if (node.children)
                cycleBookmarks(
                    parentElement,
                    node.children,
                    forceExpandFolders,
                    collapsedBookmarkFolders,
                    onToggle,
                    tabSelection,
                );
            continue;
        }

        const nodeTitle = getBookmarkNodeTitle(node);
        const isSelectionMode = tabSelection?.isSelectionMode() ?? false;
        const li = document.createElement("li");
        li.className = "tab-item";

        if (node.url) {
            const btn = document.createElement("button");
            btn.className = "tab-button";
            btn.type = "button";
            btn.addEventListener("click", async () => {
                if (!isAllowedBookmarkUrl(node.url!)) {
                    console.warn(
                        "Blocked bookmark URL with unsupported scheme:",
                        node.url,
                    );
                    return;
                }
                await chrome.tabs.create({ url: node.url });
            });

            const icon = document.createElement("img");
            icon.className = "tab-icon";
            icon.src = DEFAULT_TAB_ICON_URL;
            icon.height = 16;
            icon.width = 16;

            const label = document.createElement("span");
            label.className = "tab-label";
            label.textContent = nodeTitle || node.url || "(Untitled tab)";

            btn.append(icon, label);

            const row = document.createElement("div");
            row.className = "tab-row";
            if (isSelectionMode) row.classList.add("tab-row--with-edit");

            const deleteBookmarkBtn = createDeleteButton(
                "Delete bookmark",
                async () => {
                    await chrome.bookmarks.remove(node.id);
                },
            );
            let editBookmarkBtn: HTMLButtonElement | null = null;
            if (isSelectionMode) {
                editBookmarkBtn = document.createElement("button");
                editBookmarkBtn.type = "button";
                editBookmarkBtn.className = "row-icon-btn";
                setButtonIcon(
                    editBookmarkBtn,
                    "edit",
                    `Edit bookmark ${nodeTitle || node.url || "(untitled)"}. Available in select mode.`,
                );
                row.append(btn, editBookmarkBtn, deleteBookmarkBtn);
            } else {
                row.append(btn, deleteBookmarkBtn);
            }
            li.appendChild(row);
            let editForm: HTMLElement | null = null;
            editBookmarkBtn?.addEventListener("click", () => {
                if (!editBookmarkBtn) return;

                if (editForm) {
                    editForm.remove();
                    editForm = null;
                    editBookmarkBtn.classList.remove("is-selected");
                    return;
                }

                editBookmarkBtn.classList.add("is-selected");
                editForm = createBookmarkEditForm(
                    node,
                    nodeTitle || node.url || "(untitled)",
                    onToggle,
                    () => {
                        editForm = null;
                        editBookmarkBtn.classList.remove("is-selected");
                    },
                );
                row.after(editForm);
            });
            parentElement.appendChild(li);
            continue;
        }

        const hasChildren = (node.children?.length ?? 0) > 0;
        const isCollapsed =
            !forceExpandFolders &&
            isCollapsedCheck(node.id, collapsedBookmarkFoldersSet);
        const nestedListId = `bookmark-folder-${node.id}`;

        const btn = createToggleButton(
            isCollapsed,
            node,
            collapsedBookmarkFoldersSet,
            {
                type: "bookmark",
                onToggle,
                hasChildren,
                canToggle: hasChildren && !forceExpandFolders,
                controlsId: hasChildren ? nestedListId : undefined,
            },
        );

        const row = document.createElement("div");
        row.className = "tree-row";
        if (isSelectionMode) row.classList.add("tree-row--with-edit");
        const deleteFolderBtn = createDeleteButton(
            "Delete folder",
            async () => {
                if (hasChildren) {
                    const folderName = nodeTitle || "(untitled)";
                    const confirmed = window.confirm(
                        `Delete folder "${folderName}" and all nested bookmarks?`,
                    );
                    if (!confirmed) return;
                }

                removeNodeFromCollapsed(node, collapsedBookmarkFoldersSet);
                await persistCollapse(collapsedBookmarkFoldersSet, "bookmark");

                if (hasChildren) {
                    await chrome.bookmarks.removeTree(node.id);
                } else {
                    await chrome.bookmarks.remove(node.id);
                }
            },
        );
        let editFolderBtn: HTMLButtonElement | null = null;
        if (isSelectionMode) {
            editFolderBtn = document.createElement("button");
            editFolderBtn.type = "button";
            editFolderBtn.className = "row-icon-btn";
            setButtonIcon(
                editFolderBtn,
                "edit",
                `Edit folder ${nodeTitle || "(untitled)"}. Available in select mode.`,
            );
            row.append(btn, editFolderBtn, deleteFolderBtn);
        } else {
            row.append(btn, deleteFolderBtn);
        }
        li.appendChild(row);
        let editForm: HTMLElement | null = null;
        editFolderBtn?.addEventListener("click", () => {
            if (!editFolderBtn) return;

            if (editForm) {
                editForm.remove();
                editForm = null;
                editFolderBtn.classList.remove("is-selected");
                return;
            }

            editFolderBtn.classList.add("is-selected");
            editForm = createBookmarkEditForm(
                node,
                nodeTitle || "(untitled)",
                onToggle,
                () => {
                    editForm = null;
                    editFolderBtn.classList.remove("is-selected");
                },
            );
            row.after(editForm);
        });

        if (hasChildren) {
            const nestedList = document.createElement("ul");
            nestedList.className = "bookmark-nested-list";
            nestedList.id = nestedListId;
            nestedList.hidden = isCollapsed;
            li.appendChild(nestedList);

            if (!isCollapsed) {
                cycleBookmarks(
                    nestedList,
                    node.children!,
                    forceExpandFolders,
                    collapsedBookmarkFoldersSet,
                    onToggle,
                    tabSelection,
                );
            }
        }

        parentElement.appendChild(li);
    }
}

export function removeNodeFromCollapsed(
    node: chrome.bookmarks.BookmarkTreeNode,
    list: Set<string>,
) {
    if (node.url) return;

    const nodeId = String(node.id);
    list.delete(nodeId);

    const childrenNodes = node.children;
    if (!childrenNodes) return;

    for (const cNode of childrenNodes) {
        removeNodeFromCollapsed(cNode, list);
    }
}
