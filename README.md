# Reuse Tabs

A Firefox extension that prevents duplicate tabs within the same window. When you navigate to a URL that's already open in another tab in the same window (either by clicking a link or a new tab being opened from another app), the navigation is cancelled (or the new tab is closed) and you're switched to the existing tab instead. Tabs in different windows are independent and won't interfere with each other, which ensures compatibility with browsers like [Zen](https://zen-browser.app/) that sync tabs across windows.


## Features

- **Duplicate tab prevention** — Intercepts navigations and new tabs within the same window, switching to the existing tab instead of creating a duplicate.
- **External app handling** — When an external app opens a URL that's already in a tab, the new tab is closed and the existing one is focused.
- **Exempt duplicates** — Right-click a tab and choose "Duplicate tab (exclude from Reuse Tabs)" to intentionally duplicate it. Exempt tabs are marked with a `[D]` title prefix and ignored by the extension.
- **Reload on switch** — Optionally reload stale tabs when switching to them, with a configurable idle timeout (1 min to 1 hour, or always).
- **In-page toast notifications** — See what the extension is doing with unobtrusive toast messages in the bottom-left corner of the page.
- **Toolbar popup** — Click the extension icon to toggle the extension on/off, enable/disable notifications, and configure reload behavior.

## How it works

1. Maintains a cache of all open tab URLs, kept in sync via tab event listeners.
2. Uses `webRequest.onBeforeRequest` with blocking to intercept navigations before they happen.
3. If the target URL is already open in another tab in the same window, cancels the navigation and switches to that tab.
4. Tracks recently created tabs to catch duplicates opened by external apps and close the blank leftover tab.
5. Exempt tabs are tracked separately and skipped as switch targets, but navigation within them still triggers reuse logic.

## Permissions

- **tabs** — Query, switch between, duplicate, and reload tabs
- **menus** — Add context menu items to the tab strip
- **storage** — Persist extension settings (enabled, notifications, reload options)
- **webRequest / webRequestBlocking** — Intercept and cancel navigations
- **\<all_urls\>** — Required for webRequest to match all URLs and for injecting toast notifications

## Development

### Loading the extension for development

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file

### Running tests

```bash
npm install
npm test
```

Tests use [Jest](https://jestjs.io/) with [jest-webextension-mock](https://github.com/clarkbw/jest-webextension-mock) to mock the `browser.*` API. Tests run automatically on push to `main` and on pull requests via GitHub Actions.

## Disclaimer

This extension was vibe-coded with [Claude Code](https://claude.ai/code). Use at your own risk.

## License

[CC0 1.0](LICENSE) — Public domain.
