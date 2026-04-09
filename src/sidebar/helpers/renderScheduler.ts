import { RenderFn, RequestRender } from "../types.js";

export function createRenderScheduler(render: RenderFn): RequestRender {
    let requestedRenderVersion = 0;
    let renderQueued = false;
    let renderInFlight = false;

    async function flushRenders() {
        if (renderInFlight) return;
        renderInFlight = true;

        try {
            while (renderQueued) {
                renderQueued = false;
                const renderVersion = requestedRenderVersion;
                await render(() => renderVersion !== requestedRenderVersion);
            }
        } catch (error) {
            console.error("Sidebar render failed:", error);
        } finally {
            renderInFlight = false;

            if (renderQueued) {
                void flushRenders();
            }
        }
    }

    return () => {
        requestedRenderVersion += 1;
        renderQueued = true;
        void flushRenders();
    };
}
