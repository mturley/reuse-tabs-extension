const enabledCheckbox = document.getElementById("enabled");
const notificationsCheckbox = document.getElementById("notifications");
const reloadCheckbox = document.getElementById("reloadOnSwitch");
const ttlSelect = document.getElementById("reloadTtlMinutes");
const ttlRow = document.getElementById("ttlRow");

function updateTtlVisibility() {
  ttlRow.style.display = reloadCheckbox.checked ? "flex" : "none";
}

async function init() {
  const {
    enabled = true,
    notifications = true,
    reloadOnSwitch = false,
    reloadTtlMinutes = 5,
  } = await browser.storage.local.get(["enabled", "notifications", "reloadOnSwitch", "reloadTtlMinutes"]);
  enabledCheckbox.checked = enabled;
  notificationsCheckbox.checked = notifications;
  reloadCheckbox.checked = reloadOnSwitch;
  ttlSelect.value = String(reloadTtlMinutes);
  updateTtlVisibility();
}

enabledCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ enabled: enabledCheckbox.checked });
});

notificationsCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ notifications: notificationsCheckbox.checked });
});

reloadCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ reloadOnSwitch: reloadCheckbox.checked });
  updateTtlVisibility();
});

ttlSelect.addEventListener("change", () => {
  browser.storage.local.set({ reloadTtlMinutes: Number(ttlSelect.value) });
});

init();
