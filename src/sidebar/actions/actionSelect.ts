import type { ActionPanelController, RequestRender } from "../types.js";
import type { TabSelectionController } from "../helpers/tabSelection.js";
import { setButtonIcon } from "../helpers/icons.js";
import { runButtonAction } from "../helpers/domFactory.js";

export function setupSelectAction(
    actionBtnSection: HTMLElement,
    actionPanel: ActionPanelController,
    tabSelection: TabSelectionController,
    requestTabGroupRefresh: RequestRender,
) {
    const btnSelect = document.createElement("button");
    btnSelect.type = "button";
    btnSelect.className = "control";
    setButtonIcon(btnSelect, "select", "Select tabs");
    actionBtnSection.appendChild(btnSelect);

    const selectPanel = document.createElement("div");
    selectPanel.className = "selection-actions";
    let isClosingSelectPanel = false;

    const closeSelectPanel = () => {
        if (!actionPanel.isOpen("select")) return;

        isClosingSelectPanel = true;
        actionPanel.close("select");
        isClosingSelectPanel = false;
    };

    const handleSelectPanelClosed = () => {
        if (isClosingSelectPanel || !tabSelection.isSelectionMode()) return;
        tabSelection.clear();
    };

    function renderSelectPanel(count: number, isSelecting: boolean) {
        if (!isSelecting) {
            closeSelectPanel();
            return;
        }

        const summary = document.createElement("span");
        summary.className = "selection-summary";
        summary.textContent = `${count} selected`;

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "control selection-delete";
        setButtonIcon(deleteBtn, "delete", "Close selected tabs");
        deleteBtn.disabled = count === 0;

        deleteBtn.addEventListener("click", () => {
            void runButtonAction(deleteBtn, async () => {
                const selectedTabIds = tabSelection.getSelectedTabIds();
                if (selectedTabIds.length === 0) return;

                if (selectedTabIds.length > 1) {
                    const confirmed = window.confirm(
                        `Close ${selectedTabIds.length} selected tabs?`,
                    );
                    if (!confirmed) return;
                }

                await chrome.tabs.remove(selectedTabIds);
                tabSelection.clear();
                requestTabGroupRefresh();
                closeSelectPanel();
            }, "Close selected tabs failed:");
        });

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "control";
        setButtonIcon(clearBtn, "clear", "Clear selected tabs");
        clearBtn.disabled = count === 0;
        clearBtn.addEventListener("click", () => {
            tabSelection.clearSelected();
        });

        selectPanel.replaceChildren(summary, deleteBtn, clearBtn);
        if (!actionPanel.isOpen("select")) {
            actionPanel.open("select", selectPanel, handleSelectPanelClosed);
        }
    }

    function update() {
        const count = tabSelection.getSelectedTabIds().length;
        const isSelecting = tabSelection.isSelectionMode() || count > 0;
        setButtonIcon(
            btnSelect,
            "select",
            isSelecting
                ? `Finish selecting ${count} tab${count === 1 ? "" : "s"}`
                : "Select tabs. Shift-click a tab to select a range.",
        );
        btnSelect.classList.toggle(
            "is-selected",
            isSelecting,
        );
        renderSelectPanel(count, isSelecting);
    }

    btnSelect.addEventListener("click", () => {
        tabSelection.toggleSelectionMode();
        update();
    });

    update();
    return update;
}
