// Cache of open tab URLs: Map<url, Set<tabId>>
const tabsByUrl = new Map();

// Track recently created tabs so we can catch duplicates opened by external apps
const pendingNewTabs = new Set();

// Track tab IDs that are exempt from reuse logic (intentional duplicates)
const exemptTabs = new Set();

// Flag: when set, the next tab created by browser.tabs.duplicate() should be exempt
let pendingExemptDuplicate = false;

// Track when each tab last had a navigation (timestamp in ms)
const tabLastNavigated = new Map();

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

// Cached enabled state (must be synchronous for webRequest)
let extensionEnabled = true;

async function loadEnabledState() {
  const { enabled = true } = await browser.storage.local.get("enabled");
  extensionEnabled = enabled;
}

browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    extensionEnabled = changes.enabled.newValue;
  }
});

async function notify(message, tabId) {
  console.log("[Reuse Tabs]", message);
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

async function switchToTabAndClose(existingTabId, tabIdToClose, url) {
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

// Context menu item to duplicate a tab exempt from reuse logic
browser.menus.create({
  id: "duplicate-exempt",
  title: "Duplicate tab (exclude from Reuse Tabs)",
  contexts: ["tab"],
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "duplicate-exempt") return;
  pendingExemptDuplicate = true;
  const newTab = await browser.tabs.duplicate(tab.id);
  pendingExemptDuplicate = false;
  exemptTabs.add(newTab.id);
  pendingNewTabs.delete(newTab.id);
  notify(`Duplicated tab (exempt from reuse): ${shortenUrl(tab.url)}`);
});

// When a new tab is created, track it and check if it's already a duplicate
browser.tabs.onCreated.addListener(async (tab) => {
  // If this tab was created by our "duplicate exempt" action, mark it immediately
  if (pendingExemptDuplicate) {
    exemptTabs.add(tab.id);
    return;
  }

  pendingNewTabs.add(tab.id);
  setTimeout(() => pendingNewTabs.delete(tab.id), 5000);

  if (!extensionEnabled) return;

  if (!isIgnoredUrl(tab.url)) {
    const existingTabIds = tabsByUrl.get(tab.url);
    if (existingTabIds) {
      const matchId = [...existingTabIds].find((id) => id !== tab.id);
      if (matchId !== undefined) {
        pendingNewTabs.delete(tab.id);
        await switchToTabAndClose(matchId, tab.id, tab.url);
        return;
      }
    }
  }
});

// Keep the cache up to date and catch new tabs that get their URL after creation
browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Apply or re-apply [D] prefix for exempt tabs when title changes
  if (changeInfo.title && exemptTabs.has(tabId)) {
    if (!changeInfo.title.startsWith("[D] ")) {
      // Wait briefly for the page to settle before applying the prefix
      setTimeout(() => applyExemptTitlePrefix(tabId), 100);
    }
  }

  if (!changeInfo.url) return;

  // Update the cache
  removeTabFromCache(tabId);
  addToCache(changeInfo.url, tabId);

  // If this is a recently created tab, check for duplicates
  if (extensionEnabled && pendingNewTabs.has(tabId) && !exemptTabs.has(tabId) && !isIgnoredUrl(changeInfo.url)) {
    pendingNewTabs.delete(tabId);
    const existingTabIds = tabsByUrl.get(changeInfo.url);
    if (existingTabIds) {
      const matchId = [...existingTabIds].find((id) => id !== tabId);
      if (matchId !== undefined) {
        await switchToTabAndClose(matchId, tabId, changeInfo.url);
      }
    }
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  pendingNewTabs.delete(tabId);
  exemptTabs.delete(tabId);
  tabLastNavigated.delete(tabId);
  removeTabFromCache(tabId);
});

// Block in-page navigation to URLs already open in another tab
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!extensionEnabled) return;
    if (details.type !== "main_frame") return;
    if (isIgnoredUrl(details.url)) return;
    if (pendingExemptDuplicate || exemptTabs.has(details.tabId)) return;

    const existingTabIds = tabsByUrl.get(details.url);
    if (!existingTabIds) return;

    // Find a matching non-exempt tab (skip exempt tabs as targets)
    const matchId = [...existingTabIds].find(
      (id) => id !== details.tabId && !exemptTabs.has(id)
    );
    if (matchId === undefined) return;

    // Switch to the existing tab
    browser.tabs.update(matchId, { active: true });
    browser.tabs.get(matchId).then((tab) => {
      browser.windows.update(tab.windowId, { focused: true });
    });
    // If this was a newly opened tab (e.g. from an external app), close it
    const closedNew = pendingNewTabs.has(details.tabId);
    if (closedNew) {
      pendingNewTabs.delete(details.tabId);
      browser.tabs.remove(details.tabId);
    }
    maybeReloadTab(matchId).then((reloaded) => {
      const parts = [];
      if (closedNew) parts.push("Closed duplicate tab,");
      else parts.push("Cancelled navigation,");
      parts.push("switched to");
      if (reloaded) parts.push("and reloaded");
      parts.push(`existing tab: ${shortenUrl(details.url)}`);
      notify(parts.join(" "), matchId);
    });

    // Cancel the navigation
    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

loadEnabledState();
initCache();
