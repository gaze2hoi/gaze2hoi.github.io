/* Figure 5: four examples, six methods, and one clock for the active row. */
(() => {
  "use strict";

  const region = document.querySelector("#qualitative-player");
  const rowContainer = region?.querySelector(".f5-rows");
  if (!region || !rowContainer) return;

  const methods = ["observed", "gt", "objectforesight", "cahmp", "transformer", "ours"];
  const rows = [...region.querySelectorAll("[data-f5-row]")].map(element => ({
    element,
    index: Number(element.dataset.f5Row),
    videos: new Map([...element.querySelectorAll("[data-f5-video]")].map(video => [video.dataset.f5Video, video])),
    ready: false,
    failed: false,
    loading: false,
    promise: null
  }));
  if (!rows.length) return;

  const status = region.querySelector("#f5-status, [data-f5-status]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mediaState = new WeakMap();
  const frameDuration = 1 / 30;
  const speed = 0.65;
  const startHold = 0.2;
  const endHold = 0.8;

  let sample = rows.some(row => row.index === Number(region.dataset.sample)) ? Number(region.dataset.sample) : rows[0].index;
  let approached = false;
  let wanted = !reducedMotion.matches;
  let ready = false;
  let loading = false;
  let mediaWaiting = false;
  let running = false;
  let timeline = 0;
  let holdRemaining = startHold;
  let holdKind = "start";
  let animationFrame = 0;
  let lastTimestamp = 0;
  let lastMediaSync = 0;
  let lastMediaPhase = "";
  let selectionGeneration = 0;
  let stalledSince = 0;
  let bufferTimeout = 0;

  const activeRow = () => rows.find(row => row.index === sample);
  const nextRow = row => rows[(rows.indexOf(row) + 1) % rows.length];
  const asset = (row, method, extension) => `media/figure5/replay/sample-${row.index + 1}/${method}.${extension}?v=alpha020`;
  const setStatus = message => {
    if (status && status.textContent !== message) status.textContent = message;
  };

  function updateState() {
    region.dataset.sample = String(sample);
    region.dataset.ready = String(ready);
    region.dataset.loading = String(loading || mediaWaiting);
    region.dataset.playing = String(running);
    region.dataset.time = timeline.toFixed(4);
    region.dataset.phase = timeline < 1 ? "observation" : "forecast";
  }

  function updateLayout() {
    const row = activeRow().element;
    rowContainer.style.setProperty("--f5-active-top", `${row.offsetTop}px`);
    rowContainer.style.setProperty("--f5-active-height", `${row.offsetHeight}px`);
  }

  function updateSelection() {
    for (const row of rows) {
      const selected = row.index === sample;
      row.element.dataset.active = String(selected);
      row.element.setAttribute("aria-pressed", String(selected));
    }
    updateLayout();
  }

  function pauseVideo(video) {
    const state = mediaState.get(video);
    state.playStarted = false;
    if (state.playRequested || !video.paused) {
      state.playRequested = false;
      state.playToken += 1;
      video.pause();
    }
  }

  function resetInactiveRows() {
    for (const row of rows) {
      if (row.index === sample) continue;
      for (const video of row.videos.values()) {
        pauseVideo(video);
        if (video.readyState >= 1 && video.currentTime !== 0) {
          try { video.currentTime = 0; } catch { /* A pending load will start at zero. */ }
        }
        video.dataset.f5Frame = "0";
      }
    }
  }

  function targetTime(method, video) {
    const duration = Number.isFinite(video.duration) ? video.duration : 1;
    const lastFrame = Math.max(0, Math.min(1, duration) - frameDuration);
    return Math.max(0, Math.min(lastFrame, method === "observed" ? timeline : timeline - 1));
  }

  function playbackProgress() {
    const row = activeRow();
    const phaseMethods = timeline < 1 ? ["observed"] : methods.slice(1);
    const videos = phaseMethods.map(method => row.videos.get(method));
    const lastFrame = video => Math.max(0, Math.min(1, video.duration || 1) - frameDuration);
    // A play request is not evidence of playback. In particular, cold decoders
    // may leave play() pending after the RGB clip has already finished.
    if (videos.some(video => !mediaState.get(video).playStarted || video.seeking ||
      video.readyState < 2 || (video.currentTime < lastFrame(video) - 0.001 &&
        (video.paused || video.readyState < 3)))) return null;
    return {
      time: Math.min(...videos.map(video => video.currentTime)),
      finished: videos.every(video => video.currentTime >= lastFrame(video) - 0.001)
    };
  }

  function syncMedia(exact = false) {
    const row = activeRow();
    const phaseReady = Boolean(playbackProgress());
    for (const [method, video] of row.videos) {
      if (!ready) {
        pauseVideo(video);
        continue;
      }
      const state = mediaState.get(video);
      const target = targetTime(method, video);
      const lastFrame = Math.max(0, Math.min(1, video.duration || 1) - frameDuration);
      const phaseActive = method === "observed" ? timeline < 1 : timeline >= 1;
      const shouldPlay = running && holdRemaining === 0 && phaseActive && target < lastFrame;
      if (!shouldPlay) pauseVideo(video);
      if (video.readyState < 2) continue;

      // Progress follows the slowest playing video. Never seek a stalled or
      // pending video forward to catch up with wall time: that can skip its
      // entire forecast. Only bring an already-playing leader back into sync.
      const difference = Math.abs(video.currentTime - target);
      if ((!shouldPlay && (exact || !video.seeking) && difference > 0.002) ||
        (shouldPlay && phaseReady && !video.seeking && video.currentTime - target > 0.1)) {
        try { video.currentTime = target; } catch { /* Metadata may still be settling. */ }
      }
      video.dataset.f5Frame = String(Math.min(29, Math.floor((target + 0.00001) * 30)));
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (state.playStarted && video.paused && !video.ended) {
        state.playRequested = false;
        state.playStarted = false;
      }
      if (!shouldPlay || state.playRequested) continue;

      state.playRequested = true;
      state.playStarted = false;
      const playToken = ++state.playToken;
      const generation = selectionGeneration;
      Promise.resolve(video.play()).then(() => {
        if (playToken !== state.playToken || generation !== selectionGeneration) return;
        state.playStarted = !video.paused;
        if (!state.playStarted) state.playRequested = false;
      }).catch(error => {
        if (playToken !== state.playToken || generation !== selectionGeneration) return;
        state.playRequested = false;
        state.playStarted = false;
        if (error.name === "NotAllowedError") {
          wanted = false;
          stopClock();
          setStatus("Select an example to play its comparison.");
        } else if (error.name !== "AbortError") {
          state.ready = false;
          state.failed = true;
          state.promise = null;
          markRowFailed(row);
        }
      });
    }
  }

  function stopClock() {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastTimestamp = 0;
    stalledSince = 0;
    mediaWaiting = false;
    syncMedia(true);
    updateState();
  }

  function isActiveRowVisible() {
    const bounds = activeRow().element.getBoundingClientRect();
    const width = Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left));
    const height = Math.max(0, Math.min(window.innerHeight, bounds.bottom) - Math.max(0, bounds.top));
    return bounds.width > 0 && bounds.height > 0 && width * height >= bounds.width * bounds.height * 0.05;
  }

  function allBuffered(row) {
    return methods.every(method => row.videos.get(method)?.readyState >= 3);
  }

  function clearBufferTimeout() {
    clearTimeout(bufferTimeout);
    bufferTimeout = 0;
  }

  function maybeStart() {
    if (!wanted || !ready || loading || document.hidden || !isActiveRowVisible()) {
      if (running) stopClock();
      else updateState();
      return;
    }
    if (running) return;
    if (!allBuffered(activeRow())) {
      loading = true;
      setStatus("Loading example…");
      updateState();
      if (!bufferTimeout) {
        const row = activeRow();
        bufferTimeout = setTimeout(() => {
          bufferTimeout = 0;
          if (loading && row.index === sample) markRowFailed(row);
        }, 12000);
      }
      return;
    }
    clearBufferTimeout();
    running = true;
    stalledSince = 0;
    lastTimestamp = 0;
    lastMediaPhase = "";
    syncMedia(true);
    updateState();
    animationFrame = requestAnimationFrame(tick);
  }

  function tick(timestamp) {
    if (!running) return;
    const elapsed = lastTimestamp ? Math.min(0.1, (timestamp - lastTimestamp) / 1000) : 0;
    lastTimestamp = timestamp;
    if (holdRemaining > 0) {
      holdRemaining = Math.max(0, holdRemaining - elapsed);
      if (holdRemaining === 0 && holdKind === "end") {
        if (reducedMotion.matches) {
          wanted = false;
          stopClock();
        } else {
          selectRow(nextRow(activeRow()).index, false);
        }
        return;
      }
      if (holdRemaining === 0) holdKind = "";
    } else {
      const progress = playbackProgress();
      const previousTime = timeline;
      if (progress?.finished) {
        if (timeline < 1) timeline = 1;
        else {
          timeline = 2;
          holdRemaining = endHold;
          holdKind = "end";
        }
      } else if (progress) {
        const start = timeline < 1 ? 0 : 1;
        timeline = Math.max(timeline, start + Math.min(1 - frameDuration, progress.time));
      }
      if (timeline > previousTime) {
        stalledSince = 0;
        if (mediaWaiting) { mediaWaiting = false; setStatus(""); }
      } else {
        if (!stalledSince) stalledSince = timestamp;
        if (timestamp - stalledSince > 250) {
          mediaWaiting = true;
          setStatus("Loading example…");
        }
        if (timestamp - stalledSince > 12000) {
          markRowFailed(activeRow());
          return;
        }
      }
    }
    const phase = `${timeline < 1 ? "observed" : "forecast"}:${holdRemaining > 0 ? holdKind : "play"}`;
    if (phase !== lastMediaPhase || timestamp - lastMediaSync >= 80) {
      syncMedia(phase !== lastMediaPhase);
      lastMediaPhase = phase;
      lastMediaSync = timestamp;
    }
    updateState();
    if (running) animationFrame = requestAnimationFrame(tick);
  }

  function markRowFailed(row) {
    row.ready = false;
    row.failed = true;
    row.loading = false;
    row.promise = null;
    row.element.dataset.ready = "false";
    row.element.dataset.loading = "false";
    if (row.index !== sample) return;
    clearBufferTimeout();
    ready = false;
    loading = false;
    stalledSince = 0;
    stopClock();
    setStatus("This example could not be loaded. Select its row to try again.");
  }

  function ensureVideo(row, method, retry) {
    const video = row.videos.get(method);
    if (!video) return Promise.resolve(false);
    const state = mediaState.get(video);
    if (state.ready && !video.error) return Promise.resolve(true);
    if (state.failed && retry) {
      state.promise = null;
      state.failed = false;
    }
    if (state.promise) return state.promise;
    if (state.failed) return Promise.resolve(false);

    const mp4Supported = video.canPlayType('video/mp4; codecs="avc1.42E01E"');
    const formats = mp4Supported ? ["mp4", "webm"] : ["webm", "mp4"];
    state.promise = new Promise(resolve => {
      let formatIndex = 0;
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
      function loadFormat() {
        clearTimeout(timeout);
        timeout = setTimeout(tryFallback, 20000);
        video.preload = "auto";
        const source = asset(row, method, formats[formatIndex]);
        if (video.getAttribute("src") !== source) video.src = source;
        video.load();
        check();
      }
      function tryFallback() {
        if (settled) return;
        formatIndex += 1;
        if (formatIndex < formats.length) loadFormat();
        else finish(false);
      }
      video.addEventListener("canplay", check);
      video.addEventListener("loadeddata", check);
      video.addEventListener("error", tryFallback);
      loadFormat();
    });
    return state.promise;
  }

  function prepareRow(row, retry = false) {
    if (row.ready) return Promise.resolve(true);
    if (row.promise) return row.promise;
    if (row.failed && !retry) return Promise.resolve(false);
    if (row.failed && retry) {
      // A playback timeout also invalidates the earlier successful preload.
      // An explicit retry must reload the clips, not reuse stalled decoders.
      for (const video of row.videos.values()) {
        const state = mediaState.get(video);
        state.ready = false;
        state.failed = false;
        state.promise = null;
      }
    }
    row.failed = false;
    row.loading = true;
    row.element.dataset.loading = "true";
    row.promise = Promise.all(methods.map(method => ensureVideo(row, method, retry))).then(results => {
      row.loading = false;
      row.ready = results.every(Boolean);
      row.failed = !row.ready;
      row.element.dataset.ready = String(row.ready);
      row.element.dataset.loading = "false";
      row.promise = null;
      return row.ready;
    });
    return row.promise;
  }

  async function prepareActive(retry = false) {
    if (!approached) return;
    const row = activeRow();
    const generation = selectionGeneration;
    loading = !row.ready;
    ready = row.ready;
    if (loading) setStatus("Loading example…");
    updateState();
    const success = await prepareRow(row, retry);
    if (generation !== selectionGeneration || row.index !== sample) return;
    ready = success;
    loading = false;
    if (!success) {
      markRowFailed(row);
      return;
    }
    setStatus("");
    syncMedia(true);
    maybeStart();
    updateState();
    // Cache only the upcoming row. Loading never calls play on an inactive row.
    void prepareRow(nextRow(row));
  }

  function selectRow(index, explicit = true) {
    if (!rows.some(row => row.index === index)) return;
    clearBufferTimeout();
    stopClock();
    selectionGeneration += 1;
    sample = index;
    timeline = 0;
    holdRemaining = startHold;
    holdKind = "start";
    ready = false;
    loading = false;
    if (explicit) {
      wanted = true;
      approached = true;
    }
    updateSelection();
    resetInactiveRows();
    updateState();
    void prepareActive(explicit);
  }

  function handleNavigation(event, index, controls) {
    let next;
    const position = rows.findIndex(row => row.index === index);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (position + 1) % rows.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (position - 1 + rows.length) % rows.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else return;
    event.preventDefault();
    controls[next]?.focus({ preventScroll: true });
    selectRow(rows[next].index);
  }

  for (const row of rows) {
    row.element.dataset.ready = "false";
    row.element.dataset.loading = "false";
    row.element.addEventListener("click", () => selectRow(row.index));
    row.element.addEventListener("keydown", event => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        selectRow(row.index);
      } else {
        handleNavigation(event, row.index, rows.map(item => item.element));
      }
    });
    for (const [method, video] of row.videos) {
      mediaState.set(video, { ready: false, failed: false, promise: null, playRequested: false, playStarted: false, playToken: 0 });
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "none";
      video.controls = false;
      // The lazy image beneath the video supplies its still frame without
      // eagerly requesting all 24 video posters at the top of the page.
      video.addEventListener("waiting", () => {
        if (row.index !== sample || !running) return;
        // Keep polling actual media progress through decoding and seek stalls.
        // Pausing here would cancel pending play promises and could deadlock.
        updateState();
      });
      const resumeBuffered = () => {
        if (row.index !== sample || !ready || !loading || !allBuffered(row)) return;
        clearBufferTimeout();
        loading = false;
        setStatus("");
        maybeStart();
      };
      video.addEventListener("canplay", resumeBuffered);
      video.addEventListener("seeked", resumeBuffered);
      video.addEventListener("error", () => {
        if (!row.ready) return;
        const state = mediaState.get(video);
        state.ready = false;
        state.failed = true;
        state.promise = null;
        markRowFailed(row);
      });
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopClock();
    else maybeStart();
  });
  window.addEventListener("pagehide", stopClock);
  window.addEventListener("pageshow", maybeStart);
  reducedMotion.addEventListener("change", () => {
    wanted = !reducedMotion.matches;
    if (wanted) maybeStart();
    else stopClock();
  });
  window.addEventListener("resize", () => {
    updateLayout();
    maybeStart();
  });
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(rowContainer);
    rows.forEach(row => resizeObserver.observe(row.element));
  }

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
    rows.forEach(row => playbackObserver.observe(row.element));
  } else {
    approached = true;
    void prepareActive();
    window.addEventListener("scroll", maybeStart, { passive: true });
  }
})();
