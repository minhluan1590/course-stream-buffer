(() => {
  "use strict";

  const storageKey = "courseStreamShowDiagnostics";
  const checkbox = document.getElementById("showDiagnostics");
  const status = document.getElementById("status");

  chrome.storage.sync.get({ [storageKey]: false }, (values) => {
    checkbox.checked = Boolean(values[storageKey]);
  });

  document.getElementById("saveButton").addEventListener("click", () => {
    chrome.storage.sync.set({ [storageKey]: checkbox.checked }, () => {
      status.textContent = chrome.runtime.lastError ? `Could not save: ${chrome.runtime.lastError.message}` : "Settings saved.";
      if (!chrome.runtime.lastError) setTimeout(() => { status.textContent = ""; }, 1800);
    });
  });
})();
