import type { RequestRender } from "../types.js";
import {
    buildTabsByLogicalGroup,
    getTabGroupId,
    loadLogicalTabGroupData,
    moveStoredGroupRelative,
    moveStoredGroupToEnd,
    moveStoredTabsRelative,
    moveStoredTabsToEnd,
} from "../../shared/groupOrder.js";
import type { DropPosition } from "../../shared/groupOrder.js";
import { isAllowedBookmarkUrl } from "../bookmark/url.js";

type DragPayload =
    | { kind: "tabs"; ids: number[] }
    | { kind: "group"; id: number };

type DragEnabledCheck = () => boolean;

const DRAG_DATA_MIME = "application/x-sirtab-drag";
const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;
const AUTO_SCROLL_EDGE_PX = 72;
const AUTO_SCROLL_MAX_STEP_PX = 18;

let activeDropIndicator:
    | { element: HTMLElement; className: string }
    | null = null;
let activeDragElement: HTMLElement | null = null;
let activeDragPayload: DragPayload | null = null;
let activeDragVersion = 0;
let pendingDropActions = 0;
let documentListenersInstalled = false;
const renderAfterDrag = new Set<RequestRender>();
let activeDragPoint: { x: number; y: number } | null = null;
let activeAutoScrollFrame: number | null = null;
let updateDropAtPoint: ((x: number, y: number) => void) | null = null;

function notifyDragSettled() {
    if (activeDragPayload || pendingDropActions > 0) return;

    const pendingRenders = [...renderAfterDrag];
    renderAfterDrag.clear();
    for (const requestRender of pendingRenders) requestRender();
}

/** Preserve the native drag source until dragging and its drop action finish. */
export function deferRenderUntilDragSettles(requestRender: RequestRender) {
    if (!activeDragPayload && pendingDropActions === 0) return false;

    renderAfterDrag.add(requestRender);
    return true;
}

function getScrollRoot() {
    return document.getElementById("sidebar-content") ??
        document.scrollingElement ?? document.documentElement;
}

function getAutoScrollStep(clientY: number) {
    const contentBounds = document.getElementById("sidebar-content")
        ?.getBoundingClientRect();
    const top = contentBounds?.top ?? 0;
    const bottom = contentBounds?.bottom ?? window.innerHeight;
    const edge = Math.min(AUTO_SCROLL_EDGE_PX, (bottom - top) / 2);
    if (edge <= 0 || clientY < top || clientY > bottom) return 0;

    if (clientY < top + edge) {
        const ratio = Math.min(
            1,
            (top + edge - clientY) / edge,
        );
        return -Math.ceil(ratio * AUTO_SCROLL_MAX_STEP_PX);
    }

    const bottomEdge = bottom - edge;
    if (clientY > bottomEdge) {
        const ratio = Math.min(
            1,
            (clientY - bottomEdge) / edge,
        );
        return Math.ceil(ratio * AUTO_SCROLL_MAX_STEP_PX);
    }

    return 0;
}

function stopAutoScroll() {
    if (activeAutoScrollFrame == null) return;

    cancelAnimationFrame(activeAutoScrollFrame);
    activeAutoScrollFrame = null;
}

function stepAutoScroll() {
    if (activeDragPoint == null) {
        activeAutoScrollFrame = null;
        return;
    }

    const scrollRoot = getScrollRoot();
    const scrollStep = getAutoScrollStep(activeDragPoint.y);
    const maxScrollTop = Math.max(
        0,
        scrollRoot.scrollHeight - scrollRoot.clientHeight,
    );
    const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, scrollRoot.scrollTop + scrollStep),
    );

    if (scrollStep === 0 || nextScrollTop === scrollRoot.scrollTop) {
        activeAutoScrollFrame = null;
        return;
    }

    scrollRoot.scrollTop = nextScrollTop;
    // The pointer can remain stationary while the rows scroll underneath it.
    // Native dragover is not guaranteed to fire on every scroll frame.
    updateDropAtPoint?.(activeDragPoint.x, activeDragPoint.y);
    activeAutoScrollFrame = requestAnimationFrame(stepAutoScroll);
}

function updateAutoScroll(event: DragEvent) {
    activeDragPoint = { x: event.clientX, y: event.clientY };
    if (getAutoScrollStep(event.clientY) === 0) {
        stopAutoScroll();
        return;
    }

    if (activeAutoScrollFrame == null) {
        activeAutoScrollFrame = requestAnimationFrame(stepAutoScroll);
    }
}

