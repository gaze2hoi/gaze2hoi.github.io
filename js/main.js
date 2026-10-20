"use strict";

const overviewCopy = document.querySelector(".overview-text");
const overviewParagraph = overviewCopy.querySelector("p");
const overviewAlignmentTarget = document.querySelector(".demo-examples button");
let overviewAlignmentFrame = 0;

function alignOverviewCopy() {
  overviewAlignmentFrame = 0;
  overviewCopy.style.removeProperty("--overview-copy-shift");
  overviewCopy.style.removeProperty("--overview-copy-nudge");
  if (!window.matchMedia("(min-width:961px)").matches) return;

  // Measure the natural lines, excluding the empty width of the block-level span.
  const textNodes = document.createTreeWalker(overviewParagraph, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let textNode;
  let textRight = overviewParagraph.getBoundingClientRect().left;
  while ((textNode = textNodes.nextNode())) {
    range.selectNodeContents(textNode);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0) textRight = Math.max(textRight, rect.right);
    }
  }
  const shift = overviewAlignmentTarget.getBoundingClientRect().right - textRight;
  // The CSS removes only unused width so the existing line breaks stay intact.
  overviewCopy.style.setProperty("--overview-copy-shift", `${shift}px`);
  overviewCopy.style.setProperty("--overview-copy-nudge", "16px");
}

window.addEventListener("resize", () => {
  if (!overviewAlignmentFrame) {
    overviewAlignmentFrame = window.requestAnimationFrame(alignOverviewCopy);
  }
});
document.fonts.ready.then(alignOverviewCopy);
alignOverviewCopy();

const copyButton = document.querySelector("#copy-citation");
const copyStatus = document.querySelector("#copy-status");
let resetCopyTimer;

copyButton.addEventListener("click", async () => {
  const text = document.querySelector("#bibtex").textContent.trim();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      copyButton.focus();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    copyButton.textContent = "Copied ✓";
    copyStatus.textContent = "Citation copied to clipboard.";
  } catch {
    copyButton.textContent = "Select citation below";
    copyStatus.textContent = "Clipboard unavailable. Select and copy the citation below.";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#bibtex"));
    selection.removeAllRanges();
    selection.addRange(range);
  }
  clearTimeout(resetCopyTimer);
  resetCopyTimer = setTimeout(() => { copyButton.textContent = "Copy citation ⧉"; }, 3500);
});

const heroVideo = document.querySelector("#hero-video");
const heroDemo = document.querySelector(".hero-demo");
const heroVisualFrame = document.querySelector(".hero-demo .video-frame");
const heroReveal = document.querySelector("#observation-reveal");
const heroFreeze = document.querySelector("#observed-freeze");
const heroHighlights = document.querySelector("#object-highlights");
const heroQuestion = document.querySelector("#intention-question");
const heroGaze = document.querySelector("#gaze-replay-overlay");
const heroGazeDot = document.querySelector("#gaze-replay-dot");
const heroHistory = document.querySelector("#tgsm-history-overlay");
const heroBridge = document.querySelector("#geometry-bridge");
const heroBridgeFull = document.querySelector("#geometry-bridge-scene");
const heroBridgeForeground = document.querySelector("#geometry-bridge-foreground");
const heroIntention = document.querySelector("#predicted-intention");
const heroIntentionRows = document.querySelector("#predicted-intention-rows");
const exampleButtons = [...document.querySelectorAll("[data-example]")];
const heroTimeline = window.GAZE2HOI_HERO;
const heroObjects = window.GAZE2HOI_OBJECTS;
const heroGazeData = window.GAZE2HOI_GAZE_REPLAY;
const heroHistoryData = window.GAZE2HOI_TGSM_HISTORY;
const heroIntentions = heroTimeline.examples.map(example =>
  window.GAZE2HOI_INTENTIONS.examples.find(item => item.id === example.id)
);
const heroGazeExamples = heroTimeline.examples.map(example =>
  heroGazeData.examples.find(item => item.id === example.id)
);
const reduceHeroMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const exampleDuration = heroTimeline.framesPerExample / heroTimeline.fps;
// Reuse identical RGB hold frames: 24 frames retain the full 1.5 s reading
// pause; the next 24 provide a separate 1 s bridge before any forecast moves.
const geometryBridgeFrames = 24;
const geometryBridgeStart = heroTimeline.predictionStart - geometryBridgeFrames;
const historyReadingFrames = geometryBridgeStart - heroTimeline.historyStart - heroTimeline.historyBuildFrames;
// Put Down uses its held RGB frames for a sequential explanation: read the
// intention, trace the coordinate to its target, reveal the marker, then pause.
const putDownPlacementReveal = {
  intentionReady: heroTimeline.intentionStart + heroTimeline.intentionFadeFrames,
  lineStart: 193, lineEnd: 201, markerStart: 201, markerEnd: 205,
  holdSeconds: 3,
};
const placementOverlay = window.createPlacementOverlay(
  document.querySelector("#placement-overlay"), window.GAZE2HOI_PLACEMENT, heroIntention,
  window.GAZE2HOI_REMOTE_OCCLUSION
);
heroVideo.defaultPlaybackRate = .75;
heroVideo.playbackRate = .75;
let displayedExample = -1;
let pendingExample = null;
let sampleSwitchToken = 0;
let sampleSwitchAnimation = null;
let intentionLayoutPending = true;
const intentionMeasure = document.createElement("canvas").getContext("2d");

