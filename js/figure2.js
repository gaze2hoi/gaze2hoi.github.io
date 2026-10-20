"use strict";

(() => {
  const diagram = document.querySelector("#idea-animation");
  if (!diagram) return;

  // Incoming arrows and their destination modules activate together.
  // Durations include the fade and time to read the module.
  const stages = [
    { label:"Observed history", title:"One second of observations.", duration:2000 },
    { label:"Semantic ambiguity", title:"What to interact with?", duration:2200 },
    { label:"Temporal Gaze Saliency Modulation", title:"Gaze helps reveal intention.", duration:2500 },
    { label:"Geometric ambiguity", title:"The intended interaction still admits multiple contact configurations.", duration:2500 },
    { label:"Anticipatory Contact Grounding", title:"From intention to likely contact.", duration:2200 },
    { label:"Joint motion forecasting", title:"Hands and objects, together.", duration:6200 },
  ];
  const starts = stages.map((_, index) => stages.slice(0, index).reduce((sum, stage) => sum + stage.duration, 0));
  const duration = stages.reduce((sum, stage) => sum + stage.duration, 0);
  const finalStep = stages.length - 1;
  const phases = [...diagram.querySelectorAll("[data-phase]")];
  const dialog = diagram.querySelector(".f2-dialog");
  const board = diagram.querySelector(".f2-board");
  const scroll = diagram.querySelector(".f2-scroll");
  const expandButton = diagram.querySelector(".f2-expand");
  const playButton = diagram.querySelector(".f2-play");
  const stageLabel = diagram.querySelector("#f2-stage-label");
  const stageTitle = diagram.querySelector("#f2-stage-title");
  const headingCopy = diagram.querySelector(".f2-heading-copy");
  const counter = diagram.querySelector("#f2-count");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const forecast = diagram.querySelector(".f2-forecast");
  const forecastCanvas = diagram.querySelector(".f2-forecast-image");
  const forecastContext = forecastCanvas.getContext("2d");
  const forecastStates = [...diagram.querySelectorAll("[data-forecast-state]")];
  const targetCircle = diagram.querySelector(".f2-target-circle");
  const zoomLines = diagram.querySelector(".f2-zoom-lines");
  const zoomInset = diagram.querySelector(".f2-zoom-inset");
  const forecastOutput = diagram.querySelector(".f2-output-row");
  const trajectory = diagram.querySelector(".f2-trajectory-line");
  const trajectoryTip = diagram.querySelector(".f2-trajectory-tip");
  const trajectoryLength = trajectory.getTotalLength();
  const trajectoryEnd = trajectory.getPointAtLength(trajectoryLength);
  const trajectoryBeforeEnd = trajectory.getPointAtLength(trajectoryLength - .5);
  const trajectoryEndAngle = Math.atan2(trajectoryEnd.y - trajectoryBeforeEnd.y, trajectoryEnd.x - trajectoryBeforeEnd.x);
  const forecastTiming = { handStarts:[0, 600, 980, 1360], handFade:300, initialArrowProgress:.18, arrowDuration:1000, circleStart:1710, circleFade:220, connectorsStart:1930, connectorsReveal:650, insetStart:2330, insetReveal:600 };
  let canvasKey = "";
  let lastTrajectoryProgress = -1;
  let lastZoomProgress = -1;
  let expanded = false;
  let savedPlayback = null;
  let savedOverflow = "";
  let visible = false;
  let ready = false;
  let paused = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let activeStep = -1;

  function setStep(index) {
    if (activeStep === index) return;
    activeStep = index;
    diagram.dataset.step = String(index);
    stageLabel.textContent = stages[index].label;
    stageTitle.textContent = stages[index].title;
    counter.textContent = String(index + 1).padStart(2, "0");
    // Intentions and geometric ambiguity share a step, as do incoming arrows and modules.
    // The final module has its own registered-render sequence below.
    phases.forEach(phase => phase.classList.toggle("is-visible", Number(phase.dataset.phase) <= index));
  }

  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => { const p = clamp(value); return p * p * (3 - 2 * p); };

  function paintHeading(complete = false) {
    const age = elapsed - starts[activeStep];
    // Fade the old wording out before the boundary, then ease the new wording in.
    // The shared playback clock keeps this transition still while paused.
    const opacity = complete ? 1 : Math.min(ease(age / 500), ease((stages[activeStep].duration - age) / 220));
    headingCopy.style.opacity = opacity.toFixed(4);
  }

  function paintForecast(complete = false) {
    const age = activeStep === finalStep ? Math.max(0, elapsed - starts[finalStep]) : 0;
    // The first pose is part of the initial scene and shares its parent fade.
    let state = 1;
    let blend = 1;
    if (complete) { state = 4; blend = 1; }
    else forecastTiming.handStarts.forEach((start, index) => {
      if (index > 0 && age >= start) { state = index + 1; blend = ease((age - start) / forecastTiming.handFade); }
    });

    const nextKey = `${state}:${blend.toFixed(4)}`;
    if (ready && nextKey !== canvasKey && forecastContext && forecastStates.every(img => img.naturalWidth)) {
      const width = forecastStates[0].naturalWidth;
      const height = forecastStates[0].naturalHeight;
      if (forecastCanvas.width !== width || forecastCanvas.height !== height) {
        forecastCanvas.width = width;
        forecastCanvas.height = height;
      }
      forecastContext.clearRect(0, 0, width, height);
      forecastContext.globalCompositeOperation = "source-over";
      forecastContext.globalAlpha = 1;
      if (!state || blend === 1) forecastContext.drawImage(forecastStates[state], 0, 0);
      else {
        // Interpolate premultiplied colors and alpha, so the fixed scene and
        // already visible translucent hands never double up during a reveal.
        forecastContext.globalAlpha = 1 - blend;
        forecastContext.drawImage(forecastStates[state - 1], 0, 0);
        forecastContext.globalCompositeOperation = "lighter";
        forecastContext.globalAlpha = blend;
        forecastContext.drawImage(forecastStates[state], 0, 0);
        forecastContext.globalCompositeOperation = "source-over";
        forecastContext.globalAlpha = 1;
      }
      canvasKey = nextKey;
    }
    forecast.dataset.handState = String(state);
    forecast.dataset.handBlend = blend.toFixed(4);

    const circle = complete ? 1 : ease((age - forecastTiming.circleStart) / forecastTiming.circleFade);
    const connectors = complete ? 1 : ease((age - forecastTiming.connectorsStart) / forecastTiming.connectorsReveal);
    const inset = complete ? 1 : ease((age - forecastTiming.insetStart) / forecastTiming.insetReveal);
    targetCircle.style.opacity = circle.toFixed(4);
    zoomInset.style.opacity = inset.toFixed(4);
    if (connectors !== lastZoomProgress) {
      // Only the connectors sweep from the small circle toward the inset.
      // The whole inset starts fading in as the connectors approach it, without clipping.
      const edge = 14 - 35 * connectors;
      zoomLines.style.opacity = connectors > 0 ? "1" : "0";
      zoomLines.style.clipPath = connectors === 1 ? "none" : edge >= 0
        ? `polygon(${edge}% 0,100% 0,100% ${100 - edge}%)`
        : `polygon(0 0,100% 0,100% 100%,${100 + edge}% 100%,0 ${-edge}%)`;
      forecast.dataset.zoomProgress = connectors.toFixed(4);
      lastZoomProgress = connectors;
    }
    const motionStart = forecastTiming.handStarts[1];
    const motionEnd = forecastTiming.handStarts[3] + forecastTiming.handFade;
    const motionProgress = complete ? 1 : ease((age - motionStart) / (motionEnd - motionStart));
    forecastOutput.style.opacity = motionProgress.toFixed(4);
    const arrowProgress = complete ? 1 : ease((age - motionStart) / forecastTiming.arrowDuration);
    const progress = forecastTiming.initialArrowProgress + (1 - forecastTiming.initialArrowProgress) * arrowProgress;
    if (progress !== lastTrajectoryProgress) {
      trajectory.style.strokeDashoffset = String(1 - progress);
      trajectoryTip.style.opacity = String(Math.min(1, progress * 24));
      const length = trajectoryLength * progress;
      const point = trajectory.getPointAtLength(length);
      const before = trajectory.getPointAtLength(Math.max(0, length - .5));
      const after = trajectory.getPointAtLength(Math.min(trajectoryLength, length + .5));
      const angle = (Math.atan2(after.y - before.y, after.x - before.x) - trajectoryEndAngle) * 180 / Math.PI;
      trajectoryTip.setAttribute("transform", `translate(${point.x} ${point.y}) rotate(${angle}) translate(${-trajectoryEnd.x} ${-trajectoryEnd.y})`);
      forecast.dataset.trajectoryProgress = progress.toFixed(4);
      lastTrajectoryProgress = progress;
    }
  }

  function paint() {
    if (reducedMotion.matches) {
      setStep(finalStep);
      stageLabel.textContent = "Hierarchical intention disambiguation";
      stageTitle.textContent = "From observations to a grounded forecast.";
      paintHeading(true);
      paintForecast(true);
      return;
    }
    let index = finalStep;
    while (index > 0 && elapsed < starts[index]) index--;
    setStep(index);
    paintHeading(expanded);
    paintForecast(expanded);
  }

  function shouldRun() {
    return (visible || expanded) && ready && !paused && !document.hidden && !reducedMotion.matches;
  }

  function tick(now) {
    frame = 0;
    if (!shouldRun()) { lastTime = 0; return; }
    if (lastTime) elapsed = (elapsed + Math.min(now - lastTime, 100)) % duration;
    lastTime = now;
    paint();
    frame = window.requestAnimationFrame(tick);
  }

  function updatePlayback() {
    if (shouldRun()) {
      if (!frame) { lastTime = 0; frame = window.requestAnimationFrame(tick); }
    } else {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    }
  }

  function updatePlayButton() {
    diagram.dataset.paused = String(paused);
    playButton.setAttribute("aria-pressed", String(paused));
    playButton.setAttribute("aria-label", paused ? "Play diagram animation" : "Pause diagram animation");
    playButton.title = paused ? "Play animation" : "Pause animation";
  }
  playButton.addEventListener("click", () => {
    paused = !paused;
    updatePlayButton();
    updatePlayback();
  });

  // Expanded inspection preserves the source composition, then restores the
  // ongoing presentation, including the reader's pause preference, on close.
  expandButton.addEventListener("click", () => {
    savedPlayback = { elapsed, paused };
    savedOverflow = document.body.style.overflow;
    board.style.height = `${board.getBoundingClientRect().height}px`;
    diagram.querySelector(".f2-dialog-body").append(scroll);
    expanded = true;
    elapsed = starts[finalStep] + stages[finalStep].duration - 1;
    paused = true;
    paint();
    updatePlayButton();
    updatePlayback();
    document.body.style.overflow = "hidden";
    dialog.showModal();
  });
  diagram.querySelector(".f2-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    board.append(scroll);
    board.style.height = "";
    document.body.style.overflow = savedOverflow;
    expanded = false;
    if (savedPlayback) ({ elapsed, paused } = savedPlayback);
    savedPlayback = null;
    paint();
    updatePlayButton();
    updatePlayback();
    expandButton.focus({ preventScroll:true });
  });

  const preload = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    preload.disconnect();
    const images = [...diagram.querySelectorAll("img")];
    images.forEach(image => { image.loading = "eager"; });
    Promise.allSettled(images.map(image => image.decode())).then(() => {
      ready = true;
      diagram.dataset.ready = "true";
      paint();
      updatePlayback();
    });
  }, { rootMargin:"400px" });
  preload.observe(diagram);

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
    updatePlayback();
  }, { threshold:[0, .15] }).observe(diagram);
  document.addEventListener("visibilitychange", updatePlayback);
  function updateMotionPreference() {
    diagram.dataset.reduced = String(reducedMotion.matches);
    // Repaint the heading as well when the preference changes in either direction.
    activeStep = -1;
    paint();
    updatePlayback();
  }
  reducedMotion.addEventListener("change", updateMotionPreference);
  updateMotionPreference();
})();
