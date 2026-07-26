import assert from "node:assert/strict";
import test from "node:test";

const { createTabSelectionController } = await import(
    "../dist/sidebar/helpers/tabSelection.js"
);

function createController() {
    let renderCount = 0;
    const controller = createTabSelectionController(() => {
        renderCount += 1;
    });

    return {
        controller,
        getRenderCount: () => renderCount,
    };
}

test("selection mode changes render only when state changes", () => {
    const { controller, getRenderCount } = createController();

    assert.equal(controller.isSelectionMode(), false);
    controller.setSelectionMode(false);
    assert.equal(getRenderCount(), 0);

    controller.setSelectionMode(true);
    controller.setSelectionMode(true);
    assert.equal(controller.isSelectionMode(), true);
    assert.equal(getRenderCount(), 1);

    controller.selectTab(7);
    controller.setSelectionMode(false);
    assert.deepEqual(controller.getSelectedTabIds(), []);
    assert.equal(getRenderCount(), 3);
});

test("toggleTab enters selection mode and selected tabs drag together", () => {
    const { controller } = createController();

    controller.toggleTab(2);
    controller.toggleTab(4);

    assert.equal(controller.isSelectionMode(), true);
    assert.deepEqual(controller.getSelectedTabIds(), [2, 4]);
    assert.deepEqual(controller.getDragTabIds(2), [2, 4]);
    assert.deepEqual(controller.getDragTabIds(9), [9]);

    controller.toggleTab(2);
    controller.toggleTab(4);
    assert.deepEqual(controller.getSelectedTabIds(), []);
    assert.equal(controller.isSelectionMode(), true);
});

test("range selection works forwards and backwards from the latest anchor", () => {
    const { controller } = createController();
    const visibleIds = [1, 2, 3, 4, 5];

    controller.selectTab(2);
    controller.selectRange(visibleIds, 5);
    assert.deepEqual(controller.getSelectedTabIds(), [2, 3, 4, 5]);

    controller.clearSelected();
    controller.selectTab(4);
    controller.selectRange(visibleIds, 1);
    assert.deepEqual(controller.getSelectedTabIds(), [4, 1, 2, 3]);

    const before = controller.getSelectedTabIds();
    controller.selectRange(visibleIds, 99);
    assert.deepEqual(controller.getSelectedTabIds(), before);
});

test("prune removes closed tabs and clear resets all selection state", () => {
    const { controller, getRenderCount } = createController();

    controller.selectTab(1);
    controller.toggleTab(2);
    controller.toggleTab(3);
    const renderCountBeforePrune = getRenderCount();

    controller.prune([2, 3, 4]);
    assert.deepEqual(controller.getSelectedTabIds(), [2, 3]);
    assert.equal(getRenderCount(), renderCountBeforePrune + 1);

    controller.prune([2, 3, 4]);
    assert.equal(getRenderCount(), renderCountBeforePrune + 1);

    controller.clear();
    assert.equal(controller.isSelectionMode(), false);
    assert.deepEqual(controller.getSelectedTabIds(), []);
});