heroGaze.setAttribute("viewBox", `0 0 ${heroGazeData.displaySize} ${heroGazeData.displaySize}`);
heroGaze.querySelector(".gaze-dot-outline").setAttribute("r", heroGazeData.marker.outerRadius);
heroGaze.querySelector(".gaze-dot-outline").setAttribute("fill", heroGazeData.marker.outline);
heroGaze.querySelector(".gaze-dot-core").setAttribute("r", heroGazeData.marker.innerRadius);
heroGaze.querySelector(".gaze-dot-core").setAttribute("fill", heroGazeData.marker.fill);

// All history points share the final observed camera pose and a fixed [0, 1] scale.
// TGSM takes a pixelwise maximum of fixation/recency-weighted Gaussians, not a sum.
const historyGridSize = heroHistoryData.gridSize;
const heroHistoryField = new Float32Array(historyGridSize ** 2);
const heroHistoryScenes = heroTimeline.examples.map(example => {
  const annotation = heroHistoryData.examples.find(item => item.id === example.id);
  const prefixes = [new Float32Array(historyGridSize ** 2)];
  const ratio = historyGridSize / heroHistoryData.displaySize;
  const denominator = 2 * (heroHistoryData.sigmaPx * ratio) ** 2;
  for (const sourceIndex of annotation.validIndices) {
    const [px, py] = annotation.points[sourceIndex].map(value => value * ratio);
    const next = new Float32Array(prefixes[prefixes.length - 1]);
    for (let y = 0; y < historyGridSize; y++) {
      for (let x = 0; x < historyGridSize; x++) {
        const distance = (x + .5 - px) ** 2 + (y + .5 - py) ** 2;
        const value = annotation.amplitudes[sourceIndex] * Math.exp(-distance / denominator);
        const cell = y * historyGridSize + x;
        next[cell] = Math.max(next[cell], value);
      }
    }
    prefixes.push(next);
  }
  return { annotation, prefixes };
});
const heroHistoryContext = heroHistory.getContext("2d");
const heroHistoryPixels = heroHistoryContext.createImageData(heroHistory.width, heroHistory.height);
// Upsample the scalar field before applying the paper's palette, so blob edges stay smooth.
const historySampleAxis = Array.from({ length: heroHistory.width }, (_, pixel) => {
  const position = Math.max(0, Math.min(historyGridSize - 1,
    (pixel + .5) * historyGridSize / heroHistory.width - .5));
  const lower = Math.floor(position);
  return { lower, upper: Math.min(lower + 1, historyGridSize - 1), blend: position - lower };
});
let renderedHistoryKey = "";

function paintHistoryField() {
  const palette = heroHistoryData.palette.rgbaLut;
  const pixels = heroHistoryPixels.data;
  let offset = 0;
  for (const sy of historySampleAxis) {
    const top = sy.lower * historyGridSize, bottom = sy.upper * historyGridSize;
    for (const sx of historySampleAxis) {
      const a = heroHistoryField[top + sx.lower] * (1 - sx.blend)
        + heroHistoryField[top + sx.upper] * sx.blend;
      const b = heroHistoryField[bottom + sx.lower] * (1 - sx.blend)
        + heroHistoryField[bottom + sx.upper] * sx.blend;
      const value = Math.max(0, Math.min(1, a * (1 - sy.blend) + b * sy.blend));
      const color = palette[Math.round(value * (palette.length - 1))];
      pixels[offset++] = color[0];
      pixels[offset++] = color[1];
      pixels[offset++] = color[2];
      pixels[offset++] = color[3];
    }
  }
  heroHistoryContext.putImageData(heroHistoryPixels, 0, 0);
}

