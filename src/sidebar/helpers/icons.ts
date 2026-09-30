type IconName =
    | "group"
    | "bookmark"
    | "plus"
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
    plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z",
    select: "M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm8-2h8v8h-8v-8Zm2 2v4h4v-4h-4Z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z",
    clear: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z",
    confirm: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z",
    addTab: "M3 5h18v14H3V5Zm2 2v10h14V7H5Zm5 2h2v3h3v2h-3v3h-2v-3H7v-2h3V9Z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM5 19v-.92l9.06-9.06.92.92L5.92 19H5ZM18.71 9.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-.9.9 3.75 3.75.9-.9Z",
    settings: "m387.69-100-15.23-121.85q-16.07-5.38-32.96-15.07-16.88-9.7-30.19-20.77L196.46-210l-92.3-160 97.61-73.77q-1.38-8.92-1.96-17.92-.58-9-.58-17.93 0-8.53.58-17.34t1.96-19.27L104.16-590l92.3-159.23 112.46 47.31q14.47-11.46 30.89-20.96t32.27-15.27L387.69-860h184.62l15.23 122.23q18 6.54 32.57 15.27 14.58 8.73 29.43 20.58l114-47.31L855.84-590l-99.15 74.92q2.15 9.69 2.35 18.12.19 8.42.19 16.96 0 8.15-.39 16.58-.38 8.42-2.76 19.27L854.46-370l-92.31 160-112.61-48.08q-14.85 11.85-30.31 20.96-15.46 9.12-31.69 14.89L572.31-100H387.69ZM440-160h78.62L533-267.15q30.62-8 55.96-22.73 25.35-14.74 48.89-37.89L737.23-286l39.39-68-86.77-65.38q5-15.54 6.8-30.47 1.81-14.92 1.81-30.15 0-15.62-1.81-30.15-1.8-14.54-6.8-29.7L777.38-606 738-674l-100.54 42.38q-20.08-21.46-48.11-37.92-28.04-16.46-56.73-23.31L520-800h-79.38l-13.24 106.77q-30.61 7.23-56.53 22.15-25.93 14.93-49.47 38.46L222-674l-39.38 68L269-541.62q-5 14.24-7 29.62t-2 32.38q0 15.62 2 30.62 2 15 6.62 29.62l-86 65.38L222-286l99-42q22.77 23.38 48.69 38.31 25.93 14.92 57.31 22.92L440-160Zm40.46-200q49.92 0 84.96-35.04 35.04-35.04 35.04-84.96 0-49.92-35.04-84.96Q530.38-600 480.46-600q-50.54 0-85.27 35.04T360.46-480q0 49.92 34.73 84.96Q429.92-360 480.46-360ZM480-480Z",
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
