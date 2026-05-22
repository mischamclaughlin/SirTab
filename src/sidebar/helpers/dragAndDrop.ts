import type { RequestRender } from "../types.js";
import {
    buildTabsByLogicalGroup,
    getTabGroupId,
    loadLogicalTabGroupData,
    moveStoredGroupRelative,
    moveStoredGroupToEnd,
    moveStoredTabRelative,
    moveStoredTabToEnd,
    setTabGroup,
} from "../../shared/groupOrder.js";
import type { DropPosition } from "../../shared/groupOrder.js";

type DragPayload =
    | { kind: "tabs"; ids: number[] }
    | { kind: "group"; id: number };
type NonEmptyNumberArray = [number, ...number[]];

type DragEnabledCheck = () => boolean;

const DRAG_DATA_MIME = "application/x-sirtab-drag";
const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

let activeDropIndicator:
    | { element: HTMLElement; className: string }
    | null = null;
let activeDragElement: HTMLElement | null = null;
let activeDragPayload: DragPayload | null = null;

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
    clearDropIndicator();
    clearDragElement();
    activeDragPayload = null;
}

function serialisePayload(payload: DragPayload) {
    return JSON.stringify(payload);
}

function parsePayload(rawPayload: string): DragPayload | null {
    if (rawPayload.length === 0) return null;

    try {
        const parsed = JSON.parse(rawPayload) as unknown;
        if (
            typeof parsed !== "object" ||
            parsed == null ||
            !("kind" in parsed)
        ) {
            return null;
        }

        const kind = parsed.kind;
        if (kind !== "tabs" && kind !== "group") return null;

        if (kind === "group") {
            if (
                !("id" in parsed) ||
                typeof parsed.id !== "number" ||
                !Number.isFinite(parsed.id)
            ) {
                return null;
            }

            return { kind, id: parsed.id };
        }

        if (!("ids" in parsed) || !Array.isArray(parsed.ids)) return null;

        const ids = parsed.ids.filter(
            (rawId): rawId is number =>
                typeof rawId === "number" && Number.isFinite(rawId),
        );
        if (ids.length === 0) return null;

        return { kind, ids };
    } catch {
        return null;
    }
}

function readPayload(event: DragEvent): DragPayload | null {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return null;

    return parsePayload(
        dataTransfer.getData(DRAG_DATA_MIME) ||
        dataTransfer.getData("text/plain"),
    );
}

function writePayload(event: DragEvent, payload: DragPayload) {
    const dataTransfer = event.dataTransfer;
    activeDragPayload = payload;
    if (!dataTransfer) return;

    const serialisedPayload = serialisePayload(payload);
    dataTransfer.effectAllowed = "move";
    dataTransfer.setData(DRAG_DATA_MIME, serialisedPayload);
    dataTransfer.setData("text/plain", serialisedPayload);
}