function syncHistoryReveal(index, frame) {
  const showing = frame >= heroTimeline.historyStart && frame < heroTimeline.predictionStart;
  heroHistory.hidden = !showing;
  if (!showing) {
    if (renderedHistoryKey) {
      renderedHistoryKey = "";
      heroHistoryField.fill(0);
      heroHistoryContext.clearRect(0, 0, heroHistory.width, heroHistory.height);
      heroHistory.dataset.progress = "0";
      heroHistory.dataset.visibleCount = "0";
      delete heroHistory.dataset.sourceFrame;
    }
    return;
  }
  const progress = reduceHeroMotion ? 1 : Math.min(1,
    (frame - heroTimeline.historyStart + 1) / heroTimeline.historyBuildFrames);
  const key = `${index}:${progress}`;
  if (renderedHistoryKey === key) return;
  renderedHistoryKey = key;
  const { annotation, prefixes } = heroHistoryScenes[index];
  // Invalid/offscreen points have no animation slots; start at the first visible sample.
  const count = annotation.validIndices.length;
  const revealed = progress * count;
  const complete = Math.floor(revealed);
  const before = prefixes[complete], after = prefixes[Math.min(complete + 1, count)];
  const blend = revealed - complete;
  for (let cell = 0; cell < heroHistoryField.length; cell++) {
    heroHistoryField[cell] = before[cell] + (after[cell] - before[cell]) * blend;
  }
  heroHistory.dataset.progress = String(progress);
  heroHistory.dataset.visibleCount = String(Math.ceil(revealed));
  const sourceIndex = annotation.validIndices[Math.max(0, Math.ceil(revealed) - 1)];
  heroHistory.dataset.sourceFrame = sourceIndex === undefined ? "" : String(annotation.frames[sourceIndex]);
  paintHistoryField();
}

// The freeze and all object cutouts use the exact final observed RGB frame.
const heroStillImages = heroTimeline.examples.map(example => {
  const image = new Image();
  image.src = example.still;
  return image;
});

// These are real state[29] renders in camera[29], aligned to the held RGB.
// They represent the observed state, not a fabricated/interpolated forecast.
const heroBridgeScenes = heroTimeline.examples.map(example => {
  const source = window.GAZE2HOI_BRIDGE.examples.find(item => item.id === example.id);
  const full = new Image(), foreground = new Image();
  full.src = source.fullScene;
  foreground.src = source.objectsForeground || source.foreground;
  return { full, foreground, source };
});

function heroSvgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

