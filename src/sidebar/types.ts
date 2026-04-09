export type ToggleNode =
    | chrome.bookmarks.BookmarkTreeNode
    | chrome.tabGroups.TabGroup;

export type ToggleType = "tab" | "bookmark";

export type NodeType = chrome.tabs.Tab | ToggleNode;

export type ToggleViewOptions = {
    type?: ToggleType;
    onToggle?: () => void;
    hasChildren?: boolean;
    colour?: string;
    canToggle?: boolean;
};

export type BookmarkFolderChoice = {
    id: string;
    label: string;
};

export function isGroupNode(
    node: ToggleNode | NodeType,
): node is chrome.tabGroups.TabGroup {
    return "collapsed" in node;
}

export function isTabNode(node: NodeType): node is chrome.tabs.Tab {
    return "active" in node;
}
