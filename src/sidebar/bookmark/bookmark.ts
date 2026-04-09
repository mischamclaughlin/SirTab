import { BookmarkFolderChoice } from "../types.js";
import { persistCollapse, isCollapsedCheck } from "../helpers/collapseState.js";
import { matchesNodeQuery } from "../helpers/nodeSearch.js";
import { DEFAULT_TAB_ICON_URL } from "../config.js";
import {
    createDeleteButton,
    createToggleButton,
} from "../helpers/domFactory.js";

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
                depth > 0 ? `${"\u00A0\u00A0".repeat(depth)}] ` : "";
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
                );
            continue;
        }

        const nodeTitle = getBookmarkNodeTitle(node);
        const li = document.createElement("li");
        li.className = "tab-item";

        if (node.url) {
            const btn = document.createElement("button");
            btn.className = "ungroup-tab";
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

            const deleteBookmarkBtn = createDeleteButton(
                "Delete bookmark",
                async () => {
                    await chrome.bookmarks.remove(node.id);
                },
            );
            row.append(btn, deleteBookmarkBtn);
            li.appendChild(row);
            parentElement.appendChild(li);
            continue;
        }

        const hasChildren = (node.children?.length ?? 0) > 0;
        const isCollapsed =
            !forceExpandFolders &&
            isCollapsedCheck(node.id, collapsedBookmarkFoldersSet);

        const btn = createToggleButton(
            isCollapsed,
            node,
            collapsedBookmarkFoldersSet,
            {
                type: "bookmark",
                onToggle,
                hasChildren,
                canToggle: hasChildren && !forceExpandFolders,
            },
        );

        const row = document.createElement("div");
        row.className = "group-row";
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
        row.append(btn, deleteFolderBtn);
        li.appendChild(row);
        parentElement.appendChild(li);

        if (hasChildren && !isCollapsed) {
            const nestedList = document.createElement("ul");
            nestedList.className = "bookmark-nested-list";
            li.appendChild(nestedList);
            cycleBookmarks(
                nestedList,
                node.children!,
                forceExpandFolders,
                collapsedBookmarkFoldersSet,
                onToggle,
            );
        }
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
