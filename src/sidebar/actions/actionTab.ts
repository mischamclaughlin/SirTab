import { setButtonIcon } from "../helpers/icons.js";

export async function setupTabAction(
    actionBtnSection: HTMLElement,
): Promise<void> {
    const btnNewTab = document.createElement("button");
    btnNewTab.className = "control";
    setButtonIcon(btnNewTab, "tab", "Create tab");
    actionBtnSection.appendChild(btnNewTab);

    btnNewTab.addEventListener("click", async () => {
        await chrome.tabs.create({
            url: "chrome://newtab",
            active: false,
        });
    });
}
