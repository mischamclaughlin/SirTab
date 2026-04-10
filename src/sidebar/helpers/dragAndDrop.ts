import type { RequestRender } from "../types.js";

type DragPayload =
    | { kind: "tab"; id: number }
    | { kind: "group"; id: number };

type DropPosition = "before" | "after";
type DragEnabledCheck = () => boolean;
type IndexedTab = chrome.tabs.Tab & { id: number; index: number };

const DRAG_DATA_MIME = "application/x-sirtab-drag";
const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

let activeDropIndicator:
    | { element: HTMLElement; className: string }
    | null = null;
let activeDragElement: HTMLElement | null = null;
let activeDragPayload: DragPayload | null = null;

function isIndexedTab(tab: chrome.tabs.Tab): tab is IndexedTab {
    return tab.id != null && tab.index != null;
}

function getTabGroupId(tab: chrome.tabs.Tab) {
    return tab.groupId ?? NO_GROUP_ID;
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

function adjustIndexForSingleMove(sourceIndex: number, rawIndex: number) {
    return sourceIndex < rawIndex ? rawIndex - 1 : rawIndex;
}

function adjustIndexForBlockMove(
    sourceStartIndex: number,
    blockLength: number,
    rawIndex: number,
) {
    return sourceStartIndex < rawIndex ? rawIndex - blockLength : rawIndex;
}

async function getCurrentWindowTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.filter(isIndexedTab).sort((a, b) => a.index - b.index);
}

function getTabsForGroup(tabs: IndexedTab[], groupId: number) {
    return tabs.filter((tab) => getTabGroupId(tab) === groupId);
}

async function maybeUngroupTab(
    tab: IndexedTab,
    exemptGroupId: number = NO_GROUP_ID,
) {
    const groupId = getTabGroupId(tab);
    if (groupId === NO_GROUP_ID || groupId === exemptGroupId) return tab;

    await chrome.tabs.ungroup(tab.id);
    const refreshedTab = await chrome.tabs.get(tab.id);
    if (!isIndexedTab(refreshedTab)) return tab;

    return refreshedTab;
}

async function normaliseTabGroup(tabId: number, targetGroupId: number) {
    const movedTab = await chrome.tabs.get(tabId);
    const currentGroupId = getTabGroupId(movedTab);

    if (targetGroupId === NO_GROUP_ID) {
        if (currentGroupId !== NO_GROUP_ID) {
            await chrome.tabs.ungroup(tabId);
        }
        return;
    }

    if (currentGroupId !== targetGroupId) {
        await chrome.tabs.group({ groupId: targetGroupId, tabIds: [tabId] });
    }
}

async function moveTabRelativeToTab(
    sourceTabId: number,
    targetTabId: number,
    position: DropPosition,
) {
    if (sourceTabId === targetTabId) return;

    const [sourceTabRaw, targetTabRaw] = await Promise.all([
        chrome.tabs.get(sourceTabId),
        chrome.tabs.get(targetTabId),
    ]);
    if (!isIndexedTab(sourceTabRaw) || !isIndexedTab(targetTabRaw)) return;

    const targetGroupId = getTabGroupId(targetTabRaw);
    const sourceTab = await maybeUngroupTab(sourceTabRaw, targetGroupId);
    const rawIndex =
        position === "before" ? targetTabRaw.index : targetTabRaw.index + 1;
    const targetIndex = adjustIndexForSingleMove(sourceTab.index, rawIndex);

    await chrome.tabs.move(sourceTabId, { index: targetIndex });
    await normaliseTabGroup(sourceTabId, targetGroupId);
}

async function moveTabToGroup(sourceTabId: number, targetGroupId: number) {
    const tabs = await getCurrentWindowTabs();
    const sourceTabRaw = tabs.find((tab) => tab.id === sourceTabId);
    const targetGroupTabs = getTabsForGroup(tabs, targetGroupId);
    if (!sourceTabRaw || targetGroupTabs.length === 0) return;

    const sourceTab = await maybeUngroupTab(sourceTabRaw, targetGroupId);
    const rawIndex = targetGroupTabs[targetGroupTabs.length - 1].index + 1;
    const targetIndex = adjustIndexForSingleMove(sourceTab.index, rawIndex);

    await chrome.tabs.move(sourceTabId, { index: targetIndex });
    await normaliseTabGroup(sourceTabId, targetGroupId);
}

