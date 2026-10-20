/* Figure 8: observation, paired intention emphasis, and synchronized futures. */
(() => {
  "use strict";

  const region = document.querySelector("#failure-player");
  if (!region) return;
  const viewport = region.querySelector(".f8-viewport") || region;
  const dots = [...region.querySelectorAll("[data-f8-select]")];

  const kinds = ["observation", "gt", "ours"];
  const cases = [...region.querySelectorAll(".f8-case[data-case]")].map(element => ({
    element,
    index: Number(element.dataset.case),
    videos: new Map([...element.querySelectorAll(".f8-cell[data-kind]")]
      .map(cell => [cell.dataset.kind, cell.querySelector("video")])
      .filter(([, video]) => video)),
    ready: false,
    failed: false,
    loading: false,
    promise: null
  }));
  if (!cases.length) return;

  const status = region.querySelector("#f8-status");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mediaState = new WeakMap();
  const speed = 0.65;
  const frameDuration = 1 / 30;
  const phases = ["observation", "intention", "prediction", "hold"];
  const durations = { observation: 1 / speed, intention: 1.1, prediction: 1 / speed, hold: 1 };
  let sample = cases.some(item => item.index === Number(region.dataset.sample))
    ? Number(region.dataset.sample) : cases[0].index;
  let phase = "observation";
  let phaseElapsed = 0;
  let approached = false;
  let wanted = !reducedMotion.matches;
  let ready = false;
  let loading = false;
  let mediaWaiting = false;
  let progressTimestamp = 0;
  let progressTime = 0;
  let running = false;
  let animationFrame = 0;
  let lastTimestamp = 0;
  let lastMediaSync = 0;
  let lastMediaPhase = "";
  let selectionGeneration = 0;
  let bufferTimeout = 0;
  let transitioning = false;
  let transitionGeneration = 0;
  let slideAnimations = [];

  const activeCase = () => cases.find(item => item.index === sample);
  const nextCase = item => cases[(cases.indexOf(item) + 1) % cases.length];
  const setStatus = message => {
    if (status && status.textContent !== message) status.textContent = message;
  };

  function updateState() {
    region.dataset.sample = String(sample);
    region.dataset.phase = phase;
    region.dataset.ready = String(ready);
    region.dataset.loading = String(loading || mediaWaiting);
    region.dataset.playing = String(running);
    region.dataset.transitioning = String(transitioning);
    region.dataset.phaseTime = phaseElapsed.toFixed(4);
    const item = activeCase();
    item.element.dataset.phase = phase;
    const emphasis = phase === "intention"
      ? Math.sin(Math.PI * Math.min(1, phaseElapsed / durations.intention)) ** 2 : 0;
    item.element.style.setProperty("--f8-emphasis", emphasis.toFixed(4));
  }

  function updateSelection() {
    for (const item of cases) {
      const selected = item.index === sample;
      item.element.dataset.active = String(selected);
      item.element.removeAttribute("aria-pressed");
      item.element.setAttribute("aria-hidden", String(!selected));
      item.element.inert = !selected;
      item.element.tabIndex = selected ? 0 : -1;
      item.element.dataset.phase = selected ? phase : "observation";
      item.element.style.setProperty("--f8-emphasis", "0");
    }
    for (const dot of dots) {
      dot.setAttribute("aria-pressed", String(Number(dot.dataset.f8Select) === sample));
    }
  }

  function pauseVideo(video) {
    const state = mediaState.get(video);
    if (state.playRequested || state.playStarted || !video.paused) {
      state.playRequested = false;
      state.playStarted = false;
      state.playToken += 1;
      video.pause();
    }
  }

  function resetInactiveCases() {
    for (const item of cases) {
      if (item.index === sample) continue;
      for (const video of item.videos.values()) {
        pauseVideo(video);
        if (video.readyState >= 1 && video.currentTime !== 0) {
          try { video.currentTime = 0; } catch { /* A pending load starts at zero. */ }
        }
        video.dataset.f8Frame = "0";
      }
    }
  }

  function targetTime(kind, video) {
    const duration = Number.isFinite(video.duration) ? video.duration : 1;
    const lastFrame = Math.max(0, Math.min(1, duration) - frameDuration);
    if (kind === "observation") {
      return phase === "observation" ? Math.min(lastFrame, phaseElapsed * speed) : lastFrame;
    }
    if (phase === "prediction") return Math.min(lastFrame, phaseElapsed * speed);
    return phase === "hold" ? lastFrame : 0;
  }

  function phaseVideos() {
    const item = activeCase();
    return phase === "observation" ? [item.videos.get("observation")]
      : phase === "prediction" ? [item.videos.get("gt"), item.videos.get("ours")] : [];
  }

  function lastFrameTime(video) {
    return Math.max(0, Math.min(1, video.duration || 1) - frameDuration);
  }

  function finishedPlayback(video) {
    return mediaState.get(video).playStarted && !video.seeking
      && video.currentTime >= lastFrameTime(video) - 0.002;
  }

  function syncMedia(exact = false) {
    const item = activeCase();
    const peers = phaseVideos();
    const peersReady = peers.every(video => mediaState.get(video).playStarted
      && video.readyState >= 3 && !video.seeking);
    for (const [kind, video] of item.videos) {
      const state = mediaState.get(video);
      if (!ready) {
        pauseVideo(video);
        continue;
      }
      const target = targetTime(kind, video);
      const active = kind === "observation" ? phase === "observation" : phase === "prediction";
      const shouldPlay = running && active;
      if (!shouldPlay) pauseVideo(video);
      if (video.readyState < 2) continue;

      // Active clips follow their decoded media time. Reset or pull a leading
      // clip back, but never seek a delayed forecast forward to a wall clock.
      const difference = video.currentTime - target;
      const shouldSeek = shouldPlay
        ? difference > (exact ? 0.002 : 0.1) && (exact || peersReady)
        : Math.abs(difference) > 0.002;
      if (shouldSeek && (exact || !video.seeking)) {
        try { video.currentTime = target; } catch { /* Metadata may still be settling. */ }
      }
      video.dataset.f8Frame = String(Math.min(29, Math.floor((target + 0.00001) * 30)));
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (!shouldPlay || state.playRequested) continue;
      if (state.playStarted && (!video.paused || finishedPlayback(video))) continue;

      state.playRequested = true;
      state.playStarted = false;
      const playToken = ++state.playToken;
      const generation = selectionGeneration;
      Promise.resolve(video.play()).then(() => {
        if (playToken !== state.playToken || generation !== selectionGeneration) return;
        state.playRequested = false;
        state.playStarted = !video.paused;
      }).catch(error => {
        if (playToken !== state.playToken || generation !== selectionGeneration) return;
        state.playRequested = false;
        state.playStarted = false;
        if (error.name === "NotAllowedError") {
          wanted = false;
          stopClock();
          setStatus("Select a case to play its comparison.");
        } else if (error.name !== "AbortError") {
          state.ready = false;
          state.failed = true;
          state.promise = null;
          markCaseFailed(item);
        }
      });
    }
  }

  function clearBufferTimeout() {
    clearTimeout(bufferTimeout);
    bufferTimeout = 0;
  }

  function stopClock() {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastTimestamp = 0;
    progressTimestamp = 0;
    mediaWaiting = false;
    syncMedia(true);
    updateState();
  }

  function isViewportVisible() {
    // Incoming cards initially sit outside the viewport; visibility must be
    // measured on the stationary carousel, not on an animated card.
    const bounds = viewport.getBoundingClientRect();
    const width = Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left));
    const height = Math.max(0, Math.min(window.innerHeight, bounds.bottom) - Math.max(0, bounds.top));
    return bounds.width > 0 && bounds.height > 0 && width * height >= bounds.width * bounds.height * 0.05;
  }

  function allBuffered(item) {
    return kinds.every(kind => item.videos.get(kind)?.readyState >= 3);
  }

  function waitForBuffer() {
    loading = true;
    setStatus("Loading case…");
    updateState();
    if (bufferTimeout) return;
    const item = activeCase();
    bufferTimeout = setTimeout(() => {
      bufferTimeout = 0;
      if (loading && item.index === sample) markCaseFailed(item);
    }, 12000);
  }

  function maybeStart() {
    const visible = !document.hidden && isViewportVisible();
    for (const animation of slideAnimations) {
      if (!visible && animation.playState === "running") animation.pause();
      else if (visible && animation.playState === "paused") animation.play();
    }
    if (!wanted || !ready || loading || transitioning || !visible) {
      if (running) stopClock();
      else updateState();
      return;
    }
    if (running) return;
    if (!allBuffered(activeCase())) {
      waitForBuffer();
      return;
    }
    clearBufferTimeout();
    running = true;
    lastTimestamp = 0;
    progressTimestamp = 0;
    progressTime = phaseElapsed;
    lastMediaPhase = "";
    syncMedia(true);
    updateState();
    animationFrame = requestAnimationFrame(tick);
  }

  function tick(timestamp) {
    if (!running) return;
    const elapsed = lastTimestamp ? Math.min(0.1, (timestamp - lastTimestamp) / 1000) : 0;
    lastTimestamp = timestamp;
    const videos = phaseVideos();
    if (videos.length) {
      const canAdvance = videos.every(video => mediaState.get(video).playStarted
        && !video.seeking && (finishedPlayback(video) || (!video.paused && video.readyState >= 3)));
      mediaWaiting = !canAdvance;
      setStatus(mediaWaiting ? "Loading case…" : "");
      if (canAdvance) {
        phaseElapsed = Math.min(...videos.map(video => Math.min(video.currentTime, lastFrameTime(video)))) / speed;
        if (videos.every(finishedPlayback)) phaseElapsed = durations[phase];
      }
      if (!progressTimestamp || phaseElapsed > progressTime + 0.002) {
        progressTimestamp = timestamp;
        progressTime = phaseElapsed;
      } else if (timestamp - progressTimestamp >= 12000) {
        markCaseFailed(activeCase());
        return;
      }
    } else {
      mediaWaiting = false;
      phaseElapsed += elapsed;
    }
    if (phaseElapsed >= durations[phase]) {
      if (phase === "hold") {
        if (reducedMotion.matches) {
          phaseElapsed = durations.hold;
          wanted = false;
          stopClock();
        } else {
          selectCase(nextCase(activeCase()).index, false);
        }
        return;
      }
      phaseElapsed = 0;
      phase = phases[phases.indexOf(phase) + 1];
      progressTimestamp = 0;
      progressTime = 0;
      mediaWaiting = false;
      setStatus("");
    }
    if (phase !== lastMediaPhase || timestamp - lastMediaSync >= 80) {
      syncMedia(phase !== lastMediaPhase);
      lastMediaPhase = phase;
      lastMediaSync = timestamp;
    }
    updateState();
    if (running) animationFrame = requestAnimationFrame(tick);
  }

  function markCaseFailed(item) {
    item.ready = false;
    item.failed = true;
    item.loading = false;
    item.promise = null;
    item.element.dataset.ready = "false";
    item.element.dataset.loading = "false";
    if (item.index !== sample) return;
    clearBufferTimeout();
    ready = false;
    loading = false;
    stopClock();
    setStatus("This case could not be loaded. Select it to try again.");
  }

  function ensureVideo(item, kind, retry) {
    const video = item.videos.get(kind);
    if (!video) return Promise.resolve(false);
    const state = mediaState.get(video);
    if (state.ready && !video.error) return Promise.resolve(true);
    if (state.failed && retry) {
      state.promise = null;
      state.failed = false;
    }
    if (state.promise) return state.promise;
    if (state.failed) return Promise.resolve(false);

    const mp4Supported = Boolean(video.canPlayType('video/mp4; codecs="avc1.42E01E"'));
    const sources = (mp4Supported
      ? [video.dataset.src, video.dataset.webm]
      : [video.dataset.webm, video.dataset.src]).filter(Boolean);
    if (!sources.length) return Promise.resolve(false);

    state.promise = new Promise(resolve => {
      let sourceIndex = 0;
      let timeout;
      let settled = false;
      function finish(success) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        video.removeEventListener("canplay", check);
        video.removeEventListener("loadeddata", check);
        video.removeEventListener("error", tryFallback);
        state.ready = success;
        state.failed = !success;
        resolve(success);
      }
      function check() {
        if (video.readyState >= 3 && !video.error) finish(true);
      }
      function loadSource() {
        clearTimeout(timeout);
        timeout = setTimeout(tryFallback, 12000);
        video.preload = "auto";
        video.src = sources[sourceIndex];
        video.load();
        check();
      }
      function tryFallback() {
        if (settled) return;
        sourceIndex += 1;
        if (sourceIndex < sources.length) loadSource();
        else finish(false);
      }
      video.addEventListener("canplay", check);
      video.addEventListener("loadeddata", check);
      video.addEventListener("error", tryFallback);
      loadSource();
    });
    return state.promise;
  }

  function prepareCase(item, retry = false) {
    if (item.ready) return Promise.resolve(true);
    if (item.promise) return item.promise;
    if (item.failed && !retry) return Promise.resolve(false);
    if (item.failed && retry) {
      // A playback stall can fail a case whose initial load was successful.
      // Explicit retry must reload those clips instead of reusing cached ready.
      for (const video of item.videos.values()) {
        const state = mediaState.get(video);
        state.ready = false;
        state.failed = false;
        state.promise = null;
      }
    }
    item.failed = false;
    item.loading = true;
    item.element.dataset.loading = "true";
    item.promise = Promise.all(kinds.map(kind => ensureVideo(item, kind, retry))).then(results => {
      item.loading = false;
      item.ready = results.every(Boolean);
      item.failed = !item.ready;
      item.element.dataset.ready = String(item.ready);
      item.element.dataset.loading = "false";
      item.promise = null;
      return item.ready;
    });
    return item.promise;
  }

  async function prepareActive(retry = false) {
    if (!approached || !wanted) return;
    const item = activeCase();
    const generation = selectionGeneration;
    loading = !item.ready;
    ready = item.ready;
    if (loading) setStatus("Loading case…");
    updateState();
    const success = await prepareCase(item, retry);
    if (generation !== selectionGeneration || item.index !== sample) return;
    ready = success;
    loading = false;
    if (!success) {
      markCaseFailed(item);
      return;
    }
    setStatus("");
    syncMedia(true);
    maybeStart();
    updateState();
    // Warm only the next case, without playing or seeking its videos.
    if (!reducedMotion.matches && wanted) void prepareCase(nextCase(item));
  }

  function cancelTransition() {
    transitionGeneration += 1;
    for (const animation of slideAnimations) animation.cancel();
    slideAnimations = [];
    transitioning = false;
    for (const item of cases) delete item.element.dataset.transition;
  }

  function startTransition(incoming, direction, positions) {
    if (reducedMotion.matches || typeof incoming.element.animate !== "function") {
      resetInactiveCases();
      return;
    }
    const generation = ++transitionGeneration;
    transitioning = true;
    region.dataset.direction = direction > 0 ? "next" : "previous";
    incoming.element.dataset.transition = "incoming";
    const options = { duration: 500, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" };
    slideAnimations = [];
    for (const [item, transform] of positions) {
      if (item === incoming) continue;
      item.element.dataset.transition = "outgoing";
      slideAnimations.push(item.element.animate([
        { transform },
        { transform: `translateX(${-direction * 100}%)` }
      ], options));
    }
    slideAnimations.push(incoming.element.animate([
      { transform: positions.get(incoming) || `translateX(${direction * 100}%)` },
      { transform: "translateX(0%)" }
    ], options));
    updateState();
    maybeStart();
    void Promise.allSettled(slideAnimations.map(animation => animation.finished)).then(() => {
      if (generation !== transitionGeneration) return;
      cancelTransition();
      resetInactiveCases();
      updateState();
      maybeStart();
    });
  }

  function selectCase(index, explicit = true) {
    if (!cases.some(item => item.index === index)) return;
    clearBufferTimeout();
    stopClock();
    const previous = activeCase();
    const positions = new Map();
    for (const item of cases) {
      if (item.element.dataset.active === "true" || item.element.dataset.transition) {
        const transform = getComputedStyle(item.element).transform;
        positions.set(item, transform === "none" ? "translateX(0%)" : transform);
      }
      for (const video of item.videos.values()) pauseVideo(video);
    }
    // Capture interrupted positions before canceling WAAPI, so fast dot clicks
    // continue from the visible locations instead of flashing back to zero.
    cancelTransition();
    selectionGeneration += 1;
    sample = index;
    phase = "observation";
    phaseElapsed = 0;
    ready = false;
    loading = false;
    if (explicit) {
      wanted = true;
      approached = true;
    }
    const incoming = activeCase();
    const caseHadFocus = cases.some(item => item.element.contains(document.activeElement));
    if (caseHadFocus) {
      incoming.element.dataset.active = "true";
      incoming.element.inert = false;
      incoming.element.removeAttribute("aria-hidden");
      incoming.element.tabIndex = 0;
      incoming.element.focus({ preventScroll: true });
    }
    updateSelection();
    if (previous.index !== index) {
      const direction = !explicit || index > previous.index ? 1 : -1;
      startTransition(incoming, direction, positions);
    } else {
      resetInactiveCases();
    }
    updateState();
    void prepareActive(explicit);
  }

  function navigateCases(event, index, controls) {
    const position = cases.findIndex(item => item.index === index);
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (position + 1) % cases.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (position - 1 + cases.length) % cases.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = cases.length - 1;
    else return;
    event.preventDefault();
    selectCase(cases[next].index);
    controls[next]?.focus({ preventScroll: true });
  }

  for (const dot of dots) {
    const index = Number(dot.dataset.f8Select);
    dot.addEventListener("click", () => selectCase(index));
    dot.addEventListener("keydown", event => navigateCases(event, index, dots));
  }

  for (const item of cases) {
    item.element.dataset.ready = "false";
    item.element.dataset.loading = "false";
    item.element.addEventListener("click", () => selectCase(item.index));
    item.element.addEventListener("keydown", event => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        selectCase(item.index);
        return;
      }
      navigateCases(event, item.index, cases.map(entry => entry.element));
    });

    for (const video of item.videos.values()) {
      mediaState.set(video, { ready: false, failed: false, promise: null, playRequested: false, playStarted: false, playToken: 0 });
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = false;
      video.controls = false;
      video.preload = "none";
      video.addEventListener("waiting", () => {
        if (item.index !== sample || !running || !phaseVideos().includes(video)) return;
        // Keep pending play requests alive; the media clock waits for recovery.
        mediaWaiting = true;
        setStatus("Loading case…");
        updateState();
      });
      const resumeBuffered = () => {
        if (item.index !== sample || !ready || !loading || !allBuffered(item)) return;
        clearBufferTimeout();
        loading = false;
        setStatus("");
        maybeStart();
      };
      video.addEventListener("canplay", resumeBuffered);
      video.addEventListener("seeked", resumeBuffered);
      video.addEventListener("error", () => {
        if (!item.ready) return;
        const state = mediaState.get(video);
        state.ready = false;
        state.failed = true;
        state.promise = null;
        markCaseFailed(item);
      });
    }
  }

  document.addEventListener("visibilitychange", maybeStart);
  window.addEventListener("pagehide", () => {
    stopClock();
    slideAnimations.forEach(animation => animation.pause());
  });
  window.addEventListener("pageshow", maybeStart);
  window.addEventListener("resize", maybeStart);
  reducedMotion.addEventListener("change", () => {
    wanted = !reducedMotion.matches;
    if (!wanted) {
      cancelTransition();
      resetInactiveCases();
      stopClock();
    }
    else if (ready) maybeStart();
    else void prepareActive();
  });

  updateSelection();
  updateState();
  if ("IntersectionObserver" in window) {
    const loadObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      approached = true;
      loadObserver.disconnect();
      void prepareActive();
    }, { rootMargin: "400px 0px" });
    loadObserver.observe(region);
    const playbackObserver = new IntersectionObserver(maybeStart, { threshold: [0, 0.05] });
    playbackObserver.observe(viewport);
  } else {
    approached = true;
    void prepareActive();
    window.addEventListener("scroll", maybeStart, { passive: true });
  }
})();
