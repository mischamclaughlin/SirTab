import assert from "node:assert/strict";
import test from "node:test";

globalThis.chrome = {
    runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
    },
};

const {
    collectBookmarkFolderChoices,
    filterBookmarkNodes,
    isAllowedBookmarkUrl,
    removeNodeFromCollapsed,
} = await import("../dist/sidebar/bookmark/bookmark.js");

test("bookmark URL validation permits web pages and rejects privileged schemes", () => {
    assert.equal(isAllowedBookmarkUrl("https://example.com/path"), true);
    assert.equal(isAllowedBookmarkUrl("http://localhost:3000"), true);
    assert.equal(isAllowedBookmarkUrl("chrome://settings"), false);
    assert.equal(isAllowedBookmarkUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedBookmarkUrl("file:///tmp/private.txt"), false);
    assert.equal(isAllowedBookmarkUrl("not a URL"), false);
});

test("folder choices flatten the tree and omit hidden Chrome folders", () => {
    const tree = [
        {
            id: "0",
            title: "",
            children: [
                {
                    id: "1",
                    title: "Bookmarks bar",
                    folderType: "bookmarks-bar",
                    children: [
                        {
                            id: "work",
                            title: "Work",
                            children: [{ id: "project", title: "Project" }],
                        },
                        {
                            id: "page",
                            title: "Page",
                            url: "https://example.com",
                        },
                    ],
                },
                {
                    id: "2",
                    title: "Other bookmarks",
                    folderType: "other",
                    children: [{ id: "hidden", title: "Hidden" }],
                },
                {
                    id: "managed",
                    title: "Managed",
                    unmodifiable: "managed",
                },
            ],
        },
    ];

    assert.deepEqual(collectBookmarkFolderChoices(tree), [
        { id: "1", label: "Bookmarks bar" },
        { id: "work", label: "  - Work" },
        { id: "project", label: "    - Project" },
    ]);
});

test("bookmark filtering retains ancestors and only matching descendants", () => {
    const tree = [
        {
            id: "root",
            title: "Work",
            children: [
                {
                    id: "cloudflare",
                    title: "Cloudflare dashboard",
                    url: "https://dash.cloudflare.com",
                },
                {
                    id: "docs",
                    title: "Reference",
                    url: "https://developer.mozilla.org",
                },
            ],
        },
        {
            id: "personal",
            title: "Personal",
            children: [],
        },
    ];

    assert.deepEqual(filterBookmarkNodes(tree, "cloudflare"), [
        {
            id: "root",
            title: "Work",
            children: [
                {
                    id: "cloudflare",
                    title: "Cloudflare dashboard",
                    url: "https://dash.cloudflare.com",
                    children: undefined,
                },
            ],
        },
    ]);
    assert.strictEqual(filterBookmarkNodes(tree, ""), tree);
});

test("bookmark filtering expands a folder-name match with all descendants", () => {
    const tree = [
        {
            id: "work",
            title: "Work",
            children: [
                {
                    id: "cloudflare",
                    title: "Cloudflare dashboard",
                    url: "https://dash.cloudflare.com",
                },
                {
                    id: "reference",
                    title: "Reference",
                    children: [
                        {
                            id: "docs",
                            title: "MDN",
                            url: "https://developer.mozilla.org",
                        },
                    ],
                },
            ],
        },
    ];

    assert.deepEqual(filterBookmarkNodes(tree, "work"), tree);
});

test("removing a folder clears its entire subtree from collapse state", () => {
    const collapsed = new Set(["folder", "nested", "leaf-folder", "other"]);
    const folder = {
        id: "folder",
        title: "Folder",
        children: [
            {
                id: "nested",
                title: "Nested",
                children: [
                    { id: "leaf-folder", title: "Leaf folder" },
                    {
                        id: "bookmark",
                        title: "Page",
                        url: "https://example.com",
                    },
                ],
            },
        ],
    };

    removeNodeFromCollapsed(folder, collapsed);

    assert.deepEqual([...collapsed], ["other"]);
});
