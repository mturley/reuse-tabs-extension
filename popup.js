const enabledCheckbox = document.getElementById("enabled");
const notificationsCheckbox = document.getElementById("notifications");

async function init() {
  const { enabled = true, notifications = true } = await browser.storage.local.get(["enabled", "notifications"]);
  enabledCheckbox.checked = enabled;
  notificationsCheckbox.checked = notifications;
}

enabledCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ enabled: enabledCheckbox.checked });
});

notificationsCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ notifications: notificationsCheckbox.checked });
});

init();
