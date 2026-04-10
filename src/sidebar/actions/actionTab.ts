export async function setupTabAction(
    actionBtnSection: HTMLElement,
): Promise<void> {
    const btnNewTab = document.createElement("button");
    btnNewTab.textContent = "tab +";
    btnNewTab.className = "control";
    actionBtnSection.appendChild(btnNewTab);

    btnNewTab.addEventListener("click", async () => {
        await chrome.tabs.create({
            url: "chrome://newtab",
            active: false,
        });
    });
}
