import type { ActionPanelController } from "../types.js";

export function createActionPanelController(
    host: HTMLElement,
): ActionPanelController {
    let activeOwnerId: string | null = null;
    let activeOnClose: (() => void) | null = null;
    let activeTrigger: HTMLButtonElement | null = null;

    function close(ownerId?: string) {
        if (activeOwnerId == null) return false;
        if (ownerId != null && ownerId !== activeOwnerId) return false;

        const onClose = activeOnClose;

        activeOwnerId = null;
        activeOnClose = null;
        activeTrigger = null;
        host.replaceChildren();
        onClose?.();

        return true;
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || activeOwnerId == null) return;

        const trigger = activeTrigger;
        if (!close()) return;

        event.preventDefault();
        trigger?.focus();
    });

    return {
        open(ownerId, content, onClose, trigger) {
            close();
            host.replaceChildren(content);
            activeOwnerId = ownerId;
            activeOnClose = onClose;
            activeTrigger = trigger;
        },
        close,
        isOpen(ownerId) {
            return activeOwnerId === ownerId;
        },
    };
}
