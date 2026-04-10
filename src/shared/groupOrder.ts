const NO_GROUP_ID = chrome.tabGroups.TAB_GROUP_ID_NONE;

export function sortTabsByIndex<T extends Pick<chrome.tabs.Tab, "index">>(
    tabs: T[],
) {
    return [...tabs].sort((left, right) => {
        const leftIndex = left.index ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = right.index ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}

export function orderGroupsByTabPosition(
    groups: chrome.tabGroups.TabGroup[],
    tabs: chrome.tabs.Tab[],
) {
    const firstTabIndexByGroup = new Map<number, number>();

    for (const tab of tabs) {
        const groupId = tab.groupId;
        const tabIndex = tab.index;
        if (groupId == null || tabIndex == null || groupId === NO_GROUP_ID) {
            continue;
        }

        const currentFirstIndex = firstTabIndexByGroup.get(groupId);
        if (currentFirstIndex == null || tabIndex < currentFirstIndex) {
            firstTabIndexByGroup.set(groupId, tabIndex);
        }
    }

    return [...groups].sort((left, right) => {
        const leftId = left.id;
        const rightId = right.id;
        const leftIndex =
            leftId == null ? undefined : firstTabIndexByGroup.get(leftId);
        const rightIndex =
            rightId == null ? undefined : firstTabIndexByGroup.get(rightId);

        if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) {
            return leftIndex - rightIndex;
        }

        if (leftIndex != null) return -1;
        if (rightIndex != null) return 1;

        if (leftId == null && rightId == null) return 0;
        if (leftId == null) return 1;
        if (rightId == null) return -1;

        return leftId - rightId;
    });
}
