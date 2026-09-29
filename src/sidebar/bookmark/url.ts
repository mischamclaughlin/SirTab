export function isAllowedBookmarkUrl(rawUrl: string) {
    try {
        const parsedUrl = new URL(rawUrl);
        return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
        return false;
    }
}