function clearDropIndicator() {
    if (!activeDropIndicator) return;
    activeDropIndicator.element.classList.remove(activeDropIndicator.className);
    activeDropIndicator = null;
}

function setDropIndicator(element: HTMLElement, className: string) {
    if (
        activeDropIndicator?.element === element &&
        activeDropIndicator.className === className
    ) {
        return;
    }

    clearDropIndicator();
    element.classList.add(className);
    activeDropIndicator = { element, className };
}

function clearDragElement() {
    if (!activeDragElement) return;
    activeDragElement.classList.remove("is-dragging");
    activeDragElement = null;
}

function setDragElement(element: HTMLElement) {
    clearDragElement();
    element.classList.add("is-dragging");
    activeDragElement = element;
}

function clearDragState() {
    stopAutoScroll();
    activeDragPoint = null;
    clearDropIndicator();
    clearDragElement();
    activeDragPayload = null;
    notifyDragSettled();
}

function serialisePayload(payload: DragPayload) {
    return JSON.stringify(payload);
}

function writePayload(event: DragEvent, payload: DragPayload, row: HTMLElement) {
    const dataTransfer = event.dataTransfer;
    activeDragVersion += 1;
    activeDragPayload = payload;
    if (!dataTransfer) return;

    const serialisedPayload = serialisePayload(payload);
    dataTransfer.effectAllowed = payload.kind === "tabs" ? "copyMove" : "move";
    dataTransfer.setData(DRAG_DATA_MIME, serialisedPayload);
    const bounds = row.getBoundingClientRect();
    dataTransfer.setDragImage(
        row,
        Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
        Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
    );
}

function getDropPosition(event: DragEvent, element: HTMLElement): DropPosition {
    const bounds = element.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

async function moveTabsRelativeToTab(
    windowId: number,
    sourceTabIds: number[],
    targetTabId: number,
    position: DropPosition,
) {
    const sourceIdSet = new Set(sourceTabIds);
    if (sourceIdSet.has(targetTabId)) return;

    const { tabs } = await loadLogicalTabGroupData(windowId);
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    if (targetTab?.id == null) return;

    const orderedSourceTabIds = tabs
        .map((tab) => tab.id)
        .filter(
            (tabId): tabId is number =>
                tabId != null && sourceIdSet.has(tabId),
        );
    if (orderedSourceTabIds.length === 0) return;
    const targetGroupId = getTabGroupId(targetTab);
    await changeTabsGroup(tabs, orderedSourceTabIds, targetGroupId);
    await moveStoredTabsRelative(windowId, orderedSourceTabIds, targetTabId, position);
}

async function changeTabsGroup(
    tabs: chrome.tabs.Tab[],
    sourceTabIds: number[],
    targetGroupId: number,
) {
    const sourceIds = new Set(sourceTabIds);
    const changing = tabs
        .filter((tab) => tab.id != null && sourceIds.has(tab.id) &&
            getTabGroupId(tab) !== targetGroupId)
        .map((tab) => tab.id as number);
    if (changing.length === 0) return;
    const tabIds = changing as [number, ...number[]];
    if (targetGroupId === NO_GROUP_ID) {
        await chrome.tabs.ungroup(tabIds);
    } else {
        await chrome.tabs.group({ groupId: targetGroupId, tabIds });
    }
}

async function moveTabsToGroup(
    windowId: number,
    sourceTabIds: number[],
    targetGroupId: number,
) {
    const sourceIdSet = new Set(sourceTabIds);
    const { tabs, groups } = await loadLogicalTabGroupData(windowId);
    if (!groups.some((group) => group.id === targetGroupId)) return;

    const orderedSourceTabIds = tabs
        .map((tab) => tab.id)
        .filter(
            (tabId): tabId is number =>
                tabId != null && sourceIdSet.has(tabId),
        );
    if (orderedSourceTabIds.length === 0) return;
    const { tabsByGroup } = buildTabsByLogicalGroup(tabs);
    const targetGroupTabs = (tabsByGroup.get(targetGroupId) ?? []).filter(
        (tab) => tab.id == null || !sourceIdSet.has(tab.id),
    );

    await changeTabsGroup(tabs, orderedSourceTabIds, targetGroupId);

    const lastTargetTabId = targetGroupTabs[targetGroupTabs.length - 1]?.id;
    if (lastTargetTabId == null) {
        await moveStoredTabsToEnd(windowId, orderedSourceTabIds);
    } else {
        await moveStoredTabsRelative(windowId, orderedSourceTabIds, lastTargetTabId, "after");
    }
}

async function moveTabsToUngroupedEnd(windowId: number, sourceTabIds: number[]) {
    const sourceIdSet = new Set(sourceTabIds);
    const { tabs } = await loadLogicalTabGroupData(windowId);
    const orderedSourceTabIds = tabs
        .map((tab) => tab.id)
        .filter(
            (tabId): tabId is number =>
                tabId != null && sourceIdSet.has(tabId),
        );
    if (orderedSourceTabIds.length === 0) return;
    const { ungroupedTabs } = buildTabsByLogicalGroup(tabs);
    const targetTabs = ungroupedTabs.filter(
        (tab) => tab.id == null || !sourceIdSet.has(tab.id),
    );

    await changeTabsGroup(tabs, orderedSourceTabIds, NO_GROUP_ID);

    const lastTargetTabId = targetTabs[targetTabs.length - 1]?.id;
    if (lastTargetTabId == null) {
        await moveStoredTabsToEnd(windowId, orderedSourceTabIds);
    } else {
        await moveStoredTabsRelative(windowId, orderedSourceTabIds, lastTargetTabId, "after");
    }
}

async function moveGroupRelativeToGroup(
    windowId: number,
    sourceGroupId: number,
    targetGroupId: number,
    position: DropPosition,
) {
    await moveStoredGroupRelative(
        windowId,
        sourceGroupId,
        targetGroupId,
        position,
    );
}

async function moveGroupToGroupListEnd(windowId: number, sourceGroupId: number) {
    await moveStoredGroupToEnd(windowId, sourceGroupId);
}

async function getBookmarksBarId() {
    const tree = await chrome.bookmarks.getTree();
    const folders = tree.flatMap((node) => node.children ?? []);
    const bar = folders.find((node) => !node.url &&
        (node.folderType === "bookmarks-bar" || node.id === "1"));
    if (!bar) throw new Error("Bookmarks Bar folder not found");
    return bar.id;
}

async function bookmarkTabs(tabIds: number[], parentId?: string) {
    const destinationId = parentId ?? await getBookmarksBarId();
    for (const tabId of tabIds) {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || !isAllowedBookmarkUrl(tab.url)) continue;
        await chrome.bookmarks.create({
            parentId: destinationId,
            title: tab.title?.trim() || tab.url,
            url: tab.url,
        });
    }
}

