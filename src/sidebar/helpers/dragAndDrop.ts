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
    | { kind: "tab"; id: number }
    | { kind: "group"; id: number };

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
            !("kind" in parsed) ||
            !("id" in parsed)
        ) {
            return null;
        }

        const kind = parsed.kind;
        const id = parsed.id;
        if (
            (kind !== "tab" && kind !== "group") ||
            typeof id !== "number" ||
            !Number.isFinite(id)
        ) {
            return null;
        }

        return { kind, id };
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
        if (!payload || payload.kind !== "tab") return;

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        setDropIndicator(tabsList, "drop-append");
    });

    tabsList.addEventListener("drop", (event) => {
        if (event.target !== tabsList) return;

        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload || payload.kind !== "tab") return;

        event.preventDefault();
        void runDropAction(
            async () => moveTabToUngroupedEnd(windowId, payload.id),
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
) {
    handle.draggable = true;
    handle.classList.add("is-draggable");

    handle.addEventListener("dragstart", (event) => {
        if (!isDragEnabled()) {
            event.preventDefault();
            return;
        }

        writePayload(event, { kind: "tab", id: tabId });
        setDragElement(row);
    });

    handle.addEventListener("dragend", () => {
        clearDragState();
    });

    row.addEventListener("dragover", (event) => {
        const payload = getEnabledPayload(event, isDragEnabled);
        if (!payload) return;
        if (payload.kind !== "tab" || payload.id === tabId) return;

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
        if (payload.kind !== "tab" || payload.id === tabId) return;

        event.preventDefault();
        const position = getDropPosition(event, row);

        void runDropAction(async () => {
            await moveTabRelativeToTab(windowId, payload.id, tabId, position);
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

        if (payload.kind === "tab") {
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
            if (payload.kind === "tab") {
                await moveTabToGroup(windowId, payload.id, groupId);
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
