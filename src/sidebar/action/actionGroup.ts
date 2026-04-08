import { groupColorMap, GroupColorChoice } from "../config.js";
import { resetCreationState } from "../helpers.js";

export async function setupGroupAction(
    actionSection: HTMLElement,
    actionBtnSection: HTMLElement,
): Promise<void> {
    const btnGroup = document.createElement("button");
    btnGroup.textContent = "group +";
    btnGroup.className = "action-btn";
    actionBtnSection.appendChild(btnGroup);

    let creatingGroup = false;

    btnGroup.addEventListener("click", async () => {
        if (creatingGroup) {
            creatingGroup = resetCreationState(actionSection, btnGroup, "tab");
            return;
        }

        const groupInfoDropdown = document.createElement("div");
        groupInfoDropdown.className = "info-dropdown";

        creatingGroup = true;
        btnGroup.textContent = "cancel !";

        actionSection?.appendChild(groupInfoDropdown);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = "group name";
        textInput.className = "group-name-input";

        const colourSelect = document.createElement("select");
        colourSelect.className = "group-colour-select";

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
        confirmBtn.className = "group-confirm-btn";

        groupInfoDropdown.append(textInput, colourSelect, confirmBtn);

        textInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        confirmBtn.addEventListener("click", async () => {
            const homeTab = await chrome.tabs.create({
                url: "chrome://newtab",
                active: false,
            });

            if (homeTab?.id == null) {
                creatingGroup = resetCreationState(
                    actionSection,
                    btnGroup,
                    "tab",
                );
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

            creatingGroup = resetCreationState(actionSection, btnGroup, "tab");
        });
    });
}