async function runDropAction(
    action: () => Promise<void>,
    requestRender: RequestRender,
) {
    const dragVersion = activeDragVersion;
    pendingDropActions += 1;
    try {
        await action();
    } catch (error) {
        console.error("Drag and drop action failed:", error);
    } finally {
        renderAfterDrag.add(requestRender);
        pendingDropActions -= 1;
        if (dragVersion === activeDragVersion) {
            clearDragState();
        } else {
            notifyDragSettled();
        }
    }
}

type DropTarget = {
    element: HTMLElement;
    className: string;
    action: () => Promise<void>;
    effect?: "copy" | "move";
    requestRender?: RequestRender;
};

function getDropTarget(
    target: EventTarget | null,
    clientY: number,
    payload: DragPayload,
    tabsList: HTMLElement,
    groupsList: HTMLElement,
    bookmarksList: HTMLElement,
    windowId: number,
    requestBookmarkRender: RequestRender,
): DropTarget | null {
    if (!(target instanceof Element)) return null;

    if (bookmarksList.contains(target) && payload.kind === "tabs") {
        const item = target.closest<HTMLElement>(".tab-item");
        const bookmarkItem = item && bookmarksList.contains(item) ? item : null;
        const folderId = bookmarkItem?.dataset.bookmarkFolderId;
        const parentId = folderId ?? bookmarkItem?.dataset.bookmarkParentId;
        const row = bookmarkItem?.querySelector<HTMLElement>(
            folderId ? ".tree-row" : ".tab-row",
        );
        return {
            element: row ?? bookmarksList,
            className: row ? "drop-inside" : "drop-append",
            action: () => bookmarkTabs(payload.ids, parentId),
            effect: "copy",
            requestRender: requestBookmarkRender,
        };
    }

    const tabRow = target.closest<HTMLElement>(".tab-row");
    if (tabRow && (tabsList.contains(tabRow) || groupsList.contains(tabRow))) {
        const tabId = Number(tabRow.closest<HTMLElement>(".tab-item")?.dataset.tabId);
        if (payload.kind !== "tabs" || !Number.isInteger(tabId) ||
            payload.ids.includes(tabId)) return null;
        const position = getDropPosition({ clientY } as DragEvent, tabRow);
        return {
            element: tabRow,
            className: position === "before" ? "drop-before" : "drop-after",
            action: () => moveTabsRelativeToTab(windowId, payload.ids, tabId, position),
        };
    }

    if (groupsList.contains(target)) {
        const groupItem = target.closest<HTMLElement>(".group-item");
        const groupId = Number(groupItem?.dataset.groupId);
        const groupRow = groupItem?.querySelector<HTMLElement>(".tree-row");
        if (groupItem && groupRow && Number.isInteger(groupId)) {
            if (payload.kind === "tabs") {
                return {
                    element: groupRow,
                    className: "drop-inside",
                    action: () => moveTabsToGroup(windowId, payload.ids, groupId),
                };
            }
            if (groupRow.contains(target) && payload.id !== groupId) {
                const position = getDropPosition({ clientY } as DragEvent, groupRow);
                return {
                    element: groupRow,
                    className: position === "before" ? "drop-before" : "drop-after",
                    action: () => moveGroupRelativeToGroup(windowId, payload.id, groupId, position),
                };
            }
            return null;
        }
        if (payload.kind === "group") {
            return {
                element: groupsList,
                className: "drop-append",
                action: () => moveGroupToGroupListEnd(windowId, payload.id),
            };
        }
    }

    if (tabsList.contains(target) && payload.kind === "tabs") {
        return {
            element: tabsList,
            className: "drop-append",
            action: () => moveTabsToUngroupedEnd(windowId, payload.ids),
        };
    }
    return null;
}

