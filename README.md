# Reuse Tabs

A Firefox extension that prevents duplicate tabs. When you navigate to a URL that's already open in another tab, the navigation is cancelled and you're switched to the existing tab instead.

Unlike other duplicate-tab-closer extensions that only catch new tabs being opened, Reuse Tabs also handles in-page navigation (clicking links in the current tab).

## How it works

1. Maintains a cache of all open tab URLs, kept in sync via tab event listeners.
2. Uses `webRequest.onBeforeRequest` with blocking to intercept navigations before they happen.
3. If the target URL is already open in another tab, cancels the navigation and switches to that tab.

## Installation

### Temporary (for development)

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file

### Permanent

Sign the extension via [Mozilla's Add-on Developer Hub](https://addons.mozilla.org/developers/) and install the signed `.xpi` file.

## Permissions

- **tabs** — Query and switch between open tabs
- **webRequest / webRequestBlocking** — Intercept and cancel navigations
- **\<all_urls\>** — Required for webRequest to match all URLs
