export type SidebarElements = {
    actions: HTMLElement;
    actionBtnSection: HTMLElement;
    actionPanelSection: HTMLElement;
    tabsList: HTMLElement;
    groupsList: HTMLElement;
    bookmarksList: HTMLElement;
    settings: HTMLElement;
};

export type ActionPanelController = {
    open: (
        ownerId: string,
        content: HTMLElement,
        onClose: () => void,
    ) => void;
    close: (ownerId?: string) => boolean;
    isOpen: (ownerId: string) => boolean;
};

export type ToggleNode =
    | chrome.bookmarks.BookmarkTreeNode
    | chrome.tabGroups.TabGroup;
export type NodeType = chrome.tabs.Tab | ToggleNode;
export type ToggleType = "tab" | "bookmark";
export type ToggleViewOptions = {
    type?: ToggleType;
    onToggle?: () => void;
    hasChildren?: boolean;
    colour?: string;
    canToggle?: boolean;
    controlsId?: string;
};

export type RenderStaleCheck = () => boolean;
export type RenderFn = (isStale: RenderStaleCheck) => Promise<void>;
export type RequestRender = () => void;

export type TabSelectionView = {
    isSelectionMode: () => boolean;
    isSelected: (tabId: number) => boolean;
    toggleTab: (tabId: number) => void;
    selectRange: (visibleTabIds: number[], targetTabId: number) => void;
    getDragTabIds: (tabId: number) => number[];
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
