# Sir Tab privacy policy

Last updated: 1 October 2026

Sir Tab is a browser side-panel extension for viewing and organising your open tabs, tab groups and bookmarks. This policy describes the data the extension handles in its current version.

## Data Sir Tab accesses

- **Open tabs and windows:** tab titles, addresses, icons, IDs, positions and group membership. Sir Tab uses these to show and search open tabs, switch between them, and perform the tab and group actions you request.
- **Tab groups:** group titles, colours, IDs and membership. Sir Tab uses these to display, search and organise groups.
- **Bookmarks:** bookmark and folder titles, addresses, IDs and hierarchy. Sir Tab uses these to display and search bookmarks and folders, and to create, rename or delete them when you request it.
- **Settings and organisation data:** Sir Tab saves your theme, hidden sidebar sections, collapsed group and bookmark-folder IDs, dismissed shortcut prompt, and tab and group order in `chrome.storage.local`. To restore order across browser restarts, it also stores tab URL fingerprints made with SHA-256, together with group titles, colours and member fingerprints. These fingerprints are derived from browsing data and are treated as user data; they are not a promise of anonymity.

Search terms and bookmark/folder names entered into Sir Tab are used in the panel or for the action you request. Sir Tab does not save search terms in its own storage. A bookmark or folder you create is saved by the browser in its bookmarks.

## Where the data goes

Sir Tab processes this data in your browser. The current extension contains no developer-operated account, analytics, advertising, telemetry or data-upload service, and its code does not upload your tabs, bookmarks or settings to a developer. Sir Tab does not sell user data or use it for advertising.

When you open a tab or bookmark, the browser may connect to that website as it normally would. Sir Tab also displays favicons using the tab icon addresses supplied by the browser; loading one may cause a request to the icon's host. Those website connections and Chrome's own handling of browser data are outside Sir Tab's control.

## Storage and deletion

The extension's settings and organisation data remain in the browser's local extension storage until removed by the extension, cleared through the browser, or deleted when the extension is uninstalled, subject to the browser's own data handling. Sir Tab may remove obsolete ordering records during migration or when a saved window order is replaced. Tabs, tab groups and bookmarks that you create or change are managed by the browser; uninstalling Sir Tab does not itself undo those changes or delete your bookmarks.

You can edit or delete tabs, groups and bookmarks in the browser. To remove Sir Tab's saved preferences and ordering records, clear the extension's site/storage data using your browser's controls or uninstall the extension. There is currently no Sir Tab account or server-side copy to request from the developer.

## Limited Use

Sir Tab uses information received from Chrome APIs only to provide and maintain its tab, group and bookmark management features. Its use of that information adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements. The extension does not permit the developer or others to read users' browser data through a Sir Tab service.

## Questions and changes

For questions about this policy, use the [Sir Tab issue tracker](https://github.com/mischamclaughlin/SirTab/issues). Do not post private browsing information in a public issue. If Sir Tab's data handling changes, this policy will be updated to describe the new behaviour.
