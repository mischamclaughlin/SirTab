type IconName =
    | "group"
    | "bookmark"
    | "tab"
    | "select"
    | "delete"
    | "clear"
    | "confirm"
    | "addTab"
    | "edit"
    | "settings";

const ICON_PATHS: Record<IconName, string> = {
    group: "M12 4.53 17.74 9 12 13.47 6.26 9 12 4.53ZM12 2 3 9l9 7 9-7-9-7ZM4.63 12.81 3 14.07 12 21l9-6.93-1.63-1.27L12 18.54l-7.37-5.73Z",
    bookmark:
        "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2ZM7 5h10v13l-5-2.18L7 18V5Z",
    tab: "M3 5h18v14H3V5Zm2 2v10h14V7H5Zm2 2h10v2H7V9Zm0 4h6v2H7v-2Z",
    select: "M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm8-2h8v8h-8v-8Zm2 2v4h4v-4h-4Z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z",
    clear: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
    confirm: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z",
    addTab: "M3 5h18v14H3V5Zm2 2v10h14V7H5Zm5 2h2v3h3v2h-3v3h-2v-3H7v-2h3V9Z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM5 19v-.92l9.06-9.06.92.92L5.92 19H5ZM18.71 9.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-.9.9 3.75 3.75.9-.9Z",
    settings: "m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z",
};

export function setButtonIcon(
    button: HTMLButtonElement,
    iconName: IconName,
    label: string,
) {
    button.replaceChildren(createIcon(iconName));
    button.title = label;
    button.setAttribute("aria-label", label);
}

function createIcon(iconName: IconName) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "control-icon");
    icon.setAttribute("viewBox", iconName === "settings" ? "0 -960 960 960" : "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[iconName]);
    icon.append(path);

    return icon;
}
