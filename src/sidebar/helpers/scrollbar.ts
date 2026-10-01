const SCROLL_AREAS =
    "#sidebar-content, #settings > .action-panel, .setting-info-section";
const SCROLLBAR_HIDE_DELAY_MS = 700;

export function setupAutoHideScrollbars() {
    const hideTimers = new WeakMap<HTMLElement, number>();
    const sidebarContent = document.getElementById("sidebar-content");
    if (sidebarContent) {
        const updateGutter = () => {
            const gutter = sidebarContent.offsetWidth - sidebarContent.clientWidth;
            const value = `${gutter}px`;
            if (sidebarContent.style.getPropertyValue("--sidebar-scrollbar-gutter") !== value) {
                sidebarContent.style.setProperty("--sidebar-scrollbar-gutter", value);
            }
        };
        updateGutter();
        new ResizeObserver(updateGutter).observe(sidebarContent);
        new MutationObserver(updateGutter).observe(sidebarContent, {
            childList: true,
            subtree: true,
        });
        window.addEventListener("resize", updateGutter);
    }

    document.addEventListener("scroll", (event) => {
        const area = event.target;
        if (!(area instanceof HTMLElement) || !area.matches(SCROLL_AREAS)) return;

        const previousTimer = hideTimers.get(area);
        if (previousTimer != null) window.clearTimeout(previousTimer);
        area.classList.add("is-scrolling");
        hideTimers.set(area, window.setTimeout(() => {
            area.classList.remove("is-scrolling");
            hideTimers.delete(area);
        }, SCROLLBAR_HIDE_DELAY_MS));
    }, { capture: true, passive: true });
}
