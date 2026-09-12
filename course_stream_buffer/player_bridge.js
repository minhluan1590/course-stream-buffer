(() => {
  "use strict";

  const TARGET_SECONDS = 300;
  const configuredPlayers = new WeakSet();
  const attemptsByVideo = new WeakMap();
  const MAX_ATTEMPTS = 12;
  let scheduledScan;

  function setStatus(message) {
    document.documentElement.dataset.csbBufferStatus = message;
  }

  function ownValue(object, key) {
    try {
      return Object.getOwnPropertyDescriptor(object, key)?.value;
    } catch {
      return undefined;
    }
  }

  function keys(object) {
    try {
      return Object.getOwnPropertyNames(object).slice(0, 100);
    } catch {
      return [];
    }
  }

  function isMatchingPlayer(candidate, video) {
    try {
      return candidate && typeof candidate.configure === "function"
        && typeof candidate.getConfiguration === "function"
        && typeof candidate.getMediaElement === "function"
        && candidate.getMediaElement() === video;
    } catch {
      return false;
    }
  }

  function findPlayer(video) {
    const direct = ownValue(video, "ui")?.getControls?.()?.getPlayer?.();
    if (isMatchingPlayer(direct, video)) return direct;

    const queue = [];
    const seen = new WeakSet();
    const add = (value, depth) => {
      if (!value || typeof value !== "object" || seen.has(value) || depth > 3) return;
      seen.add(value);
      queue.push([value, depth]);
    };

    for (let node = video, levels = 0; node && levels < 4; node = node.parentElement, levels += 1) {
      const fiberKey = keys(node).find((key) => key.startsWith("__reactFiber"));
      const fiber = fiberKey && ownValue(node, fiberKey);
      for (let current = fiber, depth = 0; current && depth < 16; current = ownValue(current, "return"), depth += 1) {
        add(current, 0);
        add(ownValue(current, "stateNode"), 0);
        add(ownValue(current, "memoizedProps"), 0);
      }
    }

    let inspected = 0;
    while (queue.length && inspected < 300) {
      const [candidate, depth] = queue.shift();
      inspected += 1;
      if (isMatchingPlayer(candidate, video)) return candidate;
      if (depth === 3 || candidate instanceof Node || candidate === window) continue;
      for (const key of keys(candidate)) {
        if (key === "return" || key === "child" || key === "sibling") continue;
        add(ownValue(candidate, key), depth + 1);
      }
    }
    return null;
  }

  function configureOnce(video) {
    if (configuredPlayers.has(video)) return;
    const attempts = attemptsByVideo.get(video) || 0;
    if (attempts >= MAX_ATTEMPTS) {
      setStatus("player API unavailable");
      return;
    }
    attemptsByVideo.set(video, attempts + 1);

    const player = findPlayer(video);
    if (!player) {
      setStatus("looking for player API");
      return;
    }

    try {
      const before = player.getConfiguration();
      if (!before?.streaming || typeof before.streaming.bufferingGoal !== "number") {
        setStatus("player has no buffer control");
        return;
      }
      if (before.streaming.bufferingGoal < TARGET_SECONDS) {
        player.configure("streaming.bufferingGoal", TARGET_SECONDS);
      }
      const after = player.getConfiguration();
      const actual = after?.streaming?.bufferingGoal;
      if (typeof actual === "number" && actual >= TARGET_SECONDS) {
        configuredPlayers.add(video);
        setStatus(`300s target applied (${Math.round(actual)}s)`);
      } else {
        setStatus(`player capped target at ${Math.round(actual || 0)}s`);
      }
    } catch {
      setStatus("player rejected buffer target");
    }
  }

  function scan() {
    document.querySelectorAll("video").forEach(configureOnce);
  }

  function scheduleScan() {
    if (scheduledScan) return;
    scheduledScan = setTimeout(() => {
      scheduledScan = undefined;
      scan();
    }, 400);
  }

  setStatus("waiting for video");
  scan();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scheduleScan, 1500);
})();
