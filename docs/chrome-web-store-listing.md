# Chrome Web Store Listing Draft

Updated: April 10, 2026

This file is a working draft for Sir Tab's Chrome Web Store submission.

## Single Purpose Description

Sir Tab helps you manage tabs, tab groups, and bookmarks from Chrome's side
panel.

## Short Description

Organise tabs, tab groups, and bookmarks in a fast side-panel workflow.

## Detailed Description

Sir Tab brings your tabs, tab groups, and bookmarks into Chrome's side panel so
you can manage browser clutter without constantly switching views.

Use Sir Tab to:

- scan the current window's tabs and groups in one compact sidebar,
- drag and reorder tabs with a quicker overview than Chrome's tab strip,
- move tabs into and out of groups,
- create new tabs, tab groups, bookmarks, and bookmark folders,
- search across tabs and bookmarks from one input,
- collapse groups and bookmark folders to reduce noise,
- switch between visible tabs with keyboard shortcuts,
- and choose from multiple sidebar themes.

Sir Tab is focused on a single purpose: helping you organise and navigate your
browser workspace more efficiently.

## Privacy Practices Summary

Suggested answers for the Chrome Web Store Privacy tab:

- Single purpose: Sir Tab helps users manage tabs, tab groups, and bookmarks
  from Chrome's side panel.
- Remote code: No, Sir Tab does not execute remote code.
- Data collection: Sir Tab accesses tab, tab-group, and bookmark data inside
  Chrome in order to provide its core UI and actions. It stores theme and
  collapse preferences in Chrome local storage. It does not sell or transfer
  this data to third parties.
- Privacy policy URL: host the contents of `docs/privacy-policy.md` at a public
  HTTPS URL before submission.

## Permission Justifications

Use these in the Chrome Web Store Privacy tab.

### `tabs`

Sir Tab uses the `tabs` permission to display the current window's tabs, switch
to a selected tab, create tabs, close tabs, and reorder tabs through the side
panel interface.

### `tabGroups`

Sir Tab uses the `tabGroups` permission to display tab groups, create new
groups, update group titles and colours, and move tabs into or out of groups.

### `storage`

Sir Tab uses the `storage` permission to save extension preferences locally,
including the selected theme and collapsed sidebar sections.

### `sidePanel`

Sir Tab uses the `sidePanel` permission because the extension's main interface
is presented in Chrome's side panel.

### `bookmarks`

Sir Tab uses the `bookmarks` permission to display bookmarks and bookmark
folders, open bookmarks, and let the user create or remove bookmarks and
folders from the side panel.

## Suggested Store Metadata

- Category: Productivity
- Language: English
- Support URL: <https://github.com/mischamclaughlin/SirTab/issues>
- Homepage URL: <https://github.com/mischamclaughlin/SirTab>

## Screenshot Checklist

Still needed before submission:

- At least one `1280x800` screenshot of the side panel in use
- A `440x280` promo tile
- Optional `1400x560` marquee promo tile

## Pre-Submission Checklist

- Verify the extension from `dist/` in Chrome
- Confirm the final icon looks correct at `16x16` and `32x32`
- Host the privacy policy at a public HTTPS URL
- Paste the permission justifications into the Privacy tab
- Upload a ZIP whose root contains `manifest.json`
- Choose `Unlisted` or `Private` first if you want a lower-risk first review
