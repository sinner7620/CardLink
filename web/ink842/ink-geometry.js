import {erasePath} from './ink-eraser.js';
export const PAGE_WIDTH = 1000;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

// Split actual line segments at the eraser boundary, including segments whose
// endpoints both lie outside the eraser. Pressure is interpolated at cuts.
export function eraseCircle(strokes, styles, center, radius) {
  const output = [], outputStyles = [];
  let changed = false;
  const inside = p => Math.hypot(p[0] - center[0], p[1] - center[1]) < radius;
  strokes.forEach((stroke, index) => {
    if (stroke.length === 1) {
      if (inside(stroke[0])) changed = true;
      else { output.push(stroke); outputStyles.push(styles[index] || null); }
      return;
    }
    let run = [];
    const finish = () => { if (run.length) { output.push(run); outputStyles.push(styles[index] || null); run = []; } };
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const ox = a[0] - center[0], oy = a[1] - center[1];
      const A = dx * dx + dy * dy;
      let cuts = [0, 1];
      if (A > 1e-12) {
        const B = 2 * (ox * dx + oy * dy), C = ox * ox + oy * oy - radius * radius;
        const discriminant = B * B - 4 * A * C;
        if (discriminant > 0) {
          for (const t of [(-B - Math.sqrt(discriminant)) / (2 * A), (-B + Math.sqrt(discriminant)) / (2 * A)]) {
            if (t > 0 && t < 1) cuts.push(t);
          }
        }
      }
      cuts.sort((x, y) => x - y);
      for (let j = 1; j < cuts.length; j++) {
        const from = cuts[j - 1], to = cuts[j];
        if (inside(mix(a, b, (from + to) / 2))) { changed = true; finish(); continue; }
        const start = mix(a, b, from), end = mix(a, b, to);
        if (run.length && !close(run[run.length - 1], start)) finish();
        if (!run.length) run.push(start);
        if (!close(run[run.length - 1], end)) run.push(end);
      }
    }
    finish();
  });
  return { strokes: changed ? output : strokes, styles: changed ? outputStyles : styles, changed };
}

export function zoomAt(view, nextZoom, anchor) {
  const zoom = clamp(nextZoom, .5, 4), ratio = zoom / view.zoom;
  return { zoom, x: anchor[0] - (anchor[0] - view.x) * ratio, y: anchor[1] - (anchor[1] - view.y) * ratio };
}

export function constrainView(view, width, height, pageHeight, gutter = 0) {
  const fit = width / PAGE_WIDTH, zoom = clamp(view.zoom, .5, 4);
  const paperWidth = width * zoom;
  const center=(width-paperWidth)/2;
  return { zoom, x: paperWidth < width ? clamp(view.x,center-gutter,center+gutter) : clamp(view.x, width - paperWidth-gutter, gutter), y: clamp(view.y, Math.min(0, height - pageHeight * fit * zoom)-gutter, gutter) };
}

export function rejectPalm(event, penActive, lastPen, now) {
  // Hover and a cooldown after pen-up must not disable intentional gestures.
  return event.pointerType === 'touch' && penActive;
}

// Require a quick, dense zigzag and an actual intersection with older ink.
// A normal crossing-out line or a long waveform remains ordinary handwriting.
export function scribbleErase(strokes, styles, points, elapsed, index, scale = 1) {
  if (elapsed > 1600 || points.length < 5) return null;
  const [x, y] = points[0];
  let farthest = 0, axisX = 0, axisY = 0;
  for (const p of points) {
    const distance = Math.hypot(p[0] - x, p[1] - y);
    if (distance > farthest) { farthest = distance; axisX = (p[0] - x) / distance; axisY = (p[1] - y) / distance; }
  }
  if (farthest * scale < 10) return null;
  let min = 0, max = 0, crossMin = 0, crossMax = 0;
  let turns = 0, direction = 0, extreme = 0, travel = 0, previous = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i][0] - x) * scale, dy = (points[i][1] - y) * scale;
    const along = dx * axisX + dy * axisY, across = dy * axisX - dx * axisY;
    min = Math.min(min, along); max = Math.max(max, along);
    crossMin = Math.min(crossMin, across); crossMax = Math.max(crossMax, across);
    travel += Math.abs(along - previous); previous = along;
    const delta = along - extreme;
    if (direction && delta * direction >= 0) extreme = along;
    else if (Math.abs(delta) >= 7) {
      if (direction) turns++;
      direction = Math.sign(delta); extreme = along;
    }
  }
  const span = max - min;
  if (turns < 3 || travel < span * 3 || span > 240 || crossMax - crossMin > Math.min(100, span)) return null;
  return erasePath(strokes, styles, points, 8 / scale, {index,wholeStroke:true});
}
