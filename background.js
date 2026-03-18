// Event listener wiring and startup logic.
// All state and functions are defined in background-core.js (loaded first via manifest).

browser.storage.onChanged.addListener(onEnabledChanged);

// Context menu item to duplicate a tab exempt from reuse logic
browser.menus.create({
  id: "duplicate-exempt",
  title: "Duplicate tab (exclude from Reuse Tabs)",
  contexts: ["tab"],
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "duplicate-exempt") return;
  setState({ pendingExemptDuplicate: true });
  const newTab = await browser.tabs.duplicate(tab.id);
  setState({ pendingExemptDuplicate: false });
  exemptTabs.add(newTab.id);
  pendingNewTabs.delete(newTab.id);
  notify(`Duplicated tab (exempt from reuse): ${shortenUrl(tab.url)}`);
});

// When a new tab is created, track it and check if it's already a duplicate
browser.tabs.onCreated.addListener(async (tab) => {
  // If this tab was created by our "duplicate exempt" action, mark it immediately
  if (getState().pendingExemptDuplicate) {
    exemptTabs.add(tab.id);
    return;
  }

  pendingNewTabs.add(tab.id);
  setTimeout(() => pendingNewTabs.delete(tab.id), 5000);

  const { extensionEnabled, startupComplete } = getState();
  if (!extensionEnabled) return;
  if (!startupComplete) return;

  if (!isIgnoredUrl(tab.url)) {
    const matchId = findExistingTab(tab.url, tab.id);
    if (matchId !== undefined) {
      pendingNewTabs.delete(tab.id);
      await switchToTabAndClose(matchId, tab.id, tab.url);
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
  const { extensionEnabled, startupComplete } = getState();
  if (startupComplete && extensionEnabled && pendingNewTabs.has(tabId) && !exemptTabs.has(tabId) && !isIgnoredUrl(changeInfo.url)) {
    pendingNewTabs.delete(tabId);
    const matchId = findExistingTab(changeInfo.url, tabId);
    if (matchId !== undefined) {
      await switchToTabAndClose(matchId, tabId, changeInfo.url);
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
    const { extensionEnabled, startupComplete, pendingExemptDuplicate } = getState();
    if (!extensionEnabled) return;
    if (!startupComplete) return;
    if (details.type !== "main_frame") return;
    if (isIgnoredUrl(details.url)) return;
    if (pendingExemptDuplicate || exemptTabs.has(details.tabId)) return;

    const matchId = findExistingTab(details.url, details.tabId);
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
setTimeout(() => { setState({ startupComplete: true }); }, 5000);
