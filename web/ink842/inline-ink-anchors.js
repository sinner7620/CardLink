const selector = 'img,canvas[data-drawing],.katex-display,p,li,pre,table,blockquote,h1,h2,h3,h4,.text-block,.html-block';

export function inlineContentAt(card, event, contentSelector) {
  const direct = event.target?.closest?.(contentSelector);
  if (direct && card.contains(direct)) return direct;
  const layers = document.elementsFromPoint
    ? document.elementsFromPoint(event.clientX, event.clientY)
    : [document.elementFromPoint?.(event.clientX, event.clientY)];
  for (const layer of layers) {
    const element = layer?.closest?.(contentSelector);
    if (element && card.contains(element) && !element.closest('.cardlink-answer-ink-tools')) return element;
  }
}

function contentKey(element) {
  const mediaId = element.dataset.mediaId || element.dataset.drawingId;
  if (mediaId) return element.tagName + ':' + mediaId;
  if (element.tagName === 'IMG') return 'IMG';
  let hash = 2166136261;
  for (const character of element.textContent.trim()) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return element.tagName + ':' + (hash >>> 0).toString(16);
}

export function createInlineInkAnchors(card) {
  let keys = new Map(), elements = new Map();
  function scan() {
    keys = new Map();
    elements = new Map();
    const counts = new Map();
    for (const element of card.querySelectorAll(selector)) {
      if (element.closest('.cardlink-answer-ink-tools')) continue;
      const base = contentKey(element);
      const occurrence = (counts.get(base) || 0) + 1;
      counts.set(base, occurrence);
      const key = base + ':' + occurrence;
      keys.set(element, key);
      elements.set(key, element);
    }
  }

  function measure(element, root, width) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !root.width) return null;
    const scale = width / root.width;
    return [(rect.left - root.left) * scale, (rect.top - root.top) * scale, rect.width * scale, rect.height * scale];
  }

  return {
    at(event, width) {
      if (!keys.size) scan();
      const target = inlineContentAt(card, event, selector);
      if (!target || !keys.has(target)) return undefined;
      const rect = measure(target, card.getBoundingClientRect(), width);
      return rect ? { key: keys.get(target), rect } : undefined;
    },
    layout(width) {
      const root = card.getBoundingClientRect();
      const boxes = new Map();
      return key => {
        if (!boxes.has(key)) {
          if (!keys.size || (elements.has(key) && !elements.get(key).isConnected)) scan();
          const element = elements.get(key);
          boxes.set(key, element ? measure(element, root, width) : null);
        }
        return boxes.get(key);
      };
    },
    snapshot(width) {
      scan();
      const root = card.getBoundingClientRect();
      const boxes = new Map();
      for (const [key, element] of elements) {
        const rect = measure(element, root, width);
        if (rect) boxes.set(key, rect);
      }
      return boxes;
    },
  };
}

export function projectInlineInk(points, style, boxFor) {
  if (!style?.anchor) return null;
  const { key, rect: from } = style.anchor;
  const to = boxFor(key);
  if (!to || from.every((value, i) => Math.abs(value - to[i]) < .05)) return null;
  const sx = to[2] / from[2], sy = to[3] / from[3];
  return {
    points: points.map(([x,y,...pen]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy, ...pen]),
    style: { ...style, anchor: { key, rect: to },
      ...(style.inputScale ? { inputScale: style.inputScale / sx } : { size: style.size * sx }) },
  };
}
