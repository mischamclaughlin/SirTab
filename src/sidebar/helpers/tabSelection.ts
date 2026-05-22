import type { RequestRender } from "../types.js";

export type TabSelectionController = {
    isSelectionMode: () => boolean;
    setSelectionMode: (isSelectionMode: boolean) => void;
    toggleSelectionMode: () => boolean;
    getSelectedTabIds: () => number[];
    isSelected: (tabId: number) => boolean;
    selectTab: (tabId: number) => void;
    toggleTab: (tabId: number) => void;
    clearSelected: () => void;
    clear: () => void;
    prune: (liveTabIds: Iterable<number>) => void;
    selectRange: (visibleTabIds: number[], targetTabId: number) => void;
    getDragTabIds: (tabId: number) => number[];
};

export function createTabSelectionController(
    requestRender: RequestRender,
): TabSelectionController {
    const selectedTabIds = new Set<number>();
    let isSelectionMode = false;
    let anchorTabId: number | null = null;

    function render() {
        requestRender();
    }

    function clearSelection() {
        selectedTabIds.clear();
        anchorTabId = null;
    }

    return {
        isSelectionMode() {
            return isSelectionMode;
        },
        setSelectionMode(nextSelectionMode) {
            if (isSelectionMode === nextSelectionMode) return;

            isSelectionMode = nextSelectionMode;
            if (!isSelectionMode) clearSelection();
            render();
        },
        toggleSelectionMode() {
            isSelectionMode = !isSelectionMode;
            if (!isSelectionMode) clearSelection();
            render();
            return isSelectionMode;
        },
        getSelectedTabIds() {
            return Array.from(selectedTabIds);
        },
        isSelected(tabId) {
            return selectedTabIds.has(tabId);
        },
        selectTab(tabId) {
            selectedTabIds.add(tabId);
            anchorTabId = tabId;
            render();
        },
        toggleTab(tabId) {
            if (selectedTabIds.has(tabId)) {
                selectedTabIds.delete(tabId);
            } else {
                selectedTabIds.add(tabId);
            }

            anchorTabId = tabId;
            if (selectedTabIds.size === 0) {
                anchorTabId = null;
            } else {
                isSelectionMode = true;
            }
            render();
        },
        clearSelected() {
            if (selectedTabIds.size === 0) return;

            clearSelection();
            isSelectionMode = true;
            render();
        },
        clear() {
            if (!isSelectionMode && selectedTabIds.size === 0) return;

            isSelectionMode = false;
            clearSelection();
            render();
        },
        prune(liveTabIds) {
            const liveIds = new Set(liveTabIds);
            let changed = false;

            for (const tabId of selectedTabIds) {
                if (liveIds.has(tabId)) continue;

                selectedTabIds.delete(tabId);
                changed = true;
            }

            if (anchorTabId != null && !liveIds.has(anchorTabId)) {
                anchorTabId = null;
                changed = true;
            }
            if (changed) render();
        },
        selectRange(visibleTabIds, targetTabId) {
            const targetIndex = visibleTabIds.indexOf(targetTabId);
            if (targetIndex === -1) return;

            const anchorIndex =
                anchorTabId == null ? -1 : visibleTabIds.indexOf(anchorTabId);
            const startIndex = anchorIndex === -1 ? targetIndex : anchorIndex;
            const [from, to] =
                startIndex < targetIndex
                    ? [startIndex, targetIndex]
                    : [targetIndex, startIndex];

            for (const tabId of visibleTabIds.slice(from, to + 1)) {
                selectedTabIds.add(tabId);
            }

            anchorTabId = targetTabId;
            isSelectionMode = true;
            render();
        },
        getDragTabIds(tabId) {
            if (selectedTabIds.has(tabId)) {
                return Array.from(selectedTabIds);
            }

            return [tabId];
        },
    };
}
