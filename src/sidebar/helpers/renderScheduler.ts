import { RenderFn, RequestRender } from "../types.js";

export function createRenderScheduler(render: RenderFn): RequestRender {
    let renderQueued = false;

    return () => {
        if (renderQueued) return;
        renderQueued = true;

        queueMicrotask(() => {
            renderQueued = false;
            void render();
        });
    };
}
