type ListReplacement = {
    host: HTMLElement;
    next: HTMLElement;
};

type ItemIdentity = {
    kind: "tabId" | "groupId" | "bookmarkId";
    id: string;
};

type EditSnapshot = {
    item: ItemIdentity;
    values: string[];
    session: string;
    saving: boolean;
};

type FocusSnapshot = {
    item: ItemIdentity;
    controlIndex: number;
    selectionStart: number | null;
    selectionEnd: number | null;
};

const FOCUSABLE = "button, input, select, textarea, [tabindex]";
const ITEM_SELECTOR = "li[data-tab-id], li[data-group-id], li[data-bookmark-id]";
let nextEditSession = 0;

export function createEditSession(form: HTMLElement) {
    form.dataset.editSession = String(++nextEditSession);
}

/** Finish the form currently representing this edit, even if a refresh replaced it. */
export function finishEditSession(
    originalForm: HTMLElement,
    saved: boolean,
    closeOriginal: () => void,
) {
    const session = originalForm.dataset.editSession;
    const liveForm = Array.from(
        document.querySelectorAll<HTMLElement>("[data-edit-session]"),
    ).find((form) => form.dataset.editSession === session);

    if (saved) {
        if (liveForm && liveForm !== originalForm) {
            liveForm.querySelector<HTMLButtonElement>("[data-edit-cancel]")?.click();
        } else {
            closeOriginal();
        }
        return;
    }

    const liveSave = liveForm?.querySelector<HTMLButtonElement>("[data-edit-save]");
    if (liveSave) {
        liveSave.disabled = false;
        liveSave.removeAttribute("aria-busy");
    }
}

function identityOf(item: HTMLElement): ItemIdentity | null {
    for (const kind of ["tabId", "groupId", "bookmarkId"] as const) {
        const id = item.dataset[kind];
        if (id != null) return { kind, id };
    }
    return null;
}

function findItem(hosts: HTMLElement[], identity: ItemIdentity) {
    for (const host of hosts) {
        for (const item of host.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
            if (item.dataset[identity.kind] === identity.id) return item;
        }
    }
    return null;
}

function captureFocus(hosts: HTMLElement[]): FocusSnapshot | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !hosts.some((host) => host.contains(active))) {
        return null;
    }

    const item = active.closest<HTMLElement>(ITEM_SELECTOR);
    const identity = item && identityOf(item);
    if (!item || !identity) return null;

    const controlIndex = Array.from(item.querySelectorAll(FOCUSABLE)).indexOf(active);
    if (controlIndex < 0) return null;

    const isTextInput = active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement;
    return {
        item: identity,
        controlIndex,
        selectionStart: isTextInput ? active.selectionStart : null,
        selectionEnd: isTextInput ? active.selectionEnd : null,
    };
}

function captureEdits(hosts: HTMLElement[]): EditSnapshot[] {
    const edits: EditSnapshot[] = [];
    for (const host of hosts) {
        for (const form of host.querySelectorAll<HTMLElement>(
            ".group-edit-form, .bookmark-edit-form",
        )) {
            const item = form.closest<HTMLElement>(ITEM_SELECTOR);
            const identity = item && identityOf(item);
            if (!identity) continue;
            edits.push({
                item: identity,
                session: form.dataset.editSession ?? "",
                saving: form.querySelector<HTMLButtonElement>(
                    "[data-edit-save]",
                )?.disabled ?? false,
                values: Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
                    "input, select",
                )).map((control) => control.value),
            });
        }
    }
    return edits;
}

/** Replace freshly built rows without discarding an active control or edit draft. */
export function replaceListsPreservingInteraction(replacements: ListReplacement[]) {
    const hosts = replacements.map(({ host }) => host);
    const focus = captureFocus(hosts);
    const edits = captureEdits(hosts);

    for (const { host, next } of replacements) {
        host.replaceChildren(...Array.from(next.children));
    }

    for (const edit of edits) {
        const item = findItem(hosts, edit.item);
        const row = item?.firstElementChild;
        const editButton = row?.querySelector<HTMLButtonElement>(".row-icon-btn");
        if (!editButton) continue;

        // The usual click focuses a new form on the next frame. A restored form
        // must leave the user's current focus where it was.
        editButton.dataset.restoringEdit = "true";
        editButton.click();
        delete editButton.dataset.restoringEdit;

        const form = item?.querySelector<HTMLElement>(
            ".group-edit-form, .bookmark-edit-form",
        );
        if (form) form.dataset.editSession = edit.session;
        const controls = form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            "input, select",
        );
        controls?.forEach((control, index) => {
            if (edit.values[index] != null) control.value = edit.values[index];
        });
        if (edit.saving) {
            const save = form?.querySelector<HTMLButtonElement>("[data-edit-save]");
            if (save) {
                save.disabled = true;
                save.setAttribute("aria-busy", "true");
            }
        }
    }

    if (!focus) return;
    const item = findItem(hosts, focus.item);
    const control = item?.querySelectorAll<HTMLElement>(FOCUSABLE)[focus.controlIndex];
    if (!control) return;
    control.focus();
    if (
        (control instanceof HTMLInputElement ||
            control instanceof HTMLTextAreaElement) &&
        focus.selectionStart != null &&
        focus.selectionEnd != null
    ) {
        control.setSelectionRange(focus.selectionStart, focus.selectionEnd);
    }
}
