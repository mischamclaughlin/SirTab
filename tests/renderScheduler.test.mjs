import assert from "node:assert/strict";
import test from "node:test";

const { createRenderScheduler } = await import(
    "../dist/sidebar/helpers/renderScheduler.js"
);

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function nextTurn() {
    await new Promise((resolve) => setImmediate(resolve));
}

test("render requests are serialised and an in-flight render becomes stale", async () => {
    const firstRender = deferred();
    const secondRender = deferred();
    const staleChecks = [];
    let activeRenders = 0;
    let maximumActiveRenders = 0;

    const requestRender = createRenderScheduler(async (isStale) => {
        const renderIndex = staleChecks.length;
        staleChecks.push(isStale);
        activeRenders += 1;
        maximumActiveRenders = Math.max(maximumActiveRenders, activeRenders);
        await (renderIndex === 0 ? firstRender.promise : secondRender.promise);
        activeRenders -= 1;
    });

    requestRender();
    requestRender();
    assert.equal(staleChecks.length, 1);
    assert.equal(staleChecks[0](), true);

    firstRender.resolve();
    await nextTurn();
    assert.equal(staleChecks.length, 2);
    assert.equal(staleChecks[1](), false);
    assert.equal(maximumActiveRenders, 1);

    secondRender.resolve();
    await nextTurn();
    assert.equal(activeRenders, 0);
});

test("multiple queued requests coalesce into one follow-up render", async () => {
    const firstRender = deferred();
    let renderCount = 0;

    const requestRender = createRenderScheduler(async () => {
        renderCount += 1;
        if (renderCount === 1) await firstRender.promise;
    });

    requestRender();
    requestRender();
    requestRender();
    requestRender();
    firstRender.resolve();
    await nextTurn();

    assert.equal(renderCount, 2);
});

test("a failed render is reported and does not wedge later renders", async () => {
    const originalConsoleError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);

    try {
        let renderCount = 0;
        const requestRender = createRenderScheduler(async () => {
            renderCount += 1;
            if (renderCount === 1) throw new Error("render failed");
        });

        requestRender();
        await nextTurn();
        requestRender();
        await nextTurn();

        assert.equal(renderCount, 2);
        assert.equal(errors.length, 1);
        assert.equal(errors[0][0], "Sidebar render failed:");
        assert.match(errors[0][1].message, /render failed/);
    } finally {
        console.error = originalConsoleError;
    }
});