const heroClipDefinitions = heroSvgElement("defs");
const heroShade = heroSvgElement("rect", {
  width: heroTimeline.displaySize, height: heroTimeline.displaySize, fill: "#05070e", opacity: 0,
});
heroHighlights.setAttribute("viewBox", `0 0 ${heroTimeline.displaySize} ${heroTimeline.displaySize}`);
heroHighlights.append(heroClipDefinitions, heroShade);
const heroObjectScenes = heroTimeline.examples.map((example, sceneIndex) => {
  const annotation = heroObjects.examples.find(item => item.id === example.id);
  const scene = heroSvgElement("g", { "data-scene": example.id, display: "none" });
  // Annotation paths include observed hand/object occlusion and preserve holes.
  // Their order is far to near, so the mild enlargement keeps foreground objects in front.
  const objects = annotation.objects.map((object, objectIndex) => {
    const clipId = `hero-object-${sceneIndex}-${objectIndex}`;
    const clip = heroSvgElement("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
    clip.append(heroSvgElement("path", { d: object.path, "clip-rule": "evenodd" }));
    heroClipDefinitions.append(clip);
    const group = heroSvgElement("g", { "data-object": object.category, opacity: 0 });
    group.append(
      heroSvgElement("image", {
        href: example.still, width: heroTimeline.displaySize, height: heroTimeline.displaySize,
        "clip-path": `url(#${clipId})`,
      }),
      heroSvgElement("path", {
        d: object.path, fill: "none", "fill-rule": "evenodd", stroke: "#ffffff",
        "stroke-width": 4.2, "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-opacity": .92,
      })
    );
    scene.append(group);
    return {
      group,
      center: object.center,
      scale: 1 + Math.min(.10, 28 / Math.max(object.bbox[2], object.bbox[3])),
    };
  });
  heroHighlights.append(scene);
  return { scene, objects };
});

function revealEase(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  return 1 - (1 - clamped) ** 3;
}

function transitionEase(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value * value * (3 - 2 * value);
}

function syncIntentionReveal(index, frame) {
  const frozen = frame >= heroTimeline.observedEnd && frame < heroTimeline.gazeReplayStart;
  const revealing = frozen && frame >= heroTimeline.revealStart;
  const questioning = frozen && frame >= heroTimeline.questionStart;
  const showingHistory = frame >= heroTimeline.historyStart && frame < heroTimeline.predictionStart;
  heroFreeze.hidden = !(frozen || showingHistory);
  heroHighlights.toggleAttribute("hidden", !revealing);
  heroQuestion.hidden = !questioning;
  const replayTransition = frozen && frame >= heroTimeline.replayTransitionStart;
  const replayProgress = replayTransition ? (frame - heroTimeline.replayTransitionStart)
    / (heroTimeline.gazeReplayStart - heroTimeline.replayTransitionStart - 1) : 0;
  const refocusing = replayTransition && !reduceHeroMotion;
  const replayBlur = refocusing ? Math.sin(Math.PI * replayProgress) * 1.6 : 0;
  heroReveal.style.opacity = String(refocusing ? 1 - transitionEase(replayProgress) : 1);
  heroReveal.style.filter = replayBlur > .001 ? `blur(${replayBlur}cqw)` : "none";
  heroVideo.style.filter = heroReveal.style.filter;
  if (revealing) {
    const elapsed = frame - heroTimeline.revealStart;
    heroShade.setAttribute("opacity", String(.34 * (reduceHeroMotion ? 1 : revealEase(elapsed / 10))));
    heroObjectScenes[index].objects.forEach((object, order) => {
      const progress = reduceHeroMotion ? 1 : revealEase((elapsed - order * 1.2) / 9);
      const scale = 1 + (object.scale - 1) * progress;
      const [cx, cy] = object.center;
      object.group.setAttribute("opacity", String(progress));
      object.group.setAttribute("transform", `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`);
    });
  }
  const questionProgress = questioning
    ? (reduceHeroMotion ? 1 : revealEase((frame - heroTimeline.questionStart) / 7)) : 0;
  const questionExit = replayTransition && !reduceHeroMotion
    ? 1 - transitionEase(replayProgress * 2) : 1;
  heroQuestion.style.opacity = String(questionProgress * questionExit);
  heroQuestion.style.transform = `translateY(${8 * (1 - questionProgress)}px)`;
}

function syncGazeReplay(index, frame) {
  const replaying = frame >= heroTimeline.gazeReplayStart && frame < heroTimeline.historyStart;
  const gazeFrame = replaying ? frame - heroTimeline.gazeReplayStart : -1;
  const point = replaying ? heroGazeExamples[index].points[gazeFrame] : null;
  heroGaze.dataset.frame = String(gazeFrame);
  heroGaze.toggleAttribute("hidden", !point);
  if (point) {
    // Each gaze sample is projected into that same RGB frame's camera pose.
    // No final-frame reprojection, synthetic interpolation or smoothing.
    heroGazeDot.setAttribute("transform", `translate(${point[0]} ${point[1]})`);
  } else {
    heroGazeDot.removeAttribute("transform");
  }
}

function syncPredictedIntention(frame) {
  const start = heroTimeline.intentionStart;
  const showing = frame >= start;
  const fadeFrames = heroTimeline.intentionFadeFrames;
  const opacity = showing ? (reduceHeroMotion ? 1 : revealEase((frame - start) / fadeFrames)) : 0;
  heroIntention.hidden = !showing;
  if (showing && intentionLayoutPending) fitIntentionRows();
  heroIntention.style.opacity = String(opacity);
  heroIntention.style.transform = `translateY(${5 * (1 - opacity)}px)`;
}

function syncGeometryBridge(index, frame) {
  const scene = heroBridgeScenes[index];
  const ready = scene.full.complete && scene.full.naturalWidth > 0
    && scene.foreground.complete && scene.foreground.naturalWidth > 0;
  const showing = ready && frame >= geometryBridgeStart && frame < heroTimeline.predictionStart;
  heroBridge.hidden = !showing;
  const animationFrame = heroVideo.paused || heroTimeline.examples[index].id !== "put-down" ? frame
    : heroVideo.currentTime * heroTimeline.fps - index * heroTimeline.framesPerExample;
  const progress = showing ? Math.max(0, Math.min(1,
    (animationFrame - geometryBridgeStart) / (geometryBridgeFrames - 1))) : 0;
  const geometry = showing ? (reduceHeroMotion ? 1 : transitionEase((progress - .05) / .5)) : 0;
  const background = showing ? (reduceHeroMotion ? 1 : transitionEase((progress - .35) / .6)) : 0;
  heroBridgeForeground.style.opacity = String(geometry);
  heroBridgeFull.style.opacity = String(background);
  heroHistory.style.opacity = String(showing
    ? (reduceHeroMotion ? 0 : 1 - transitionEase(progress / .28)) : 1);
  heroBridge.dataset.progress = String(progress);
}

function fitIntentionRows() {
  if (heroIntention.hidden) return;
  for (const row of heroIntentionRows.children) {
    const fields = row.querySelector(".predicted-intention-fields");
    const tokens = [...fields.querySelectorAll(".intention-field")];
    if (!tokens.length) continue;
    const available = fields.clientWidth - 1;
    if (available <= 0) return;
    const style = getComputedStyle(row);
    const size = parseFloat(style.fontSize);
    intentionMeasure.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    const widths = tokens.map(token => intentionMeasure.measureText(token.textContent).width);
    const separatorWidth = intentionMeasure.measureText("·").width + .6 * size;
    const lineWidth = values => values.reduce((sum, width) => sum + width, 0)
      + Math.max(0, values.length - 1) * separatorWidth;
    const widest = lineWidth(widths);
    // Fit one complete line on desktop. On very narrow screens preserve a
    // readable 10 px minimum and allow that same line to scroll horizontally.
    fields.style.fontSize = `${Math.max(10, size * Math.min(1, available / (widest + .5)))}px`;
    const line = document.createElement("span");
    line.className = "intention-line";
    tokens.forEach((token, index) => {
      if (index) {
        const separator = document.createElement("span");
        separator.className = "intention-field-separator";
        separator.textContent = "·";
        separator.setAttribute("aria-hidden", "true");
        line.append(separator);
      }
      line.append(token);
    });
    fields.replaceChildren(line);
    fields.classList.remove("is-scrollable");
    const scrollable = fields.scrollWidth > fields.clientWidth + 1;
    fields.classList.toggle("is-scrollable", scrollable);
    fields.tabIndex = scrollable ? 0 : -1;
    if (scrollable) fields.setAttribute("aria-label", `${row.querySelector(".predicted-intention-hand").textContent} intention; scroll horizontally for all fields`);
    else fields.removeAttribute("aria-label");
  }
  intentionLayoutPending = false;
}

let intentionLayoutWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0].contentRect.width;
  if (Math.abs(width - intentionLayoutWidth) < .1) return;
  intentionLayoutWidth = width;
  intentionLayoutPending = true;
  fitIntentionRows();
}).observe(heroVisualFrame);
document.fonts.ready.then(() => {
  intentionLayoutPending = true;
  fitIntentionRows();
});

