import { setButtonIcon } from "../helpers/icons.js";
import { createNewTab } from "../tab/createTab.js";

export async function setupTabAction(
    actionBtnSection: HTMLElement,
): Promise<void> {
    const btnNewTab = document.createElement("button");
    btnNewTab.className = "control";
    setButtonIcon(btnNewTab, "plus", "Create tab");
    actionBtnSection.appendChild(btnNewTab);

    btnNewTab.addEventListener("click", async () => {
        await createNewTab();
    });
}
