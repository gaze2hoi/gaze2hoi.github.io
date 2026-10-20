"use strict";

(() => {
  const figure = document.querySelector(".dataset-figure");
  const artwork = figure?.querySelector(".f3-artwork");
  if (!artwork) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let callouts = [];
  let values = [];
  let mapping;
  let frame = 0;
  let ready = false;

  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => {
    const progress = clamp(value);
    return progress * progress * (3 - 2 * progress);
  };

  function paint() {
    frame = 0;
    if (!ready) return;
    const bounds = artwork.getBoundingClientRect();
    const viewport = document.documentElement.clientHeight;
    const scrollProgress = (startY, endY, startViewport, endViewport) => {
      const start = viewport * startViewport - bounds.height * startY;
      const end = viewport * endViewport - bounds.height * endY;
      return reducedMotion.matches ? 1 : clamp((start - bounds.top) / (start - end));
    };
    const annotationProgress = scrollProgress(.30, .58, .88, .64);
    // Reveal values over the same interval as their labels.
    const firstLabelStart = .70 * .80;
    const lastLabelEnd = .80 + (callouts.length - 1) * .025;
    const intentionProgress = ease((annotationProgress - firstLabelStart) / (lastLabelEnd - firstLabelStart));

    // Each line starts at its object marker; its label waits for the complete
    // line. The small stagger follows the labels from top to bottom.
    callouts.forEach(({ element, paths, dot, label }, index) => {
      const progress = clamp((annotationProgress - index * .025) / .80);
      const drawing = ease((progress - .42) / .28);
      paths.forEach(({ path, length }) => {
        path.style.strokeDashoffset = String(length * (1 - drawing));
        path.style.opacity = drawing > 0 ? "1" : "0";
      });
      dot.style.opacity = ease((progress - .42) / .05).toFixed(4);
      label.style.opacity = ease((progress - .70) / .30).toFixed(4);
      element.dataset.lineProgress = drawing.toFixed(4);
      element.dataset.labelProgress = label.style.opacity;
    });
    mapping.style.opacity = ease((annotationProgress - .84) / .16).toFixed(4);

    // Table structure and field names remain visible. Only their values fade in.
    for (const element of values) {
      element.style.opacity = intentionProgress.toFixed(4);
    }
    figure.dataset.annotationsProgress = annotationProgress.toFixed(4);
    figure.dataset.intentionProgress = intentionProgress.toFixed(4);
  }

  function schedule() {
    if (!frame && ready) frame = window.requestAnimationFrame(paint);
  }

  function connect() {
    const svg = artwork.contentDocument?.documentElement;
    if (!svg || svg.localName !== "svg") {
      artwork.style.visibility = "";
      return;
    }
    const elements = [...svg.querySelectorAll("[data-callout]")];
    const intentionValues = [...svg.querySelectorAll("[data-intention-value]")];
    mapping = svg.querySelector('[data-scroll-reveal="mapping"]');
    if (!elements.length || !intentionValues.length || !mapping) {
      artwork.style.visibility = "";
      return;
    }
    callouts = elements.map(element => {
      const label = element.querySelector("[data-callout-label]");
      const paths = [...element.querySelectorAll("[data-leader-path]")].map(path => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length} ${length}`;
        return { path, length };
      });
      return { element, paths, label, dot:element.querySelector("[data-leader-dot]") };
    }).sort((a, b) => a.label.getBBox().y - b.label.getBBox().y);
    values = intentionValues;
    // Match the section explicitly: an external SVG document can paint its
    // transparent canvas white. The standalone SVG retains its own gradient.
    const surface = getComputedStyle(figure.closest("section")).backgroundColor;
    svg.style.backgroundColor = surface;
    const background = svg.querySelector("[data-figure-background]");
    if (background) background.style.fill = surface;
    ready = true;
    paint();
    artwork.style.visibility = "";
    figure.dataset.revealReady = "true";
  }

  // Prepare the reveal before exposing the embedded document, avoiding a flash
  // of the complete annotations during initial loading. No change without JS.
  artwork.style.visibility = "hidden";
  artwork.addEventListener("load", connect);
  artwork.addEventListener("error", () => { artwork.style.visibility = ""; });
  if (artwork.contentDocument?.readyState === "complete"
      && artwork.contentDocument.documentElement?.localName === "svg") connect();
  window.addEventListener("scroll", schedule, { passive:true });
  window.addEventListener("resize", schedule, { passive:true });
  window.addEventListener("pageshow", schedule);
  reducedMotion.addEventListener("change", schedule);
  new ResizeObserver(schedule).observe(artwork);
})();