function syncPlacementOverlay(index, frame) {
  const animationFrame = heroVideo.paused ? frame
    : heroVideo.currentTime * heroTimeline.fps - index * heroTimeline.framesPerExample;
  placementOverlay.sync({
    sampleId: heroTimeline.examples[index].id, frame, animationFrame,
    reveal: putDownPlacementReveal,
    bridgeStart: geometryBridgeStart, bridgeFrames: geometryBridgeFrames,
    predictionStart: heroTimeline.predictionStart, reduceMotion: reduceHeroMotion,
  });
}

function syncHeroPlayback(time = heroVideo.currentTime, presentedFrame = false) {
  // WebM timestamps use milliseconds; round decoded-frame PTS to its 30 fps index.
  const framePosition = time * heroTimeline.fps;
  const masterFrame = Math.max(0, Math.min(
    heroTimeline.framesPerExample * exampleButtons.length - 1,
    presentedFrame ? Math.round(framePosition) : Math.floor(framePosition + 0.0001)
  ));
  const index = Math.floor(masterFrame / heroTimeline.framesPerExample);
  const frame = masterFrame % heroTimeline.framesPerExample;
  const readingSeconds = heroTimeline.examples[index].id === "put-down"
    ? putDownPlacementReveal.holdSeconds : 1.5;
  const playbackRate = frame >= heroTimeline.sampleFadeOutStart ? .8
    : frame >= heroTimeline.predictionEnd ? 1.6
    : frame >= heroTimeline.predictionStart ? (heroTimeline.examples[index].id === "move" ? .75 : .6)
    : frame >= geometryBridgeStart ? geometryBridgeFrames / heroTimeline.fps
    : frame >= heroTimeline.historyStart + heroTimeline.historyBuildFrames ? historyReadingFrames / (heroTimeline.fps * readingSeconds)
    : frame >= heroTimeline.historyStart ? .8 : .75;
  if (heroVideo.playbackRate !== playbackRate) heroVideo.playbackRate = playbackRate;
  const stage = frame < heroTimeline.observedStart ? "sample-in"
    : frame < heroTimeline.observedEnd ? "observed"
    : frame < heroTimeline.revealStart ? "settle"
    : frame < heroTimeline.questionStart ? "objects"
    : frame < heroTimeline.replayTransitionStart ? "question"
    : frame < heroTimeline.gazeReplayStart ? "replay-transition"
    : frame < heroTimeline.historyStart ? "gaze-replay"
    : frame < heroTimeline.historyStart + heroTimeline.historyBuildFrames ? "tgsm-history"
    : frame < geometryBridgeStart ? "history-hold"
    : frame < heroTimeline.predictionStart ? "geometry-bridge"
    : frame < heroTimeline.predictionEnd ? "predicted"
    : frame < heroTimeline.sampleFadeOutStart ? "prediction-hold" : "sample-out";
  if (index !== displayedExample) {
    displayedExample = index;
    exampleButtons.forEach((button, buttonIndex) => {
      button.setAttribute("aria-pressed", String(buttonIndex === index));
    });
    const selected = exampleButtons[index];
    heroVideo.dataset.scene = selected.dataset.example;
    heroDemo.dataset.scene = selected.dataset.example;
    heroFreeze.src = heroStillImages[index].src;
    heroBridgeFull.src = heroBridgeScenes[index].full.src;
    heroBridgeForeground.src = heroBridgeScenes[index].foreground.src;
    heroBridge.dataset.referenceFrame = String(heroBridgeScenes[index].source.referenceFrame);
    // Display the non-null model fields directly, without composing a new sentence.
    heroIntentionRows.replaceChildren(...["left", "right"].map(side => {
      const item = heroIntentions[index].rows.find(row => row.hand === side);
      const row = document.createElement("div");
      row.className = "predicted-intention-row";
      row.dataset.hand = side;
      const hand = document.createElement("span");
      hand.className = "predicted-intention-hand";
      hand.textContent = side === "left" ? "Left hand" : "Right hand";
      const fields = document.createElement("p");
      fields.className = "predicted-intention-fields";
      if (!item || !item.fields.length) {
        fields.classList.add("intention-empty");
        fields.textContent = "<No intention>";
      }
      (item?.fields || []).forEach(field => {
        const value = Array.isArray(field.value) ? `[${field.value.join(", ")}]` : field.value;
        const token = document.createElement("span");
        token.className = "intention-field";
        token.dataset.field = field.key;
        token.title = field.label;
        token.setAttribute("aria-label", `${field.label}: ${value}`);
        token.textContent = value;
        fields.append(token);
      });
      row.append(hand, fields);
      return row;
    }));
    intentionLayoutPending = true;
    heroVideo.setAttribute("aria-label", `${selected.querySelector(".demo-label").textContent}: observed RGB, possible interactions on the last observed frame, RGB replay with gaze, progressive TGSM history, the last observed scene revealed in 3D, then predicted interaction`);
    heroObjectScenes.forEach((item, sceneIndex) => {
      item.scene.setAttribute("display", sceneIndex === index ? "inline" : "none");
    });
  }
  heroVideo.dataset.phase = frame < heroTimeline.predictionStart ? "observed" : "predicted";
  heroDemo.dataset.phase = heroVideo.dataset.phase;
  heroDemo.dataset.stage = stage;
  let sceneOpacity = 1;
  if (!reduceHeroMotion && frame < heroTimeline.observedStart) {
    sceneOpacity = transitionEase(frame / (heroTimeline.sampleTransitionFrames - 1));
  } else if (!reduceHeroMotion && frame >= heroTimeline.sampleFadeOutStart) {
    sceneOpacity = 1 - transitionEase((frame - heroTimeline.sampleFadeOutStart)
      / (heroTimeline.sampleTransitionFrames - 1));
  }
  heroVisualFrame.style.opacity = String(sceneOpacity);
  syncIntentionReveal(index, frame);
  syncGazeReplay(index, frame);
  syncHistoryReveal(index, frame);
  syncGeometryBridge(index, frame);
  syncPredictedIntention(frame);
  syncPlacementOverlay(index, frame);
}

