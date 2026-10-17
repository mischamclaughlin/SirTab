# Chrome Web Store listing draft for Sir Tab

Use this as copy for the Chrome Web Store Developer Dashboard. Check it against the exact package being uploaded and the current dashboard fields before submission.

## Store listing

**Name:** Sir Tab

**Short description:** Organise open tabs, tab groups and bookmarks from a side panel.

**Detailed description:**

Sir Tab puts your open tabs, tab groups and bookmarks in one browser side panel, so you can find and organise them without leaving your current page.

- Search open tabs and bookmarks.
- Switch tabs, reorder them, move tabs into colour-coded groups and close selected tabs.
- Browse bookmark folders, create a bookmark for the current tab or a new folder, and edit or delete bookmarks.
- Hide sections you do not need, collapse groups and folders, and choose a built-in theme.
- Use configurable keyboard shortcuts for tab navigation and movement.

Sir Tab reads tab addresses, titles and group details to show and manage your tabs. It reads bookmark titles and addresses to show and search your bookmarks. Preferences and tab/group ordering data, including hashed tab-address fingerprints used to restore order after a browser restart, are stored locally in the browser. The current extension does not send this data to a developer service.

**Suggested category:** Productivity. Confirm this option exists in the dashboard.

**Homepage:** <https://github.com/mischamclaughlin/SirTab>

**Support:** <https://github.com/mischamclaughlin/SirTab/issues>

**Privacy policy URL:** Publish `docs/privacy-policy.md` at a stable, public URL, then enter that URL in the dashboard. Confirm the public page renders and is accessible without signing in. No URL is asserted here until it is published.

## Privacy practices draft

**Single purpose:** Help users view, search and organise their open tabs, tab groups and bookmarks from a browser side panel.

**Permission justifications:**

| Permission | Why Sir Tab uses it |
| --- | --- |
| `tabs` | Read open-tab titles, addresses, icons, positions and active state for display and search; activate, create, move and close tabs when requested. |
| `tabGroups` | Read group titles, colours and membership; create and update groups when requested. |
| `bookmarks` | Read bookmark and folder titles, addresses and structure for display and search; create, rename and delete bookmarks and folders when requested. |
| `storage` | Save themes, section visibility, collapse state, shortcut prompt state, and tab/group ordering and restart fingerprints in local browser storage. |
| `sidePanel` | Open Sir Tab as a browser side panel from the extension action. |

**Remote code:** No. The reviewed source uses packaged extension code and assets. Recheck the built upload package before selecting this in the dashboard.

**User-data disclosure:** Disclose browsing activity/tab addresses and bookmark data in the dashboard's applicable data categories. The data is processed locally even though it is not sent to a developer server; local processing still requires disclosure. Include that SHA-256 fingerprints of tab addresses are retained for ordering restoration. Do not tick a blanket "does not collect data" option without confirming the dashboard's precise wording and its definition of collection.

**Limited Use certification:** The source reviewed for this draft uses Chrome API data for the extension's stated tab, group and bookmark management purpose and has no advertising, sale or developer-side data transfer. The publisher must confirm this remains true for the uploaded build before certifying the dashboard statements.

## Assets and owner choices before submission

- Use the packaged 128 × 128 icon at `src/sidebar/assets/sir-tab-icon-128.png` as the store icon if it meets the dashboard's image requirements.
- Supply at least one current 1280 × 800 or 640 × 400 screenshot. The README screenshots in `docs/images/*.png` are 880 × 1600 captures of the sidebar with demo data, so they need a properly framed export; do not stretch them. Chrome recommends up to five screenshots that show the actual current interface.
- Review the dashboard's current requirements for any additional promotional images, video, language, distribution, developer identity and contact fields. Choose those values as the publisher; this draft does not invent them.
- Confirm the public privacy-policy URL and ensure the dashboard privacy selections match the published policy and uploaded version.

## Chrome guidance checked for this draft

- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)
- [Listing Requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)
- [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
