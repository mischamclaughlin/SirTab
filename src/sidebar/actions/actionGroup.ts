import { createPersistentGroup } from "../../shared/persistentGroups.js";
import type { ActionPanelController } from "../types.js";
import { groupColorMap, GroupColorChoice } from "../config.js";
import { runButtonAction } from "../helpers/domFactory.js";
import { setButtonIcon } from "../helpers/icons.js";

export async function setupGroupAction(
    actionBtnSection: HTMLElement,
    actionPanel: ActionPanelController,
    windowId?: number,
    requestRender: () => void = () => {},
): Promise<void> {
    const btnGroup = document.createElement("button");
    btnGroup.className = "control";
    setButtonIcon(btnGroup, "group", "Create group");
    actionBtnSection.appendChild(btnGroup);

    const closeGroupForm = () => {
        btnGroup.classList.remove("is-selected");
        setButtonIcon(btnGroup, "group", "Create group");
    };

    btnGroup.addEventListener("click", async () => {
        if (actionPanel.isOpen("group")) {
            actionPanel.close("group");
            return;
        }

        btnGroup.classList.add("is-selected");
        setButtonIcon(btnGroup, "group", "Cancel group creation");

        const groupForm = document.createElement("div");
        groupForm.className = "action-form";

        const groupInfoDropdown = document.createElement("div");
        groupInfoDropdown.className = "info-dropdown";
        groupForm.appendChild(groupInfoDropdown);
        actionPanel.open("group", groupForm, closeGroupForm, btnGroup);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.id = "group-name-input";
        textInput.name = "group-name";
        textInput.placeholder = "group name";
        textInput.setAttribute("aria-label", "Group name");
        textInput.className = "control";

        const colourSelect = document.createElement("select");
        colourSelect.id = "group-colour-select";
        colourSelect.name = "group-colour";
        colourSelect.className = "control";
        colourSelect.setAttribute("aria-label", "Group colour");

        const colourChoices = Object.keys(groupColorMap) as GroupColorChoice[];
        for (const choice of colourChoices) {
            const option = document.createElement("option");
            option.value = choice;
            option.textContent = choice;
            colourSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "control";
        setButtonIcon(confirmBtn, "confirm", "Confirm group creation");

        groupInfoDropdown.append(textInput, colourSelect, confirmBtn);
        textInput.focus();

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", () => {
            void runButtonAction(confirmBtn, async () => {
                const targetWindowId = windowId ?? (await chrome.windows.getCurrent()).id;
                if (targetWindowId == null) throw new Error("Current window has no ID");
                await createPersistentGroup(
                    targetWindowId,
                    textInput.value.trim(),
                    groupColorMap[colourSelect.value as GroupColorChoice] ?? "grey",
                );
                requestRender();

                if (groupForm.isConnected) actionPanel.close("group");
            }, "Create group failed:");
        });
    });
}