function seekExample(index) {
  pendingExample = null;
  syncHeroPlayback(index * exampleDuration);
  const targetTime = index * exampleDuration;
  if (!heroVideo.seeking && Math.abs(heroVideo.currentTime - targetTime) < .0001) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    heroVideo.addEventListener("seeked", resolve, { once: true });
    heroVideo.currentTime = targetTime;
  });
}

async function playExample(index) {
  const token = ++sampleSwitchToken;
  pendingExample = index;
  if (heroVideo.readyState < 1) {
    syncHeroPlayback(index * exampleDuration);
    return;
  }
  const opacity = Number(getComputedStyle(heroVisualFrame).opacity);
  sampleSwitchAnimation?.cancel();
  sampleSwitchAnimation = null;
  heroVideo.pause();
  if (!reduceHeroMotion && opacity > .001) {
    sampleSwitchAnimation = heroVisualFrame.animate([{ opacity }, { opacity: 0 }], {
      duration: 180, easing: "ease-in-out", fill: "forwards",
    });
    await sampleSwitchAnimation.finished.catch(() => {});
    if (token !== sampleSwitchToken) return;
  }
  await seekExample(index);
  if (token !== sampleSwitchToken) return;
  sampleSwitchAnimation?.cancel();
  sampleSwitchAnimation = null;
  heroVideo.play().catch(() => {});
}

exampleButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    playExample(index);
  });
});

heroVideo.addEventListener("loadedmetadata", () => {
  if (pendingExample !== null) playExample(pendingExample);
  else syncHeroPlayback();
});
heroVideo.addEventListener("seeking", () => syncHeroPlayback());
heroVideo.addEventListener("seeked", () => syncHeroPlayback());
if ("requestVideoFrameCallback" in heroVideo) {
  const syncFrame = (_now, metadata) => {
    if (!heroVideo.seeking && Math.abs(metadata.mediaTime - heroVideo.currentTime) < .2) {
      syncHeroPlayback(metadata.mediaTime, true);
    }
    heroVideo.requestVideoFrameCallback(syncFrame);
  };
  heroVideo.requestVideoFrameCallback(syncFrame);
  // Drive the coordinate path, marker, and RGB-to-3D bridge at display refresh
  // rate independently of the slower, identical held video frames.
  const syncPlacementDrawing = () => {
    if (!heroVideo.paused && !heroVideo.seeking && !reduceHeroMotion) {
      const position = heroVideo.currentTime * heroTimeline.fps;
      const index = Math.floor(position / heroTimeline.framesPerExample);
      const frame = Math.floor(position % heroTimeline.framesPerExample);
      if (index === displayedExample && heroTimeline.examples[index]?.id === "put-down"
        && frame >= putDownPlacementReveal.lineStart && frame < heroTimeline.predictionStart
        && (frame < geometryBridgeStart || heroDemo.dataset.stage === "geometry-bridge")) {
        if (frame >= geometryBridgeStart) syncGeometryBridge(index, frame);
        syncPlacementOverlay(index, frame);
      }
    }
    window.requestAnimationFrame(syncPlacementDrawing);
  };
  window.requestAnimationFrame(syncPlacementDrawing);
} else {
  const syncFrame = () => {
    if (!heroVideo.seeking) syncHeroPlayback();
    window.requestAnimationFrame(syncFrame);
  };
  window.requestAnimationFrame(syncFrame);
}
syncHeroPlayback();

