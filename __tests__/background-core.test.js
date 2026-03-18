const {
  tabsByUrl, pendingNewTabs, exemptTabs, tabLastNavigated,
  getState, setState,
  isIgnoredUrl, shortenUrl, addToCache, removeTabFromCache,
  initCache, loadEnabledState, onEnabledChanged, maybeReloadTab,
  ensureTabVisible, switchToTabAndClose, notify,
  findExistingTab,
} = require('../background-core');

// Add mocks for APIs not covered by jest-webextension-mock
beforeEach(() => {
  browser.tabs.show = jest.fn().mockResolvedValue(undefined);
  browser.tabs.executeScript = jest.fn().mockResolvedValue(undefined);
  browser.tabs.reload = jest.fn().mockResolvedValue(undefined);
  browser.tabs.remove = jest.fn().mockResolvedValue(undefined);
  browser.tabs.update = jest.fn().mockResolvedValue(undefined);
  browser.tabs.duplicate = jest.fn().mockResolvedValue({ id: 99 });
  browser.tabs.get = jest.fn().mockResolvedValue({ id: 1, windowId: 1, hidden: false });
  browser.tabs.query = jest.fn().mockResolvedValue([]);
  if (!browser.windows) browser.windows = {};
  browser.windows.update = jest.fn().mockResolvedValue(undefined);
  browser.storage.local.get = jest.fn().mockResolvedValue({});

  // Clear state
  tabsByUrl.clear();
  pendingNewTabs.clear();
  exemptTabs.clear();
  tabLastNavigated.clear();
  setState({ extensionEnabled: true, startupComplete: true, pendingExemptDuplicate: false });
});

describe('isIgnoredUrl', () => {
  test('returns true for null', () => {
    expect(isIgnoredUrl(null)).toBe(true);
  });

  test('returns true for undefined', () => {
    expect(isIgnoredUrl(undefined)).toBe(true);
  });

  test('returns true for empty string', () => {
    expect(isIgnoredUrl('')).toBe(true);
  });

  test('returns true for about: URLs', () => {
    expect(isIgnoredUrl('about:blank')).toBe(true);
    expect(isIgnoredUrl('about:newtab')).toBe(true);
  });

  test('returns true for moz-extension: URLs', () => {
    expect(isIgnoredUrl('moz-extension://abc-123/popup.html')).toBe(true);
  });

  test('returns false for https URLs', () => {
    expect(isIgnoredUrl('https://example.com')).toBe(false);
  });

  test('returns false for http URLs', () => {
    expect(isIgnoredUrl('http://localhost:3000')).toBe(false);
  });
});

