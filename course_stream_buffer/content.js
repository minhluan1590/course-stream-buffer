(() => {
  "use strict";

  const STORAGE_KEYS = {
    showDiagnostics: "courseStreamShowDiagnostics",
    unlimitedBuffer: "courseStreamUnlimitedBuffer",
    targetBufferSeconds: "courseStreamTargetBufferSeconds"
  };

  const OVERLAY_ID = "csb-debug-overlay";
  const ATTACH_MARK = "courseBufferAttached";

  const DEFAULT_SETTINGS = {
    showDiagnostics: false,
    unlimitedBuffer: true,
    targetBufferSeconds: 90
  };

  const REQUESTED_UNLIMITED_TARGET = 86400;
  const MIN_BUFFER_TARGET_SECONDS = 1;
  const MAX_BUFFER_TARGET_SECONDS = 60 * 60;
  const POLL_INTERVAL_MS = 300;
  const ENGINE_RETRY_MS = 600;
  const QUICK_REACTION_MS = 100;
  const INTERACTION_REACTION_MS = 90;

  const chromeStorage = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.sync : null;
  const activeVideos = new Set();
  const stateByVideo = new WeakMap();
  let overlay;
  let globalScanTimer = null;

  const settings = {
    showDiagnostics: DEFAULT_SETTINGS.showDiagnostics,
    unlimitedBuffer: DEFAULT_SETTINGS.unlimitedBuffer,
    targetBufferSeconds: DEFAULT_SETTINGS.targetBufferSeconds
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toInt(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function toLabel(seconds) {
    return `${Math.max(0, Math.round(seconds))}s`;
  }

  function requestedBufferTarget() {
    return settings.unlimitedBuffer
      ? REQUESTED_UNLIMITED_TARGET
      : settings.targetBufferSeconds;
  }

  function targetLabel() {
    return settings.unlimitedBuffer
      ? "unlimited (best effort)"
      : toLabel(settings.targetBufferSeconds);
  }

  function isUnlimited(value) {
    return settings.unlimitedBuffer || !Number.isFinite(value) || value >= REQUESTED_UNLIMITED_TARGET;
  }

  function safeGet(object, key) {
    try {
      return Object.getOwnPropertyDescriptor(object, key)?.value;
    } catch {
      return undefined;
    }
  }

  function safeKeys(object, limit = 80) {
    try {
      return Object.getOwnPropertyNames(object).slice(0, limit);
    } catch {
      return [];
    }
  }

  function stateFor(video) {
    let state = stateByVideo.get(video);
    if (!state) {
      state = {
        goalState: "pending",
        engineName: "not checked",
        bufferAhead: 0,
        lastEngineAttempt: 0,
        pendingRescanAt: 0,
        configuredGoal: null
      };
      stateByVideo.set(video, state);
    }
    return state;
  }

  function currentBufferedAhead(video) {
    if (!video || !video.buffered || !video.buffered.length) {
      return 0;
    }

    const currentTime = video.currentTime || 0;
    for (let index = 0; index < video.buffered.length; index++) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (start <= currentTime && currentTime < end) {
        return clamp(end - currentTime, 0, Number.MAX_SAFE_INTEGER);
      }
    }

    const lastRangeEnd = video.buffered.end(video.buffered.length - 1);
    return clamp(lastRangeEnd - currentTime, 0, Number.MAX_SAFE_INTEGER);
  }

  function createOverlay() {
    const node = document.createElement("div");
    node.id = OVERLAY_ID;
    Object.assign(node.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      maxWidth: "460px",
      padding: "9px 12px",
      borderRadius: "10px",
      border: "1px solid rgba(255, 255, 255, 0.35)",
      background: "rgba(18, 18, 18, 0.86)",
      color: "#fff",
      font: "12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      pointerEvents: "none",
      whiteSpace: "pre-line",
      backdropFilter: "blur(4px)",
      display: "none"
    });
    document.documentElement.append(node);
    return node;
  }

  function updateOverlay(video) {
    if (!settings.showDiagnostics) {
      if (overlay) {
        overlay.style.display = "none";
      }
      return;
    }

    if (!overlay) {
      overlay = createOverlay();
    }

    const state = stateFor(video);
    const ahead = currentBufferedAhead(video);
    state.bufferAhead = ahead;

    const ratioTarget = isUnlimited(settings.targetBufferSeconds) ? 30 : requestedBufferTarget();
    const ratio = clamp(ahead / Math.max(1, ratioTarget), 0, 1);
    const tone = ratio >= 1
      ? "rgba(16, 142, 83, 0.94)"
      : ratio >= 0.25
        ? "rgba(156, 112, 0, 0.94)"
        : "rgba(147, 34, 34, 0.95)";

    overlay.style.background = tone;
    overlay.style.display = "block";
    overlay.textContent = [
      "Course Stream Buffer",
      `videos detected: ${activeVideos.size}`,
      `buffer ahead: ${toLabel(ahead)} (${toLabel(ahead / Math.max(0.1, video.playbackRate || 1))} watch-time)`,
      `target: ${targetLabel()}`,
      `player: ${state.engineName}`,
      `status: ${state.goalState}`,
      `rate: ${video.playbackRate || 1}x`
    ].join("\n");
  }

  function choosePrimaryVideo() {
    const active = [...activeVideos].filter((video) => video.isConnected);
    if (!active.length) {
      return null;
    }

    const visible = active.filter((video) => video.offsetParent !== null && video.offsetWidth > 0 && video.offsetHeight > 0);
    const candidates = visible.length ? visible : active;

    return candidates.reduce((winner, current) => {
      const winnerArea = winner.videoWidth * winner.videoHeight;
      const currentArea = current.videoWidth * current.videoHeight;
      return currentArea > winnerArea ? current : winner;
    }, candidates[0]);
  }

  function applyPlayerGoal(player, video, state) {
    const request = requestedBufferTarget();
    let config;

    try {
      config = player.getConfiguration?.();
    } catch {
      // Ignore temporary player errors.
    }

    let currentGoal;
    let hasSufficientGoal = false;
    if (config && typeof config === "object" && config.streaming) {
      currentGoal = toInt(config.streaming.bufferingGoal);
      if (Number.isFinite(currentGoal) && currentGoal > 0) {
        state.configuredGoal = currentGoal;

        hasSufficientGoal = settings.unlimitedBuffer
          ? currentGoal >= MIN_BUFFER_TARGET_SECONDS
          : currentGoal >= request - 5;
        if (hasSufficientGoal) {
          state.goalState = settings.unlimitedBuffer ? "best effort" : "applied";
          state.engineName = settings.unlimitedBuffer
            ? `player buffering goal: ${toLabel(currentGoal)}`
            : `goal ${toLabel(request)} active`;
          return state.goalState === "applied" || state.goalState === "best effort";
        }

        state.engineName = `goal capped at ${toLabel(currentGoal)}`;
      }
    }

    try {
      player.configure("streaming.bufferingGoal", request);
    } catch {
      state.goalState = hasSufficientGoal ? state.goalState : "blocked";
      state.engineName = state.engineName || "player found, configure blocked";
      return false;
    }

    try {
      config = player.getConfiguration?.();
    } catch {
      state.goalState = "unconfirmed";
      state.engineName = "player found, configuration unknown";
      return false;
    }

    if (config && typeof config === "object" && config.streaming) {
      currentGoal = toInt(config.streaming.bufferingGoal);
      if (Number.isFinite(currentGoal) && currentGoal > 0) {
        state.configuredGoal = currentGoal;
        if (settings.unlimitedBuffer) {
          state.goalState = "best effort";
          state.engineName = `best-effort cap ${toLabel(currentGoal)}`;
          return true;
        }

        if (currentGoal >= request - 5) {
          state.goalState = "applied";
          state.engineName = `goal ${toLabel(request)} active`;
          return true;
        }

        state.goalState = "partial";
        state.engineName = `goal capped at ${toLabel(currentGoal)}`;
        return false;
      }
    }

    state.goalState = "unconfirmed";
    state.engineName = "player found, unknown state";
    return false;
  }

  function tryKnownPlayerAPIs(video, state) {
    const byUdemy = safeGet(video, "ui")?.getControls?.()?.getPlayer?.();
    if (byUdemy && typeof byUdemy.configure === "function" && typeof byUdemy.getConfiguration === "function") {
      if (applyPlayerGoal(byUdemy, video, state)) {
        return true;
      }
    }

    const id = video.getAttribute("id") || video.getAttribute("data-player-id");
    const videoJsPlayer = id && window.videojs?.getPlayer ? window.videojs.getPlayer(id) : null;
    if (videoJsPlayer && videoJsPlayer.configure && videoJsPlayer.getConfiguration) {
      const element = safeGet(videoJsPlayer, "media") ?? safeGet(videoJsPlayer, "video") ?? videoJsPlayer.getMediaElement?.();
      if (element === video) {
        if (applyPlayerGoal(videoJsPlayer, video, state)) {
          return true;
        }
      }
    }

    if (!window.videojs || typeof window.videojs.getPlayers !== "function") {
      return false;
    }

    const players = safeGet(window.videojs, "players") || window.videojs.getPlayers();
    if (!players || typeof players !== "object") {
      return false;
    }

    for (const key of Object.keys(players)) {
      const candidate = players[key];
      if (!candidate || typeof candidate.configure !== "function" || typeof candidate.getConfiguration !== "function") {
        continue;
      }

      try {
        const media = safeGet(candidate, "media") ?? safeGet(candidate, "video") ?? candidate.getMediaElement?.();
        if (media === video || id === key) {
          if (applyPlayerGoal(candidate, video, state)) {
            return true;
          }
        }
      } catch {
        // Ignore invalid candidate.
      }
    }

    return false;
  }

  function scanForReactPlayer(video, state) {
    const queue = [];
    const seen = new WeakSet();

    const queueIfObject = (candidate, depth) => {
      if (!candidate || typeof candidate !== "object" || seen.has(candidate) || depth > 5) {
        return;
      }
      seen.add(candidate);
      queue.push([candidate, depth]);
    };

    let ancestor = video;
    for (let level = 0; level < 4 && ancestor; level += 1, ancestor = ancestor.parentElement) {
      const key = safeKeys(ancestor).find((property) => property.startsWith("__reactFiber"));
      const fiber = key ? safeGet(ancestor, key) : null;
      for (let walk = fiber, depth = 0; walk && depth < 20; depth += 1, walk = safeGet(walk, "return")) {
        queueIfObject(walk, depth);
      }
    }

    let inspected = 0;
    while (queue.length && inspected < 900) {
      const [candidate, depth] = queue.shift();
      inspected += 1;

      if (candidate === window || candidate instanceof Node) {
        continue;
      }

      try {
        const hasAPI = typeof safeGet(candidate, "configure") === "function"
          && typeof safeGet(candidate, "getConfiguration") === "function"
          && typeof safeGet(candidate, "getMediaElement") === "function";
        if (hasAPI && safeGet(candidate, "getMediaElement")() === video) {
          if (applyPlayerGoal(candidate, video, state)) {
            return true;
          }
        }
      } catch {
        // Ignore any unsafe candidate.
      }

      if (depth >= 4) {
        continue;
      }
      for (const key of safeKeys(candidate)) {
        if (key === "child" || key === "sibling" || key === "return") {
          continue;
        }
        queueIfObject(safeGet(candidate, key), depth + 1);
      }
    }

    state.goalState = "unavailable";
    state.engineName = `player not accessible (${inspected} candidates inspected)`;
    return false;
  }

  function enforceBufferProfile(video, force = false) {
    const state = stateFor(video);
    if (state.goalState === "applied" && !settings.unlimitedBuffer) {
      return;
    }

    const now = Date.now();
    if (!force && now < state.pendingRescanAt) {
      return;
    }
    if (!force && now - state.lastEngineAttempt < ENGINE_RETRY_MS) {
      state.pendingRescanAt = now + ENGINE_RETRY_MS;
      return;
    }

    state.lastEngineAttempt = now;

    if (tryKnownPlayerAPIs(video, state)) {
      return;
    }

    scanForReactPlayer(video, state);
  }

  function forceLoad(video) {
    if (video.readyState < 3 && video.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE) {
      try {
        video.load();
      } catch {
        // ignore.
      }
    }
  }

  function requestVideoScan(video, immediate = false) {
    const state = stateFor(video);
    const delay = immediate ? QUICK_REACTION_MS : POLL_INTERVAL_MS;
    const next = Date.now() + delay;
    if (state.pendingRescanAt && Date.now() < state.pendingRescanAt) {
      return;
    }
    state.pendingRescanAt = next;
    setTimeout(() => {
      if (!video.isConnected) {
        return;
      }
      state.pendingRescanAt = 0;
      enforceBufferProfile(video, true);
      updateOverlay(video);
    }, delay);
  }

  function onVideoTick(video) {
    const state = stateFor(video);
    state.bufferAhead = currentBufferedAhead(video);
    if (!state.lastBufferProbe || Date.now() - state.lastBufferProbe > 250) {
      state.lastBufferProbe = Date.now();
      if (state.bufferAhead < 5 && video.readyState < 3) {
        forceLoad(video);
      }
    }
    requestVideoScan(video);
    if (settings.showDiagnostics) {
      updateOverlay(video);
    }
  }

  function onVideoSkip(video) {
    forceLoad(video);
    requestVideoScan(video, true);
    const state = stateFor(video);
    state.lastEngineAttempt = 0;
    state.configuredGoal = null;
    if (settings.showDiagnostics) {
      updateOverlay(video);
    }
  }

  function attach(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset[ATTACH_MARK]) {
      return;
    }

    video.dataset[ATTACH_MARK] = "1";
    video.preload = "auto";
    video.setAttribute("fetchpriority", "high");
    activeVideos.add(video);

    const state = stateFor(video);
    state.lastEngineAttempt = 0;
    state.pendingRescanAt = 0;

    const onTick = () => onVideoTick(video);
    const onSkip = () => onVideoSkip(video);
    ["progress", "timeupdate", "canplay", "canplaythrough", "playing", "waiting", "loadedmetadata", "loadeddata", "ended", "pause", "play", "ratechange"].forEach((eventName) => {
      video.addEventListener(eventName, onTick, { passive: true });
    });
    video.addEventListener("seeked", onSkip, { passive: true });
    video.addEventListener("seeking", onSkip, { passive: true });

    requestVideoScan(video, true);
    onVideoTick(video);
  }

  function prune() {
    for (const video of [...activeVideos]) {
      if (!video.isConnected) {
        activeVideos.delete(video);
      }
    }
  }

  function scanVideos() {
    const videos = [...document.querySelectorAll("video")];
    for (const video of videos) {
      attach(video);
    }
  }

  function heartbeat() {
    prune();
    for (const video of activeVideos) {
      const state = stateFor(video);
      state.bufferAhead = currentBufferedAhead(video);
      enforceBufferProfile(video);
    }

    const primary = choosePrimaryVideo();
    if (primary) {
      updateOverlay(primary);
    } else if (overlay) {
      overlay.style.display = "none";
    }
  }

  function sanitizeSettings(raw) {
    const sanitized = {
      showDiagnostics: !!raw.showDiagnostics,
      unlimitedBuffer: raw.unlimitedBuffer !== false ? true : false,
      targetBufferSeconds: toInt(raw.targetBufferSeconds)
    };

    if (!Number.isFinite(sanitized.targetBufferSeconds) || sanitized.targetBufferSeconds < MIN_BUFFER_TARGET_SECONDS) {
      sanitized.targetBufferSeconds = DEFAULT_SETTINGS.targetBufferSeconds;
    }
    sanitized.targetBufferSeconds = clamp(sanitized.targetBufferSeconds, MIN_BUFFER_TARGET_SECONDS, MAX_BUFFER_TARGET_SECONDS);

    return sanitized;
  }

  function applySettings(next) {
    Object.assign(settings, sanitizeSettings(next));

    if (settings.showDiagnostics) {
      if (!overlay) {
        overlay = createOverlay();
      }
    } else if (overlay) {
      overlay.style.display = "none";
    }

    for (const video of activeVideos) {
      const state = stateFor(video);
      state.goalState = "pending";
      state.lastEngineAttempt = 0;
      requestVideoScan(video, true);
    }
  }

  function loadSettings() {
    if (!chromeStorage || !chromeStorage.get) {
      applySettings(settings);
      return;
    }

    chromeStorage.get({
      [STORAGE_KEYS.showDiagnostics]: DEFAULT_SETTINGS.showDiagnostics,
      [STORAGE_KEYS.unlimitedBuffer]: DEFAULT_SETTINGS.unlimitedBuffer,
      [STORAGE_KEYS.targetBufferSeconds]: DEFAULT_SETTINGS.targetBufferSeconds
    }, (stored) => {
      applySettings({
        showDiagnostics: stored[STORAGE_KEYS.showDiagnostics],
        unlimitedBuffer: stored[STORAGE_KEYS.unlimitedBuffer],
        targetBufferSeconds: stored[STORAGE_KEYS.targetBufferSeconds]
      });
    });
  }

  function onStorageChange(changes, area) {
    if (area !== "sync") {
      return;
    }

    const next = {};
    if (changes[STORAGE_KEYS.showDiagnostics]) {
      next.showDiagnostics = !!changes[STORAGE_KEYS.showDiagnostics].newValue;
    }
    if (changes[STORAGE_KEYS.unlimitedBuffer]) {
      next.unlimitedBuffer = changes[STORAGE_KEYS.unlimitedBuffer].newValue !== false;
    }
    if (changes[STORAGE_KEYS.targetBufferSeconds]) {
      next.targetBufferSeconds = changes[STORAGE_KEYS.targetBufferSeconds].newValue;
    }
    if (Object.keys(next).length > 0) {
      applySettings(next);
    }
  }

  function setupInteractions() {
    const rescan = () => {
      clearTimeout(globalScanTimer);
      globalScanTimer = setTimeout(scanVideos, INTERACTION_REACTION_MS);
    };

    const onFastForward = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "ArrowRight") {
        rescan();
      }
    };

    document.addEventListener("click", rescan, { capture: true, passive: true });
    document.addEventListener("keydown", onFastForward, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        rescan();
      }
    });
  }

  function bootstrap() {
    setupInteractions();
    scanVideos();
    updateOverlay(choosePrimaryVideo());
    setInterval(heartbeat, POLL_INTERVAL_MS);

    const observer = new MutationObserver(() => {
      clearTimeout(globalScanTimer);
      globalScanTimer = setTimeout(scanVideos, 80);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (chromeStorage && chromeStorage.onChanged) {
    chromeStorage.onChanged.addListener(onStorageChange);
  }

  loadSettings();
  setTimeout(bootstrap, 0);
})();
