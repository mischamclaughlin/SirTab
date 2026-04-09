export function queueRender(
    renderQueued: boolean,
    render: () => Promise<void>,
) {
    if (renderQueued) return;
    renderQueued = true;

    queueMicrotask(() => {
        renderQueued = false;
        void render();
    });
}
