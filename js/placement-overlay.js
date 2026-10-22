"use strict";

// A display annotation, anchored to the model's placement condition. Only the
// marker changes shape; the recorded scene and forecast remain untouched.
window.createPlacementOverlay = function createPlacementOverlay(canvas, data, intentionCard, remoteOcclusion) {
  if (!canvas || !data) return { sync() {} };
  const displayContext = canvas.getContext("2d");
  const markerCanvas = document.createElement("canvas");
  markerCanvas.width = markerCanvas.height = data.displaySize;
  const markerContext = markerCanvas.getContext("2d");
  let context = displayContext;
  const frames = new Map(data.frames.map(frame => [frame.stateIndex, frame]));
  const orange = [242, 140, 40];
  const masks = new Map();
  const foregroundMasks = new Map();
  for (const frame of remoteOcclusion?.frames || []) {
    if (!frame.mask) continue;
    const image = new Image();
    image.src = frame.mask.src;
    foregroundMasks.set(frame.stateIndex, { image, bounds: frame.mask });
  }
  for (const frame of data.frames) {
    if (!frame.occlusionMask) continue;
    const image = new Image();
    image.src = frame.occlusionMask.src;
    masks.set(frame.stateIndex, image);
  }
  canvas.width = data.displaySize;
  canvas.height = data.displaySize;
  let previousKey = "";
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  function path(points, close = true) {
    context.beginPath();
    points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
    if (close) context.closePath();
  }
  function silhouette(points) {
    const sorted = points.map(point => point.slice(0, 2))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = list => {
      const hull = [];
      for (const point of list) {
        while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
        hull.push(point);
      }
      return hull.slice(0, -1);
    };
    return [...half(sorted), ...half([...sorted].reverse())];
  }
  function render(frame, morph, connector, lineProgress, markerOpacity) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const vertices = frame.vertices.map((point, i) => [
      mix(data.flatVertices[i][0], point[0], morph),
      mix(data.flatVertices[i][1], point[1], morph),
      point[2],
    ]);
    const apex = [mix(data.point2D[0], frame.apex[0], morph),
      mix(data.point2D[1], frame.apex[1], morph)];

    // Grow a dashed path from the actual coordinate token, top to bottom.
    // Sample its arc length so the drawing speed stays even along the curve.
    if (connector && morph < 1 && lineProgress > 0) {
      const { x, y, scale } = connector;
      const dy = apex[1] - y;
      const control1 = [x, y + dy * .45];
      const control2 = [apex[0], apex[1] - dy * .3];
      const curve = Array.from({ length: 81 }, (_, i) => {
        const t = i / 80, u = 1 - t;
        return [u ** 3 * x + 3 * u ** 2 * t * control1[0]
          + 3 * u * t ** 2 * control2[0] + t ** 3 * apex[0],
        u ** 3 * y + 3 * u ** 2 * t * control1[1]
          + 3 * u * t ** 2 * control2[1] + t ** 3 * apex[1]];
      });
      const lengths = [0];
      for (let i = 1; i < curve.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]));
      }
      const distance = lengths.at(-1) * lineProgress;
      const drawn = [curve[0]];
      for (let i = 1; i < curve.length; i++) {
        if (lengths[i] <= distance) drawn.push(curve[i]);
        else {
          const t = (distance - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
          drawn.push(curve[i].map((value, axis) => mix(curve[i - 1][axis], value, t)));
          break;
        }
      }
      context.save();
      context.globalAlpha = .78 * (1 - morph) ** 2;
      path(drawn, false);
      context.strokeStyle = "#f2d2ac";
      context.lineWidth = scale;
      context.lineCap = "round";
      context.setLineDash([3.5 * scale, 5 * scale]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(x, y, 1.6 * scale, 0, Math.PI * 2);
      context.fillStyle = "#f2d2ac";
      context.fill();
      context.restore();
    }

    if (markerOpacity <= 0) return;
    // Compose the marker at full opacity, then fade the complete layer once.
    // Shared mesh edges must not accumulate opacity during the initial reveal.
    context = markerContext;
    context.clearRect(0, 0, markerCanvas.width, markerCanvas.height);
    context.save();

    // A subtle ring lies on the real support plane, rather than a screen-space
    // ellipse. It gains depth together with the cone during the scene bridge.
    if (morph > 0 && frame.ring.length) {
      const ring = frame.ring.map(point => [
        mix(apex[0], point[0], morph), mix(apex[1], point[1], morph),
      ]);
      context.save();
      context.globalAlpha = morph;
      if (frame.supportPolygon?.length) {
        path(frame.supportPolygon);
        context.clip();
      }
      path(ring);
      context.fillStyle = "rgba(250,174,88,.10)";
      context.fill();
      context.strokeStyle = "rgba(250,174,88,.55)";
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }

    // Keep the same visible faces throughout the morph; changing face sets at
    // the endpoint causes an otherwise smooth cone to pop into its final look.
    const faces = frame.drawOrder ? frame.drawOrder.map(i => ({ indices: data.faces[i], i }))
      : data.faces.map((indices, i) => ({
      indices, i, depth: indices.reduce((sum, index) => sum + vertices[index][2], 0) / indices.length,
    })).sort((a, b) => b.depth - a.depth);
    // Cover subpixel gaps while the circular base is still almost flat.
    context.save();
    context.globalAlpha = 1 - morph;
    path(silhouette(vertices));
    context.fillStyle = `rgb(${orange.join(",")})`;
    context.fill();
    context.restore();
    for (const face of faces) {
      const rgb = data.colors[face.i].map((value, i) => Math.round(mix(orange[i], value, morph)));
      path(face.indices.map(i => vertices[i]));
      context.fillStyle = `rgb(${rgb.join(",")})`;
      context.fill();
      // Grow edge coverage continuously instead of adding it at the first
      // non-flat frame, when the cap's degenerate edges would form a ridge.
      if (morph > 0) {
        context.strokeStyle = context.fillStyle;
        context.lineWidth = .65 * morph;
        context.stroke();
      }
    }
    if (morph < 1) {
      context.save();
      context.globalAlpha = 1 - morph;
      // Trace the actual interpolated silhouette, never the old flat triangle.
      path(silhouette(vertices));
      context.strokeStyle = "#fff5e5";
      context.lineWidth = 2.5;
      context.lineJoin = "round";
      context.stroke();
      context.restore();
    }
    const mask = masks.get(frame.stateIndex);
    if (morph > 0 && mask?.complete && mask.naturalWidth > 0) {
      const { x, y, width, height } = frame.occlusionMask;
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.globalAlpha = morph;
      context.drawImage(mask, x, y, width, height);
      context.restore();
    }
    // The cone is an annotation: where it overlaps the visible remote body,
    // the remote stays in front even if the cone's tip-to-base geometry would
    // physically protrude through it. The saved motion is unchanged.
    const foreground = foregroundMasks.get(frame.stateIndex);
    if (morph > 0 && foreground?.image.complete && foreground.image.naturalWidth > 0) {
      const { x, y, width, height } = foreground.bounds;
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.globalAlpha = morph;
      context.drawImage(foreground.image, x, y, width, height);
      context.restore();
    }
    context.restore();
    context = displayContext;
    context.save();
    context.globalAlpha = markerOpacity;
    context.drawImage(markerCanvas, 0, 0);
    context.restore();
  }
  return {
    sync({ sampleId, frame, animationFrame = frame, reveal, bridgeStart,
      bridgeFrames, predictionStart, reduceMotion }) {
      const relevant = sampleId === data.id;
      const point = relevant && intentionCard?.querySelector('.predicted-intention-row[data-hand="right"] .intention-field[data-field="point"]');
      const showing = relevant && frame >= reveal.lineStart;
      canvas.hidden = !showing;
      if (!showing) {
        previousKey = "";
        canvas.style.opacity = "0";
        canvas.dataset.lineProgress = "0";
        canvas.dataset.markerOpacity = "0";
        return;
      }
      canvas.style.opacity = "1";
      const lineProgress = reduceMotion ? 1
        : ease((animationFrame - reveal.lineStart) / (reveal.lineEnd - reveal.lineStart - 1));
      const markerOpacity = frame < reveal.markerStart ? 0 : reduceMotion ? 1
        : ease((animationFrame - reveal.markerStart) / (reveal.markerEnd - reveal.markerStart - 1));
      const bridgeProgress = (animationFrame - bridgeStart) / (bridgeFrames - 1);
      const depthProgress = Math.max(0, Math.min(1, (bridgeProgress - .02) / .93));
      // Zero velocity and acceleration at both ends; unfold throughout the
      // scene bridge instead of finishing early and waiting for the background.
      const morph = reduceMotion ? (frame >= bridgeStart ? 1 : 0)
        : depthProgress ** 3 * (depthProgress * (depthProgress * 6 - 15) + 10);
      const stateIndex = frame < predictionStart ? 29
        : Math.min(54, 30 + frame - predictionStart);
      const source = frames.get(stateIndex);
      if (!source) return;
      canvas.dataset.stateIndex = String(stateIndex);
      canvas.dataset.morph = String(morph);
      canvas.dataset.absoluteFrame = String(source.absoluteFrame);
      canvas.dataset.lineProgress = String(lineProgress);
      canvas.dataset.markerOpacity = String(markerOpacity);
      let connector = null;
      if (morph < 1 && point && !intentionCard.hidden) {
        const target = point.getBoundingClientRect();
        const viewport = point.closest(".predicted-intention-fields").getBoundingClientRect();
        const bounds = canvas.getBoundingClientRect();
        if (bounds.width > 0 && target.left >= viewport.left - 1 && target.right <= viewport.right + 1) {
          const scale = data.displaySize / bounds.width;
          connector = { x: ((target.left + target.right) / 2 - bounds.left) * scale,
            y: (target.bottom + 2 - bounds.top) * scale, scale };
          canvas.dataset.connectorX = String(connector.x);
          canvas.dataset.connectorY = String(connector.y);
        }
      }
      const mask = masks.get(stateIndex);
      const foreground = foregroundMasks.get(stateIndex)?.image;
      const key = `${stateIndex}:${morph}:${lineProgress}:${markerOpacity}:${canvas.clientWidth}:${connector?.x}:${connector?.y}:${Boolean(mask?.complete && mask.naturalWidth)}:${Boolean(foreground?.complete && foreground.naturalWidth)}`;
      if (key === previousKey) return;
      previousKey = key;
      render(source, morph, connector, lineProgress, markerOpacity);
    },
  };
};
