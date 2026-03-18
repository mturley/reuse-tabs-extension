// Cache of open tab URLs: Map<url, Set<tabId>>
const tabsByUrl = new Map();

// Track recently created tabs so we can catch duplicates opened by external apps
const pendingNewTabs = new Set();

// Track tab IDs that are exempt from reuse logic (intentional duplicates)
const exemptTabs = new Set();

// Flag: when set, the next tab created by browser.tabs.duplicate() should be exempt
let pendingExemptDuplicate = false;

// Grace period flag: skip duplicate detection during session restore
let startupComplete = false;

// Track when each tab last had a navigation (timestamp in ms)
const tabLastNavigated = new Map();

// Cached enabled state (must be synchronous for webRequest)
let extensionEnabled = true;

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
  tabLastNavigated.set(tabId, Date.now());
}

function removeTabFromCache(tabId) {
  for (const [url, ids] of tabsByUrl) {
    if (ids.has(tabId)) {
      ids.delete(tabId);
      if (ids.size === 0) {
        tabsByUrl.delete(url);
      }
    }
  }
}

function isIgnoredUrl(url) {
  return !url || url.startsWith("about:") || url.startsWith("moz-extension:");
}

async function loadEnabledState() {
  const { enabled = true } = await browser.storage.local.get("enabled");
  extensionEnabled = enabled;
}

function onEnabledChanged(changes) {
  if (changes.enabled) {
    extensionEnabled = changes.enabled.newValue;
  }
}

async function notify(message, tabId) {
  const { notifications = true } = await browser.storage.local.get("notifications");
  if (!notifications) return;
  // Show toast in the target tab (the one we switched to)
  const targetTabId = tabId || (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (!targetTabId) return;
  browser.tabs.executeScript(targetTabId, {
    code: `(function() {
      const el = document.createElement("div");
      el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" style="width:20px;height:20px;flex-shrink:0;"><rect x="0" y="4" width="10" height="8" rx="1.5" fill="#4a86d4"/><rect x="0" y="2" width="5" height="3" rx="1" fill="#4a86d4"/><rect x="4" y="7" width="10" height="8" rx="1.5" fill="#8ab4f8"/><rect x="4" y="5" width="5" height="3" rx="1" fill="#8ab4f8"/><path d="M12.5 2 C14.5 2,15.5 4.5,14 6.5" stroke="#8ab4f8" stroke-width="1.5" fill="none" stroke-linecap="round"/><polygon points="12.5,7.5 15.5,7.5 14,5" fill="#8ab4f8"/></svg>' + '<span>' + ${JSON.stringify(message)} + '</span>';
      el.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#323232;color:#fff;padding:12px 20px;border-radius:8px;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;max-width:400px;display:flex;align-items:center;gap:10px;";
      document.body.appendChild(el);
      requestAnimationFrame(() => el.style.opacity = "1");
      setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
    })();`,
  }).catch(() => {});
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return u.hostname + path;
  } catch {
    return url;
  }
}

async function maybeReloadTab(tabId) {
  const { reloadOnSwitch = false, reloadTtlMinutes = 5 } = await browser.storage.local.get([
    "reloadOnSwitch",
    "reloadTtlMinutes",
  ]);
  if (!reloadOnSwitch) return false;
  if (reloadTtlMinutes > 0) {
    const lastNav = tabLastNavigated.get(tabId);
    if (lastNav && (Date.now() - lastNav) < reloadTtlMinutes * 60 * 1000) return false;
  }
  await browser.tabs.reload(tabId);
  return true;
}

async function ensureTabVisible(tabId) {
  const tab = await browser.tabs.get(tabId);
  if (tab.hidden) {
    await browser.tabs.show(tabId);
  }
}

async function switchToTabAndClose(existingTabId, tabIdToClose, url) {
  await ensureTabVisible(existingTabId);
  await browser.tabs.update(existingTabId, { active: true });
  const existingTab = await browser.tabs.get(existingTabId);
  await browser.windows.update(existingTab.windowId, { focused: true });
  await browser.tabs.remove(tabIdToClose);
  const reloaded = await maybeReloadTab(existingTabId);
  const action = reloaded ? "Closed duplicate tab, switched to and reloaded" : "Closed duplicate tab and switched to existing tab:";
  notify(`${action} ${shortenUrl(url)}`, existingTabId);
}

function applyExemptTitlePrefix(tabId) {
  browser.tabs.executeScript(tabId, {
    code: `if (!document.title.startsWith("[D] ")) { document.title = "[D] " + document.title; }`,
  });
}

// Find an existing tab with the given URL, excluding excludeTabId and exempt tabs
function findExistingTab(url, excludeTabId) {
  const existingTabIds = tabsByUrl.get(url);
  if (!existingTabIds) return undefined;
  return [...existingTabIds].find(
    (id) => id !== excludeTabId && !exemptTabs.has(id)
  );
}

// Conditional exports for testing (no-op in browser environment)
if (typeof module !== 'undefined') {
  module.exports = {
    tabsByUrl, pendingNewTabs, exemptTabs, tabLastNavigated,
    getState: () => ({ extensionEnabled, startupComplete, pendingExemptDuplicate }),
    setState: (s) => {
      if ('extensionEnabled' in s) extensionEnabled = s.extensionEnabled;
      if ('startupComplete' in s) startupComplete = s.startupComplete;
      if ('pendingExemptDuplicate' in s) pendingExemptDuplicate = s.pendingExemptDuplicate;
    },
    isIgnoredUrl, shortenUrl, addToCache, removeTabFromCache,
    initCache, loadEnabledState, onEnabledChanged, maybeReloadTab,
    ensureTabVisible, switchToTabAndClose, notify, applyExemptTitlePrefix,
    findExistingTab,
  };
}
