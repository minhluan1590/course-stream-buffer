(() => {
  "use strict";

  const STORAGE_KEY = "courseStreamShowDiagnostics";
  const OVERLAY_ID = "csb-debug-overlay";
  const ATTACH_MARK = "courseBufferAttached";
  const activeVideos = new Set();
  let showDiagnostics = false;
  let overlay;

  function bufferedAhead(video) {
    if (!video.buffered?.length) return 0;
    const position = video.currentTime || 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (start <= position && position < end) return Math.max(0, end - position);
    }
    return 0;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed", right: "14px", bottom: "14px", zIndex: "2147483647",
      padding: "9px 12px", borderRadius: "10px", color: "#fff",
      background: "rgba(18, 18, 18, .88)", border: "1px solid rgba(255,255,255,.35)",
      font: "12px/1.35 ui-monospace, monospace", pointerEvents: "none", whiteSpace: "pre-line"
    });
    document.documentElement.append(overlay);
    return overlay;
  }

  function primaryVideo() {
    const connected = [...activeVideos].filter((video) => video.isConnected);
    return connected.find((video) => video.offsetParent !== null) || connected[0] || null;
  }

  function updateOverlay() {
    if (!showDiagnostics) {
      if (overlay) overlay.style.display = "none";
      return;
    }
    const video = primaryVideo();
    if (!video) return;
    const ahead = bufferedAhead(video);
    const node = ensureOverlay();
    node.style.display = "block";
    node.style.background = ahead >= 30 ? "rgba(16, 142, 83, .94)" : ahead >= 5 ? "rgba(156, 112, 0, .94)" : "rgba(147, 34, 34, .95)";
    node.textContent = [
      "Course Stream Buffer",
      `buffer ahead: ${Math.round(ahead)}s`,
      `network: ${video.networkState === HTMLMediaElement.NETWORK_LOADING ? "loading" : "idle"}`,
      "mode: safe monitor (native player controls buffering)"
    ].join("\n");
  }

  function attach(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset[ATTACH_MARK]) return;
    video.dataset[ATTACH_MARK] = "1";
    // Standard hints only: never reset or alter the active MediaSource pipeline.
    video.preload = "auto";
    video.setAttribute("fetchpriority", "high");
    activeVideos.add(video);
    ["progress", "timeupdate", "seeking", "seeked", "waiting", "playing", "loadeddata"].forEach((event) => {
      video.addEventListener(event, updateOverlay, { passive: true });
    });
    updateOverlay();
  }

  function scan() {
    document.querySelectorAll("video").forEach(attach);
    for (const video of activeVideos) if (!video.isConnected) activeVideos.delete(video);
    updateOverlay();
  }

  function applySettings(values) {
    showDiagnostics = Boolean(values[STORAGE_KEY]);
    updateOverlay();
  }

  function bootstrap() {
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 2000);
  }

  if (chrome?.storage?.sync) {
    chrome.storage.sync.get({ [STORAGE_KEY]: false }, applySettings);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[STORAGE_KEY]) applySettings({ [STORAGE_KEY]: changes[STORAGE_KEY].newValue });
    });
  }
  bootstrap();
})();
