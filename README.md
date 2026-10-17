# Sir Tab

Sir Tab is a Chrome side-panel extension for managing tabs, tab groups, and
bookmarks from one place.

<img src="docs/images/sir-tab-sidebar.png" alt="Sir Tab's current sidebar showing demo tabs, groups and bookmarks" width="440">

## Features

- View, switch, and organise tabs in the current browser window.
- Search tab and bookmark titles and addresses, plus group and folder names.
- Create colour-coded tab groups and drag individual or selected tabs between them.
- Arrange tabs and groups in a saved sidebar order, with restoration across browser restarts.
- Create bookmark folders, bookmark the current tab, and rename or delete bookmarks and folders.
- Select and close multiple tabs, with Shift-click range selection.
- Move between visible tabs and rearrange them with configurable keyboard shortcuts.
- Hide sidebar sections and choose from six built-in colour themes.

Sidebar ordering is saved separately from the browser's native tab-strip order.
Moving tabs between groups also changes their native browser group membership,
which may reposition them in the tab strip. Bookmarks are shown from the
bookmarks bar; Other Bookmarks, Mobile Bookmarks and managed system folders are hidden.

### Search tabs and bookmarks

<img src="docs/images/sir-tab-search.png" alt="The current sidebar filtering demo tabs and bookmarks" width="440">

### Create colour-coded groups

<img src="docs/images/sir-tab-create-group.png" alt="The current sidebar's group creation form with demo data" width="440">

### Organise tabs with drag and drop

<img src="docs/images/sir-tab-organise-tabs.png" alt="The current sidebar arranging demo tabs into groups" width="440">

### Select and edit in batches

<img src="docs/images/sir-tab-batch-edit.png" alt="The current sidebar selecting demo tabs and editing a group" width="440">

### Create bookmarks in folders

<img src="docs/images/sir-tab-create-bookmark.png" alt="The current sidebar's bookmark creation form with demo folders" width="440">

### Shortcuts and themes

<img src="docs/images/sir-tab-settings.png" alt="The current sidebar's keyboard shortcut and theme settings" width="440">

## Installation and usage

Build the extension from source:

```bash
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome 141+ or a compatible Chromium-based browser such as Brave.
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's `dist/` directory.
3. Click Sir Tab's extension icon to open the side panel.
4. Open Sir Tab's settings and choose **set shortcuts** to configure `chrome://extensions/shortcuts`. Tab-reordering shortcuts have no default binding; review the assigned shortcuts for your browser.

The author's preferred setup is Brave with its native vertical tabs hidden.

## Privacy

Sir Tab processes browser data locally and saves preferences and sidebar order
in local extension storage, including URL-derived fingerprints for restoring
order. It has no developer-operated account, analytics or data-upload service.
Displaying browser-supplied favicons may contact their hosts. See the
[privacy policy](docs/privacy-policy.md) for details.

## Development

Watch TypeScript and static files during development:

```bash
npm run watch
```

Reload the unpacked extension after rebuilding to pick up changes.

Run the complete test suite (build, Node tests, browser fixtures and unpacked-extension integration):

```bash
npm test
```

Run only the Node tests:

```bash
npm run test:unit
```

Run all browser interaction fixtures in Chrome or Brave:

```bash
npm run test:browser
```

Set `SIRTAB_TEST_PAGE=tests/refresh-interaction.html` to run one fixture.

Run the real unpacked-extension integration tests:

```bash
npm run test:extension
```

These use native mouse input and real Chrome APIs in a disposable Brave or
Chromium profile. Set `SIRTAB_EXTENSION_BROWSER` to choose an executable that
supports loading unpacked extensions. The suite opens the actual sidebar
extension page; the browser's side-panel shell is not automated.

Generate a combined Node and browser-fixture coverage report, including
production modules that no test loads:

```bash
npm run test:coverage
```

The HTML report is written to `coverage/index.html` and a machine-readable summary
to `coverage/coverage-summary.json`. Coverage maps back to TypeScript. The real
extension suite also runs, but its execution is not included in the coverage
percentage. The coverage command enforces minimums of 95% lines, 85% branches
and 90% functions. Browser fixtures use mocks for failure injection; the unpacked
extension suite separately checks real browser integration.

Regenerate the README screenshots from the built extension's real UI:

```bash
npm run screenshots
```

This requires Brave or Chromium with support for loading unpacked extensions;
use `SIRTAB_BROWSER` to select a different executable. The screenshots show the
current sidebar at 440 × 800, using disposable demo tabs and bookmarks in an
isolated browser profile.

## Release preparation

Build a Chrome Web Store upload archive from the current source:

```bash
npm run package:store
```

The archive is written to `webstore/sir-tab-<version>.zip`. Its contents are
limited to the built extension files and exclude source maps. Review the
[privacy policy](docs/privacy-policy.md) and
[Store listing and disclosure draft](docs/chrome-web-store-listing.md) against
the release before submitting it. The policy must be publicly accessible at
the URL entered in the Chrome Web Store dashboard.

Project status: using and testing before submission to the Chrome Web Store.

## Support

- Repository: <https://github.com/mischamclaughlin/SirTab>
- Issues: <https://github.com/mischamclaughlin/SirTab/issues>
