(function () {
  "use strict";

  const TARGET_BUFFER_SECONDS = 60;
  const OVERLAY_ID = "course-stream-buffer-overlay";
  const POLL_RATE_MS = 1100;
  const RECHECK_MS = 5000;
  const ATTACH_MARK = "courseBufferAttached";

  const attachedVideos = new Set();
  const videoState = new WeakMap();
  const overlay = createOverlay();
  let pendingScanTimer = null;

  function createOverlay() {
    const node = document.createElement("div");
    node.id = OVERLAY_ID;
    Object.assign(node.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      maxWidth: "430px",
      padding: "9px 12px",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.3)",
      background: "rgba(18, 18, 18, 0.86)",
      color: "#fff",
      font: "12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
      pointerEvents: "none",
      display: "none",
      whiteSpace: "pre-line",
      backdropFilter: "blur(4px)"
    });
    document.documentElement.append(node);
    return node;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toLabel(seconds) {
    return `${Math.max(0, Math.round(seconds))}s`;
  }

  function stateFor(video) {
    let state = videoState.get(video);
    if (!state) {
      state = {
        lastEngineAttempt: 0,
        goalState: "pending",
        engineName: "not checked",
        bufferAhead: 0
      };
      videoState.set(video, state);
    }
    return state;
  }

  function currentBufferedAhead(video) {
    if (!video || !video.buffered || !video.buffered.length) {
      return 0;
    }
    const t = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (start <= t && t <= end) {
        return clamp(end - t, 0, Number.MAX_SAFE_INTEGER);
      }
    }
    const lastEnd = video.buffered.end(video.buffered.length - 1);
    return clamp(lastEnd - t, 0, Number.MAX_SAFE_INTEGER);
  }

  function normalizeValue(object, key) {
    try {
      return Object.getOwnPropertyDescriptor(object, key)?.value;
    } catch {
      return undefined;
    }
  }

  function safeKeys(object, limit = 120) {
    try {
      return Object.getOwnPropertyNames(object).slice(0, limit);
    } catch {
      return [];
    }
  }

  function setTargetOnShakaLikePlayer(player, video, state) {
    const config = player.getConfiguration?.();
    const current = config?.streaming?.bufferingGoal;
    if (typeof current === "number") {
      if (current !== TARGET_BUFFER_SECONDS) {
        try {
          player.configure("streaming.bufferingGoal", TARGET_BUFFER_SECONDS);
        } catch {
          state.goalState = "blocked";
          state.engineName = "player found, goal write blocked";
          video.dataset.courseBufferEngine = state.engineName;
          return false;
        }
      }
      const applied = player.getConfiguration?.()?.streaming?.bufferingGoal;
      if (applied === TARGET_BUFFER_SECONDS) {
        state.goalState = "applied";
        state.engineName = "goal 60s active";
        video.dataset.courseBufferEngine = state.engineName;
        return true;
      }
    }
    state.goalState = "unconfirmed";
    state.engineName = "player found, goal unknown";
    video.dataset.courseBufferEngine = state.engineName;
    return false;
  }

  function tryKnownAPI(video, state) {
    const direct = Date.now();
    if (direct - state.lastEngineAttempt < RECHECK_MS) {
      return false;
    }
    state.lastEngineAttempt = direct;

    try {
      const uiPlayer = video.ui?.getControls?.()?.getPlayer?.();
      if (uiPlayer && uiPlayer.configure && uiPlayer.getConfiguration) {
        return setTargetOnShakaLikePlayer(uiPlayer, video, state);
      }
    } catch {
      // Ignore initialization race conditions.
    }

    const guesses = [
      () => {
        const videoId = video.getAttribute("id") || video.getAttribute("data-player-id");
        if (!videoId || !window.videojs?.getPlayer) {
          return null;
        }
        return window.videojs.getPlayer(videoId);
      }
    ];

    for (const factory of guesses) {
      try {
        const player = factory();
        if (!player || !player.configure || !player.getConfiguration) {
          continue;
        }
        const mediaNode = player.getMediaElement?.() ?? player.media || player.video;
        if (mediaNode === video) {
          return setTargetOnShakaLikePlayer(player, video, state);
        }
      } catch {
        // Continue to next candidate.
      }
    }
    return false;
  }

  function scanForShakaViaReactFiber(video, state) {
    const seen = new WeakSet();
    const queue = [];

    const enqueue = (entry, depth) => {
      if (!entry || typeof entry !== "object" || seen.has(entry) || depth > 7) {
        return;
      }
      seen.add(entry);
      queue.push([entry, depth]);
    };

    let node = video;
    for (let level = 0; node && level < 5; level++, node = node.parentElement) {
      const fiberKey = safeKeys(node).find((name) => name.startsWith("__reactFiber"));
      let fiber = fiberKey ? normalizeValue(node, fiberKey) : null;
      for (let depth = 0; fiber && depth < 28; depth++) {
        enqueue(fiber, depth);
        enqueue(normalizeValue(fiber, "stateNode"), depth + 1);
        enqueue(normalizeValue(fiber, "memoizedProps"), depth + 1);
        enqueue(normalizeValue(fiber, "memoizedState"), depth + 1);
        enqueue(normalizeValue(fiber, "ref"), depth + 1);
        fiber = normalizeValue(fiber, "return");
      }
    }

    let scanned = 0;
    while (queue.length && scanned < 1400) {
      const [current, depth] = queue.shift();
      scanned += 1;
      if (current instanceof Node || current === window) {
        continue;
      }
      try {
        const hasShakaShape = (
          typeof current.configure === "function" &&
          typeof current.getConfiguration === "function" &&
          typeof current.getMediaElement === "function"
        );
        if (hasShakaShape && current.getMediaElement() === video) {
          if (setTargetOnShakaLikePlayer(current, video, state)) {
            return true;
          }
        }
      } catch {
        // Some host objects can throw from internals.
      }

      if (depth >= 6) {
        continue;
      }
      for (const key of safeKeys(current)) {
        if (key === "child" || key === "sibling" || key === "return") {
          continue;
        }
        enqueue(normalizeValue(current, key), depth + 1);
      }
    }

    state.goalState = "unavailable";
    state.engineName = `player not accessible (${scanned} objects inspected)`;
    video.dataset.courseBufferEngine = state.engineName;
    return false;
  }

  function ensureEngine(video) {
    const state = stateFor(video);
    if (state.goalState === "applied") {
      return;
    }
    if (tryKnownAPI(video, state)) {
      return;
    }
    if (Date.now() - state.lastEngineAttempt > RECHECK_MS && state.goalState !== "applied") {
      scanForShakaViaReactFiber(video, state);
    }
  }

  function refreshStatus(video) {
    const state = stateFor(video);
    const ahead = currentBufferedAhead(video);
    state.bufferAhead = ahead;
    const overlayText = state.engineName;
    const target = TARGET_BUFFER_SECONDS;
    const watchTime = `${toLabel(ahead / Math.max(0.1, video.playbackRate || 1))} watch-time`;
    const ratio = clamp(ahead / target, 0, 1);
    const tone = ratio >= 1
      ? "rgba(16, 142, 83, 0.94)"
      : ratio >= 0.25
        ? "rgba(156, 112, 0, 0.94)"
        : "rgba(147, 34, 34, 0.95)";

    overlay.style.background = tone;
    overlay.style.display = "block";
    overlay.textContent = [
      "Course Stream Buffer",
      `active videos: ${attachedVideos.size}`,
      `buffer ahead: ${toLabel(ahead)} (${watchTime})`,
      `target: ${target}s`,
      `engine: ${overlayText}`,
      `rate: ${video.playbackRate || 1}x`
    ].join("\n");
  }

  function choosePrimary() {
    const active = [...attachedVideos].filter((video) => video.isConnected);
    if (!active.length) {
      return null;
    }
    const visible = active.filter((video) => video.offsetParent !== null && video.offsetWidth > 0 && video.offsetHeight > 0);
    if (visible.length) {
      return visible.reduce((winner, current) => {
        const winnerArea = winner.videoWidth * winner.videoHeight;
        const currentArea = current.videoWidth * current.videoHeight;
        return currentArea > winnerArea ? current : winner;
      });
    }
    return active[0];
  }

  function renderOverlay() {
    const primary = choosePrimary();
    if (!primary) {
      overlay.style.display = "none";
      return;
    }
    refreshStatus(primary);
  }

  function pruneDetachedVideos() {
    for (const video of [...attachedVideos]) {
      if (!video.isConnected) {
        attachedVideos.delete(video);
      }
    }
  }

  function attachVideo(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset[ATTACH_MARK]) {
      return;
    }
    video.dataset[ATTACH_MARK] = "1";
    video.preload = "auto";
    const state = stateFor(video);
    state.lastEngineAttempt = 0;
    attachedVideos.add(video);

    const onUpdate = () => {
      state.bufferAhead = currentBufferedAhead(video);
      ensureEngine(video);
      renderOverlay();
    };

    ["progress", "timeupdate", "canplay", "playing", "waiting", "loadedmetadata"].forEach((eventName) => {
      video.addEventListener(eventName, onUpdate, { passive: true });
    });
    ensureEngine(video);
    state.bufferAhead = currentBufferedAhead(video);
    renderOverlay();
  }

  function scanVideos() {
    for (const video of document.querySelectorAll("video")) {
      attachVideo(video);
    }
  }

  function scanTick() {
    pruneDetachedVideos();
    for (const video of attachedVideos) {
      ensureEngine(video);
      stateFor(video).bufferAhead = currentBufferedAhead(video);
    }
    renderOverlay();
  }

  scanVideos();
  renderOverlay();
  const observer = new MutationObserver(() => {
    clearTimeout(pendingScanTimer);
    pendingScanTimer = setTimeout(scanVideos, 80);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scanTick, POLL_RATE_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scanVideos();
      renderOverlay();
    }
  });
})();