describe('shortenUrl', () => {
  test('strips protocol and trailing slash', () => {
    expect(shortenUrl('https://example.com/')).toBe('example.com');
  });

  test('preserves path', () => {
    expect(shortenUrl('https://example.com/path/to/page')).toBe('example.com/path/to/page');
  });

  test('returns invalid URLs unchanged', () => {
    expect(shortenUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('addToCache / removeTabFromCache', () => {
  test('adds a tab to the cache', () => {
    addToCache('https://a.com', 1);
    expect(tabsByUrl.get('https://a.com').has(1)).toBe(true);
  });

  test('accumulates multiple tabs for the same URL', () => {
    addToCache('https://a.com', 1);
    addToCache('https://a.com', 2);
    expect(tabsByUrl.get('https://a.com').size).toBe(2);
  });

  test('sets tabLastNavigated', () => {
    addToCache('https://a.com', 1);
    expect(tabLastNavigated.has(1)).toBe(true);
  });

  test('removeTabFromCache removes tab from all URLs', () => {
    addToCache('https://a.com', 1);
    addToCache('https://b.com', 1);
    removeTabFromCache(1);
    expect(tabsByUrl.has('https://a.com')).toBe(false);
    expect(tabsByUrl.has('https://b.com')).toBe(false);
  });

  test('removeTabFromCache cleans up empty URL entries', () => {
    addToCache('https://a.com', 1);
    removeTabFromCache(1);
    expect(tabsByUrl.has('https://a.com')).toBe(false);
  });

  test('removeTabFromCache preserves other tabs for the same URL', () => {
    addToCache('https://a.com', 1);
    addToCache('https://a.com', 2);
    removeTabFromCache(1);
    expect(tabsByUrl.get('https://a.com').has(2)).toBe(true);
  });

  test('removeTabFromCache is a no-op for unknown tab', () => {
    addToCache('https://a.com', 1);
    removeTabFromCache(999);
    expect(tabsByUrl.get('https://a.com').has(1)).toBe(true);
  });
});

describe('initCache', () => {
  test('populates cache from visible tabs', async () => {
    browser.tabs.query
      .mockResolvedValueOnce([{ id: 1, url: 'https://a.com' }, { id: 2, url: 'https://b.com' }])
      .mockResolvedValueOnce([]);
    await initCache();
    expect(tabsByUrl.get('https://a.com').has(1)).toBe(true);
    expect(tabsByUrl.get('https://b.com').has(2)).toBe(true);
  });

  test('includes hidden tabs (other Zen workspaces)', async () => {
    browser.tabs.query
      .mockResolvedValueOnce([{ id: 1, url: 'https://a.com' }])
      .mockResolvedValueOnce([{ id: 2, url: 'https://b.com' }]);
    await initCache();
    expect(tabsByUrl.get('https://a.com').has(1)).toBe(true);
    expect(tabsByUrl.get('https://b.com').has(2)).toBe(true);
  });

  test('skips tabs without URLs', async () => {
    browser.tabs.query
      .mockResolvedValueOnce([{ id: 1 }, { id: 2, url: 'https://b.com' }])
      .mockResolvedValueOnce([]);
    await initCache();
    expect(tabsByUrl.size).toBe(1);
  });
});

describe('findExistingTab', () => {
  test('finds a matching tab excluding self', () => {
    addToCache('https://a.com', 1);
    addToCache('https://a.com', 2);
    expect(findExistingTab('https://a.com', 2)).toBe(1);
  });

  test('returns undefined when URL is not in cache', () => {
    expect(findExistingTab('https://unknown.com', 1)).toBeUndefined();
  });

  test('returns undefined when only tab is the excluded one', () => {
    addToCache('https://a.com', 1);
    expect(findExistingTab('https://a.com', 1)).toBeUndefined();
  });

  test('skips exempt tabs', () => {
    addToCache('https://a.com', 1);
    addToCache('https://a.com', 2);
    exemptTabs.add(1);
    expect(findExistingTab('https://a.com', 2)).toBeUndefined();
  });

  test('finds non-exempt tab when some are exempt', () => {
    addToCache('https://a.com', 1);
    addToCache('https://a.com', 2);
    addToCache('https://a.com', 3);
    exemptTabs.add(1);
    expect(findExistingTab('https://a.com', 3)).toBe(2);
  });
});

describe('loadEnabledState', () => {
  test('sets extensionEnabled from storage', async () => {
    browser.storage.local.get.mockResolvedValue({ enabled: false });
    await loadEnabledState();
    expect(getState().extensionEnabled).toBe(false);
  });

  test('defaults to true', async () => {
    browser.storage.local.get.mockResolvedValue({});
    await loadEnabledState();
    expect(getState().extensionEnabled).toBe(true);
  });
});

describe('onEnabledChanged', () => {
  test('updates extensionEnabled when changes include enabled', () => {
    onEnabledChanged({ enabled: { newValue: false } });
    expect(getState().extensionEnabled).toBe(false);
  });

  test('ignores changes without enabled', () => {
    setState({ extensionEnabled: true });
    onEnabledChanged({ notifications: { newValue: false } });
    expect(getState().extensionEnabled).toBe(true);
  });
});

describe('maybeReloadTab', () => {
  test('returns false when reloadOnSwitch is false', async () => {
    browser.storage.local.get.mockResolvedValue({ reloadOnSwitch: false });
    const result = await maybeReloadTab(1);
    expect(result).toBe(false);
    expect(browser.tabs.reload).not.toHaveBeenCalled();
  });

  test('returns false when tab is fresh (within TTL)', async () => {
    browser.storage.local.get.mockResolvedValue({ reloadOnSwitch: true, reloadTtlMinutes: 5 });
    tabLastNavigated.set(1, Date.now()); // just navigated
    const result = await maybeReloadTab(1);
    expect(result).toBe(false);
    expect(browser.tabs.reload).not.toHaveBeenCalled();
  });

  test('reloads when tab is stale (past TTL)', async () => {
    browser.storage.local.get.mockResolvedValue({ reloadOnSwitch: true, reloadTtlMinutes: 5 });
    tabLastNavigated.set(1, Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const result = await maybeReloadTab(1);
    expect(result).toBe(true);
    expect(browser.tabs.reload).toHaveBeenCalledWith(1);
  });

  test('always reloads when TTL is 0', async () => {
    browser.storage.local.get.mockResolvedValue({ reloadOnSwitch: true, reloadTtlMinutes: 0 });
    tabLastNavigated.set(1, Date.now()); // just navigated, but TTL disabled
    const result = await maybeReloadTab(1);
    expect(result).toBe(true);
    expect(browser.tabs.reload).toHaveBeenCalledWith(1);
  });
});

describe('ensureTabVisible', () => {
  test('calls browser.tabs.show when tab is hidden', async () => {
    browser.tabs.get.mockResolvedValue({ id: 1, hidden: true });
    await ensureTabVisible(1);
    expect(browser.tabs.show).toHaveBeenCalledWith(1);
  });

  test('does not call browser.tabs.show when tab is visible', async () => {
    browser.tabs.get.mockResolvedValue({ id: 1, hidden: false });
    await ensureTabVisible(1);
    expect(browser.tabs.show).not.toHaveBeenCalled();
  });
});

describe('switchToTabAndClose', () => {
  beforeEach(() => {
    browser.tabs.get.mockResolvedValue({ id: 1, windowId: 10, hidden: false });
    browser.storage.local.get.mockResolvedValue({ reloadOnSwitch: false, notifications: false });
  });

  test('ensures tab is visible, activates, focuses window, and closes duplicate', async () => {
    await switchToTabAndClose(1, 2, 'https://example.com');

    expect(browser.tabs.get).toHaveBeenCalledWith(1);
    expect(browser.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(browser.windows.update).toHaveBeenCalledWith(10, { focused: true });
    expect(browser.tabs.remove).toHaveBeenCalledWith(2);
  });

  test('shows hidden tab before activating', async () => {
    browser.tabs.get.mockResolvedValue({ id: 1, windowId: 10, hidden: true });
    await switchToTabAndClose(1, 2, 'https://example.com');

    expect(browser.tabs.show).toHaveBeenCalledWith(1);
    expect(browser.tabs.update).toHaveBeenCalledWith(1, { active: true });
  });
});

describe('notify', () => {
  test('skips when notifications setting is false', async () => {
    browser.storage.local.get.mockResolvedValue({ notifications: false });
    await notify('test message', 1);
    expect(browser.tabs.executeScript).not.toHaveBeenCalled();
  });

  test('calls executeScript when notifications enabled', async () => {
    browser.storage.local.get.mockResolvedValue({ notifications: true });
    await notify('test message', 1);
    expect(browser.tabs.executeScript).toHaveBeenCalledWith(1, expect.any(Object));
  });

  test('queries for active tab when no tabId provided', async () => {
    browser.storage.local.get.mockResolvedValue({ notifications: true });
    browser.tabs.query.mockResolvedValue([{ id: 5 }]);
    await notify('test message');
    expect(browser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(browser.tabs.executeScript).toHaveBeenCalledWith(5, expect.any(Object));
  });
});

describe('getState / setState', () => {
  test('getState returns current primitive state', () => {
    setState({ extensionEnabled: false, startupComplete: false, pendingExemptDuplicate: true });
    const state = getState();
    expect(state.extensionEnabled).toBe(false);
    expect(state.startupComplete).toBe(false);
    expect(state.pendingExemptDuplicate).toBe(true);
  });

  test('setState only updates specified fields', () => {
    setState({ extensionEnabled: true, startupComplete: true, pendingExemptDuplicate: false });
    setState({ extensionEnabled: false });
    const state = getState();
    expect(state.extensionEnabled).toBe(false);
    expect(state.startupComplete).toBe(true);
    expect(state.pendingExemptDuplicate).toBe(false);
  });
});
