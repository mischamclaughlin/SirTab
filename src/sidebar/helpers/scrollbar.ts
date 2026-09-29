const SCROLL_AREAS =
    "#sidebar-content, #settings > .action-panel, .setting-info-section";
const SCROLLBAR_HIDE_DELAY_MS = 700;

export function setupAutoHideScrollbars() {
    const hideTimers = new WeakMap<HTMLElement, number>();

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
