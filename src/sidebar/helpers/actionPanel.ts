import type { ActionPanelController } from "../types.js";

export function createActionPanelController(
    host: HTMLElement,
): ActionPanelController {
    let activeOwnerId: string | null = null;
    let activeOnClose: (() => void) | null = null;

    function close(ownerId?: string) {
        if (activeOwnerId == null) return false;
        if (ownerId != null && ownerId !== activeOwnerId) return false;

        const onClose = activeOnClose;

        activeOwnerId = null;
        activeOnClose = null;
        host.replaceChildren();
        onClose?.();

        return true;
    }

    return {
        open(ownerId, content, onClose) {
            close();
            host.replaceChildren(content);
            activeOwnerId = ownerId;
            activeOnClose = onClose;
        },
        close,
        isOpen(ownerId) {
            return activeOwnerId === ownerId;
        },
    };
}