async function moveTabToUngroupedEnd(sourceTabId: number) {
    const sourceTabRaw = await chrome.tabs.get(sourceTabId);
    if (!isIndexedTab(sourceTabRaw)) return;

    await maybeUngroupTab(sourceTabRaw);

    const tabs = await getCurrentWindowTabs();
    const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
    if (!sourceTab) return;

    const ungroupedTabs = tabs.filter((tab) => getTabGroupId(tab) === NO_GROUP_ID);
    const rawIndex =
        ungroupedTabs.length === 0
            ? 0
            : ungroupedTabs[ungroupedTabs.length - 1].index + 1;
    const targetIndex = adjustIndexForSingleMove(sourceTab.index, rawIndex);

    await chrome.tabs.move(sourceTabId, { index: targetIndex });
    await normaliseTabGroup(sourceTabId, NO_GROUP_ID);
}

async function moveGroupRelativeToTab(
    sourceGroupId: number,
    targetTabId: number,
    position: DropPosition,
) {
    const tabs = await getCurrentWindowTabs();
    const sourceGroupTabs = getTabsForGroup(tabs, sourceGroupId);
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    if (sourceGroupTabs.length === 0 || !targetTab) return;
    if (getTabGroupId(targetTab) === sourceGroupId) return;

    const sourceTabIds = sourceGroupTabs.map((tab) => tab.id);
    const rawIndex =
        position === "before" ? targetTab.index : targetTab.index + 1;
    const targetIndex = adjustIndexForBlockMove(
        sourceGroupTabs[0].index,
        sourceTabIds.length,
        rawIndex,
    );

    await chrome.tabs.move(sourceTabIds, { index: targetIndex });
}

async function moveGroupRelativeToGroup(
    sourceGroupId: number,
    targetGroupId: number,
    position: DropPosition,
) {
    if (sourceGroupId === targetGroupId) return;

    const tabs = await getCurrentWindowTabs();
    const sourceGroupTabs = getTabsForGroup(tabs, sourceGroupId);
    const targetGroupTabs = getTabsForGroup(tabs, targetGroupId);
    if (sourceGroupTabs.length === 0 || targetGroupTabs.length === 0) return;

    const sourceTabIds = sourceGroupTabs.map((tab) => tab.id);
    const rawIndex =
        position === "before"
            ? targetGroupTabs[0].index
            : targetGroupTabs[targetGroupTabs.length - 1].index + 1;
    const targetIndex = adjustIndexForBlockMove(
        sourceGroupTabs[0].index,
        sourceTabIds.length,
        rawIndex,
    );

    await chrome.tabs.move(sourceTabIds, { index: targetIndex });
}

async function moveGroupToGroupListEnd(sourceGroupId: number) {
    const tabs = await getCurrentWindowTabs();
    const sourceGroupTabs = getTabsForGroup(tabs, sourceGroupId);
    if (sourceGroupTabs.length === 0) return;

    const groupedTabs = tabs.filter((tab) => getTabGroupId(tab) !== NO_GROUP_ID);
    const rawIndex =
        groupedTabs.length === 0
            ? tabs.length
            : groupedTabs[groupedTabs.length - 1].index + 1;
    const targetIndex = adjustIndexForBlockMove(
        sourceGroupTabs[0].index,
        sourceGroupTabs.length,
        rawIndex,
    );

    await chrome.tabs.move(
        sourceGroupTabs.map((tab) => tab.id),
        { index: targetIndex },
    );
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
            async () => moveTabToUngroupedEnd(payload.id),
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
            async () => moveGroupToGroupListEnd(payload.id),
            requestRender,
        );
    });
}

export function makeTabDraggable(
    handle: HTMLElement,
    row: HTMLElement,
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
        if (payload.kind === "tab" && payload.id === tabId) return;

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
        if (payload.kind === "tab" && payload.id === tabId) return;

        event.preventDefault();
        const position = getDropPosition(event, row);

        void runDropAction(async () => {
            if (payload.kind === "tab") {
                await moveTabRelativeToTab(payload.id, tabId, position);
                return;
            }

            await moveGroupRelativeToTab(payload.id, tabId, position);
        }, requestRender);
    });
}

export function makeGroupDraggable(
    handle: HTMLElement,
    row: HTMLElement,
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
                await moveTabToGroup(payload.id, groupId);
                return;
            }

            const position = getDropPosition(event, row);
            await moveGroupRelativeToGroup(payload.id, groupId, position);
        }, requestRender);
    });
}
