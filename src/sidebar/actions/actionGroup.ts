import type { ActionPanelController } from "../types.js";
import { groupColorMap, GroupColorChoice } from "../config.js";

export async function setupGroupAction(
    actionBtnSection: HTMLElement,
    actionPanel: ActionPanelController,
): Promise<void> {
    const btnGroup = document.createElement("button");
    btnGroup.textContent = "group +";
    btnGroup.className = "control";
    actionBtnSection.appendChild(btnGroup);

    const closeGroupForm = () => {
        btnGroup.textContent = "group +";
    };

    btnGroup.addEventListener("click", async () => {
        if (actionPanel.isOpen("group")) {
            actionPanel.close("group");
            return;
        }

        btnGroup.textContent = "cancel !";

        const groupForm = document.createElement("div");
        groupForm.className = "action-form";

        const groupInfoDropdown = document.createElement("div");
        groupInfoDropdown.className = "info-dropdown";
        groupForm.appendChild(groupInfoDropdown);
        actionPanel.open("group", groupForm, closeGroupForm);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "group name";
        textInput.className = "control";

        const colourSelect = document.createElement("select");
        colourSelect.className = "control";

        const colourChoices = Object.keys(groupColorMap) as GroupColorChoice[];
        for (const choice of colourChoices) {
            const option = document.createElement("option");
            option.value = choice;
            option.textContent = choice;
            colourSelect.append(option);
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = "confirm";
        confirmBtn.className = "control";

        groupInfoDropdown.append(textInput, colourSelect, confirmBtn);
        textInput.focus();

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", async () => {
            const homeTab = await chrome.tabs.create({
                url: "chrome://newtab",
                active: false,
            });

            if (homeTab?.id == null) {
                actionPanel.close("group");
                return;
            }

            const groupName = textInput.value.trim() || "";
            const selectedColour = colourSelect.value as GroupColorChoice;

            const groupId = await chrome.tabs.group({ tabIds: [homeTab.id] });
            await chrome.tabGroups.update(groupId, {
                title: groupName,
                color: groupColorMap[selectedColour] ?? "grey",
                collapsed: false,
            });

            actionPanel.close("group");
        });
    });
}