export function setupSidebarDropZones(
    tabsList: HTMLElement,
    groupsList: HTMLElement,
    bookmarksList: HTMLElement,
    windowId: number,
    isDragEnabled: DragEnabledCheck,
    requestRender: RequestRender,
    requestBookmarkRender: RequestRender,
) {
    if (!documentListenersInstalled) {
        documentListenersInstalled = true;
        const hitTest = (x: number, y: number) => document.elementFromPoint(x, y);
        const resolveAt = (target: EventTarget | null, y: number) =>
            activeDragPayload && isDragEnabled()
                ? getDropTarget(target, y, activeDragPayload, tabsList, groupsList,
                    bookmarksList, windowId, requestBookmarkRender)
                : null;
        updateDropAtPoint = (x, y) => {
            const dropTarget = resolveAt(hitTest(x, y), y);
            if (dropTarget) {
                setDropIndicator(dropTarget.element, dropTarget.className);
            } else {
                clearDropIndicator();
            }
        };
        document.addEventListener("dragover", (event) => {
            if (!activeDragPayload) return;
            const dropTarget = resolveAt(event.target, event.clientY);
            if (dropTarget) {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = dropTarget.effect ?? "move";
                setDropIndicator(dropTarget.element, dropTarget.className);
            } else {
                clearDropIndicator();
            }
            updateAutoScroll(event);
        });
        document.addEventListener("drop", (event) => {
            const dropTarget = resolveAt(
                hitTest(event.clientX, event.clientY) ?? event.target,
                event.clientY,
            );
            if (!dropTarget) {
                clearDragState();
                return;
            }
            event.preventDefault();
            void runDropAction(dropTarget.action, dropTarget.requestRender ?? requestRender);
        });
        document.addEventListener("dragend", clearDragState);
    }
}

export function makeTabDraggable(
    handle: HTMLElement,
    row: HTMLElement,
    windowId: number,
    tabId: number,
    isDragEnabled: DragEnabledCheck,
    requestRender: RequestRender,
    getDragTabIds?: (tabId: number) => number[],
) {
    handle.draggable = true;
    handle.classList.add("is-draggable");

    handle.addEventListener("dragstart", (event) => {
        if (!isDragEnabled()) {
            event.preventDefault();
            return;
        }

        writePayload(event, {
            kind: "tabs",
            ids: getDragTabIds?.(tabId) ?? [tabId],
        }, row);
        setDragElement(row);
    });

    handle.addEventListener("dragend", () => {
        clearDragState();
    });

}

export function makeGroupDraggable(
    handle: HTMLElement,
    row: HTMLElement,
    windowId: number,
    groupId: number,
    isDragEnabled: DragEnabledCheck,
    requestRender: RequestRender,
) {
    handle.draggable = true;
    handle.classList.add("is-draggable");

    handle.addEventListener("dragstart", (event) => {
        if (!isDragEnabled()) {
            event.preventDefault();
            return;
        }

        writePayload(event, { kind: "group", id: groupId }, row);
        setDragElement(row);
    });

    handle.addEventListener("dragend", () => {
        clearDragState();
    });

}