const siteHeader = document.querySelector(".site-header");
const navigation = siteHeader.querySelector("nav");
const navigationIndicator = navigation.querySelector(".nav-indicator");
const navigationItems = [...document.querySelectorAll(".site-header nav a")]
  .map(link => ({ link, section: document.querySelector(link.getAttribute("href")) }))
  .filter(item => item.section);
let navigationFrame = 0;
let navigationSettleTimer = 0;
let pendingNavigationSection = null;
let displayedNavigationSection;
let navigationLayoutDirty = true;

function getActiveNavigationSection() {
  const activationLine = siteHeader.offsetHeight + 48;
  let activeSection = null;
  for (const { section } of navigationItems) {
    if (section.getBoundingClientRect().top <= activationLine) activeSection = section;
  }
  // The last section may be too short to reach the activation line at page end.
  const atPageBottom = window.scrollY > 0
    && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  if (atPageBottom && navigationItems.length) {
    activeSection = navigationItems[navigationItems.length - 1].section;
  }
  return activeSection;
}

function updateActiveNavigation() {
  // Keep a clicked destination selected while smooth scrolling crosses other sections.
  const activeSection = pendingNavigationSection || getActiveNavigationSection();
  const selectionChanged = activeSection !== displayedNavigationSection;
  if (!selectionChanged && !navigationLayoutDirty) return;

  if (selectionChanged) {
    for (const { link, section } of navigationItems) {
      if (section === activeSection) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    displayedNavigationSection = activeSection;
  }
  navigationLayoutDirty = false;
  const activeLink = navigationItems.find(item => item.section === activeSection)?.link;
  if (activeLink && activeLink.offsetWidth) {
    navigationIndicator.hidden = false;
    const linkBounds = activeLink.getBoundingClientRect();
    const navigationBounds = navigation.getBoundingClientRect();
    const offset = linkBounds.left - navigationBounds.left
      + (linkBounds.width - navigationIndicator.offsetWidth) / 2;
    navigationIndicator.style.transform = `translateX(${offset}px)`;
    navigationIndicator.classList.add("is-visible");
  } else {
    navigationIndicator.classList.remove("is-visible");
    // A stale desktop offset can widen the page even while the marker is transparent.
    navigationIndicator.hidden = true;
    navigationIndicator.style.transform = "translateX(0)";
  }
}

function scheduleNavigationUpdate() {
  if (navigationFrame) return;
  navigationFrame = window.requestAnimationFrame(() => {
    navigationFrame = 0;
    updateActiveNavigation();
  });
}

function releaseNavigationTarget() {
  clearTimeout(navigationSettleTimer);
  pendingNavigationSection = null;
  scheduleNavigationUpdate();
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const destination = navigationItems.find(item => item.link === link);
  if (!destination) {
    releaseNavigationTarget();
    return;
  }
  clearTimeout(navigationSettleTimer);
  pendingNavigationSection = destination.section;
  updateActiveNavigation();
  // Also release when the destination is already in place and no scroll event fires.
  navigationSettleTimer = setTimeout(releaseNavigationTarget, 200);
});

window.addEventListener("scroll", () => {
  scheduleNavigationUpdate();
  if (pendingNavigationSection) {
    clearTimeout(navigationSettleTimer);
    navigationSettleTimer = setTimeout(releaseNavigationTarget, 160);
  }
}, { passive: true });

// Manual input takes control immediately, including interruption of an anchor jump.
function interruptNavigationScroll() {
  if (pendingNavigationSection) {
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
  }
  releaseNavigationTarget();
}

window.addEventListener("wheel", interruptNavigationScroll, { passive: true });
window.addEventListener("touchstart", interruptNavigationScroll, { passive: true });
window.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
    interruptNavigationScroll();
  }
});
window.addEventListener("popstate", () => {
  if (pendingNavigationSection && location.hash === `#${pendingNavigationSection.id}`) return;
  releaseNavigationTarget();
});
window.addEventListener("resize", () => {
  navigationLayoutDirty = true;
  releaseNavigationTarget();
});
window.addEventListener("load", () => {
  navigationLayoutDirty = true;
  scheduleNavigationUpdate();
});
updateActiveNavigation();