function getDropPosition(event: DragEvent, element: HTMLElement): DropPosition {
    const bounds = element.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function toNonEmptyNumberArray(ids: number[]): NonEmptyNumberArray | null {
    return ids.length > 0 ? (ids as NonEmptyNumberArray) : null;
}

async function moveTabRelativeToTab(
    windowId: number,
    sourceTabId: number,
    targetTabId: number,
    position: DropPosition,
) {
    if (sourceTabId === targetTabId) return;

    const { tabs } = await loadLogicalTabGroupData(windowId);
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    if (targetTab?.id == null) return;

    await setTabGroup(sourceTabId, getTabGroupId(targetTab));
    await moveStoredTabRelative(windowId, sourceTabId, targetTabId, position);
}

async function moveTabToGroup(
    windowId: number,
    sourceTabId: number,
    targetGroupId: number,
) {
    const { tabs, groups } = await loadLogicalTabGroupData(windowId);
    if (!groups.some((group) => group.id === targetGroupId)) return;

    const { tabsByGroup } = buildTabsByLogicalGroup(tabs);
    const targetGroupTabs = (tabsByGroup.get(targetGroupId) ?? []).filter(
        (tab) => tab.id !== sourceTabId,
    );

    await setTabGroup(sourceTabId, targetGroupId);
    const lastTargetTab = targetGroupTabs[targetGroupTabs.length - 1];
    if (lastTargetTab?.id == null) {
        await moveStoredTabToEnd(windowId, sourceTabId);
        return;
    }

    await moveStoredTabRelative(
        windowId,
        sourceTabId,
        lastTargetTab.id,
        "after",
    );
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
    if (orderedSourceTabIds.length === 1) {
        await moveTabToGroup(windowId, orderedSourceTabIds[0], targetGroupId);
        return;
    }

    const { tabsByGroup } = buildTabsByLogicalGroup(tabs);
    const targetGroupTabs = (tabsByGroup.get(targetGroupId) ?? []).filter(
        (tab) => tab.id == null || !sourceIdSet.has(tab.id),
    );

    const tabIds = toNonEmptyNumberArray(orderedSourceTabIds);
    if (!tabIds) return;

    await chrome.tabs.group({
        groupId: targetGroupId,
        tabIds,
    });

    let previousTargetTabId = targetGroupTabs[targetGroupTabs.length - 1]?.id;
    for (const tabId of orderedSourceTabIds) {
        if (previousTargetTabId == null) {
            await moveStoredTabToEnd(windowId, tabId);
        } else {
            await moveStoredTabRelative(
                windowId,
                tabId,
                previousTargetTabId,
                "after",
            );
        }
        previousTargetTabId = tabId;
    }
}

async function moveTabToUngroupedEnd(windowId: number, sourceTabId: number) {
    const { tabs } = await loadLogicalTabGroupData(windowId);
    const { ungroupedTabs } = buildTabsByLogicalGroup(tabs);
    const targetTabs = ungroupedTabs.filter((tab) => tab.id !== sourceTabId);

    await setTabGroup(sourceTabId, NO_GROUP_ID);
    const lastTargetTab = targetTabs[targetTabs.length - 1];
    if (lastTargetTab?.id == null) {
        await moveStoredTabToEnd(windowId, sourceTabId);
        return;
    }

    await moveStoredTabRelative(
        windowId,
        sourceTabId,
        lastTargetTab.id,
        "after",
    );
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
    if (orderedSourceTabIds.length === 1) {
        await moveTabToUngroupedEnd(windowId, orderedSourceTabIds[0]);
        return;
    }

    const { ungroupedTabs } = buildTabsByLogicalGroup(tabs);
    const targetTabs = ungroupedTabs.filter(
        (tab) => tab.id == null || !sourceIdSet.has(tab.id),
    );

    const tabIds = toNonEmptyNumberArray(orderedSourceTabIds);
    if (!tabIds) return;

    await chrome.tabs.ungroup(tabIds);

    let previousTargetTabId = targetTabs[targetTabs.length - 1]?.id;
    for (const tabId of orderedSourceTabIds) {
        if (previousTargetTabId == null) {
            await moveStoredTabToEnd(windowId, tabId);
        } else {
            await moveStoredTabRelative(
                windowId,
                tabId,
                previousTargetTabId,
                "after",
            );
        }
        previousTargetTabId = tabId;
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

async function runDropAction(
    action: () => Promise<void>,
    requestRender: RequestRender,
) {
    try {
        await action();
        requestRender();
    } catch (error) {
        console.error("Drag and drop move failed:", error);
    } finally {
        clearDragState();
    }
}

function getEnabledPayload(
    event: DragEvent,
    isDragEnabled: DragEnabledCheck,
) {
    if (!isDragEnabled()) return null;

    return readPayload(event) ?? activeDragPayload;
}

export function setupSidebarDropZones(
    tabsList: HTMLElement,
    groupsList: HTMLElement,
    windowId: number,
    isDragEnabled: DragEnabledCheck,
    requestRender: RequestRender,
) {
    tabsList.addEventListener("dragover", (event) => {
        if (event.target !== tabsList) return;

        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload || payload.kind !== "tabs") return;

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        setDropIndicator(tabsList, "drop-append");
    });

    tabsList.addEventListener("drop", (event) => {
        if (event.target !== tabsList) return;

        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload || payload.kind !== "tabs") return;

        event.preventDefault();
        void runDropAction(
            async () => moveTabsToUngroupedEnd(windowId, payload.ids),
            requestRender,
        );
    });

    groupsList.addEventListener("dragover", (event) => {
        if (event.target !== groupsList) return;

        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload || payload.kind !== "group") return;

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        setDropIndicator(groupsList, "drop-append");
    });

    groupsList.addEventListener("drop", (event) => {
        if (event.target !== groupsList) return;

        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload || payload.kind !== "group") return;

        event.preventDefault();
        void runDropAction(
            async () => moveGroupToGroupListEnd(windowId, payload.id),
            requestRender,
        );
    });
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
        });
        setDragElement(row);
    });

    handle.addEventListener("dragend", () => {
        clearDragState();
    });

    row.addEventListener("dragover", (event) => {
        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload) return;
        if (
            payload.kind !== "tabs" ||
            payload.ids.length !== 1 ||
            payload.ids[0] === tabId
        ) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }

        const position = getDropPosition(event, row);
        setDropIndicator(row, position === "before" ? "drop-before" : "drop-after");
    });

    row.addEventListener("drop", (event) => {
        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload) return;
        if (
            payload.kind !== "tabs" ||
            payload.ids.length !== 1 ||
            payload.ids[0] === tabId
        ) {
            return;
        }

        event.preventDefault();
        const position = getDropPosition(event, row);

        void runDropAction(async () => {
            await moveTabRelativeToTab(
                windowId,
                payload.ids[0],
                tabId,
                position,
            );
        }, requestRender);
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

        writePayload(event, { kind: "group", id: groupId });
        setDragElement(row);
    });

    handle.addEventListener("dragend", () => {
        clearDragState();
    });

    row.addEventListener("dragover", (event) => {
        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload) return;
        if (payload.kind === "group" && payload.id === groupId) return;

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }

        if (payload.kind === "tabs") {
            setDropIndicator(row, "drop-inside");
            return;
        }

        const position = getDropPosition(event, row);
        setDropIndicator(row, position === "before" ? "drop-before" : "drop-after");
    });

    row.addEventListener("drop", (event) => {
        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload) return;
        if (payload.kind === "group" && payload.id === groupId) return;

        event.preventDefault();

        void runDropAction(async () => {
            if (payload.kind === "tabs") {
                await moveTabsToGroup(windowId, payload.ids, groupId);
                return;
            }

            const position = getDropPosition(event, row);
            await moveGroupRelativeToGroup(
                windowId,
                payload.id,
                groupId,
                position,
            );
        }, requestRender);
    });
}
