(() => {
  "use strict";

  const STORAGE_KEYS = {
    showDiagnostics: "courseStreamShowDiagnostics",
    unlimitedBuffer: "courseStreamUnlimitedBuffer",
    targetBufferSeconds: "courseStreamTargetBufferSeconds"
  };

  const statusEl = document.getElementById("status");
  const showDiagnostics = document.getElementById("showDiagnostics");
  const unlimitedBuffer = document.getElementById("unlimitedBuffer");
  const targetBufferSeconds = document.getElementById("targetBufferSeconds");
  const saveButton = document.getElementById("saveButton");

  const defaults = {
    showDiagnostics: false,
    unlimitedBuffer: true,
    targetBufferSeconds: 90
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function renderControls(values) {
    showDiagnostics.checked = values.showDiagnostics;
    unlimitedBuffer.checked = values.unlimitedBuffer !== false;
    targetBufferSeconds.value = toNumber(values.targetBufferSeconds) || defaults.targetBufferSeconds;
    targetBufferSeconds.disabled = unlimitedBuffer.checked;
  }

  function normalizeTarget(raw) {
    const parsed = toNumber(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaults.targetBufferSeconds;
    }
    return clamp(Math.round(parsed), 1, 3600);
  }

  function load() {
    const fallback = {
      [STORAGE_KEYS.showDiagnostics]: defaults.showDiagnostics,
      [STORAGE_KEYS.unlimitedBuffer]: defaults.unlimitedBuffer,
      [STORAGE_KEYS.targetBufferSeconds]: defaults.targetBufferSeconds
    };

    if (!chrome.storage || !chrome.storage.sync) {
      renderControls(fallback);
      return;
    }

    chrome.storage.sync.get(fallback, (stored) => {
      if (chrome.runtime.lastError) {
        setStatus(`Could not load settings: ${chrome.runtime.lastError.message}`);
        return;
      }
      renderControls({
        showDiagnostics: !!stored[STORAGE_KEYS.showDiagnostics],
        unlimitedBuffer: stored[STORAGE_KEYS.unlimitedBuffer] !== false,
        targetBufferSeconds: normalizeTarget(stored[STORAGE_KEYS.targetBufferSeconds])
      });
    });
  }

  function save() {
    const payload = {
      [STORAGE_KEYS.showDiagnostics]: !!showDiagnostics.checked,
      [STORAGE_KEYS.unlimitedBuffer]: unlimitedBuffer.checked,
      [STORAGE_KEYS.targetBufferSeconds]: normalizeTarget(targetBufferSeconds.value)
    };

    if (!chrome.storage || !chrome.storage.sync) {
      setStatus("Storage is unavailable in this browser context.");
      return;
    }

    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime.lastError) {
        setStatus(`Could not save: ${chrome.runtime.lastError.message}`);
        return;
      }
      setStatus("Settings saved.");
      window.setTimeout(() => setStatus(""), 1800);
    });
  }

  unlimitedBuffer.addEventListener("change", () => {
    targetBufferSeconds.disabled = unlimitedBuffer.checked;
  });

  saveButton.addEventListener("click", save);

  load();
})();
