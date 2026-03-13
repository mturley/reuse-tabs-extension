// Cache of open tab URLs: Map<url, Set<tabId>>
const tabsByUrl = new Map();

// Initialize the cache with all currently open tabs
async function initCache() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      addToCache(tab.url, tab.id);
    }
  }
}

function addToCache(url, tabId) {
  if (!tabsByUrl.has(url)) {
    tabsByUrl.set(url, new Set());
  }
  tabsByUrl.get(url).add(tabId);
}

function removeFromCache(url, tabId) {
  const ids = tabsByUrl.get(url);
  if (ids) {
    ids.delete(tabId);
    if (ids.size === 0) {
      tabsByUrl.delete(url);
    }
  }
}

// Keep the cache up to date
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // Remove old URL mapping for this tab
    for (const [url, ids] of tabsByUrl) {
      if (ids.has(tabId)) {
        ids.delete(tabId);
        if (ids.size === 0) {
          tabsByUrl.delete(url);
        }
      }
    }
    // Add new URL mapping
    addToCache(changeInfo.url, tabId);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  for (const [url, ids] of tabsByUrl) {
    if (ids.has(tabId)) {
      ids.delete(tabId);
      if (ids.size === 0) {
        tabsByUrl.delete(url);
      }
    }
  }
});

// Block navigation and switch to existing tab
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type !== "main_frame") return;

    const targetUrl = details.url;
    if (targetUrl.startsWith("about:") || targetUrl.startsWith("moz-extension:")) return;

    const existingTabIds = tabsByUrl.get(targetUrl);
    if (!existingTabIds) return;

    // Find a tab with this URL that isn't the one navigating
    const matchId = [...existingTabIds].find((id) => id !== details.tabId);
    if (matchId === undefined) return;

    // Switch to the existing tab (async, but we don't need to wait)
    browser.tabs.update(matchId, { active: true });
    browser.tabs.get(matchId).then((tab) => {
      browser.windows.update(tab.windowId, { focused: true });
    });

    // Cancel the navigation
    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

initCache();
