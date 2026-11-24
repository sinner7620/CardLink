// The content stays in normal WebView layout. Only the nearby ink bitmaps are
// allocated, at the density of the display and its current page zoom.
export function createInlineInkTiles(card) {
  const tiles = new Map();
  let grid = '';

  function release(canvas) {
    if (!canvas) return;
    canvas.width = canvas.height = 1;
    canvas.remove();
  }

  function clear() {
    for (const tile of tiles.values()) { release(tile.dry); release(tile.wet); release(tile.highlight); }
    tiles.clear();
  }

  function update(width, height, pageWidth) {
    const rect = card.getBoundingClientRect(), visual = window.visualViewport;
    if (!width || !height || !rect.width || !rect.height) return [];
    const sx = rect.width / width, sy = rect.height / height;
    const zoom = visual?.scale || 1;
    const density = Math.min(8, Math.ceil((window.devicePixelRatio || 1) * zoom * Math.max(sx, sy) * 2) / 2);
    const size = Math.floor(768 / density), margin = 96 / zoom;
    const offsetX = visual?.offsetLeft || 0, offsetY = visual?.offsetTop || 0;
    const visibleWidth = visual?.width || window.innerWidth;
    const visibleHeight = visual?.height || window.innerHeight;
    // During native pinch, the host can report its scroll movement as a
    // visual offset while the card rect already reflects that movement.
    // Cover the layout viewport as well so the offset cannot exclude ink.
    const left = (Math.min(0, offsetX) - rect.left) / sx;
    const top = (Math.min(0, offsetY) - rect.top) / sy;
    const right = (visibleWidth * Math.max(1, zoom) - rect.left) / sx;
    const bottom = (visibleHeight * Math.max(1, zoom) - rect.top) / sy;
    const gridKey = [width, height, pageWidth, density].join(':');
    if (grid !== gridKey) { clear(); grid = gridKey; }
    const current = new Set();
    const cssScale = width / pageWidth;
    for (let y = Math.floor(Math.max(0, top - margin) / size) * size; y < Math.min(height, bottom + margin); y += size) {
      for (let x = Math.floor(Math.max(0, left - margin) / size) * size; x < Math.min(width, right + margin); x += size) {
        const key = x + ':' + y;
        current.add(key);
        if (tiles.has(key)) continue;
        const w = Math.min(size, width - x), h = Math.min(size, height - y);
        tiles.set(key, { x, y, w, h, density, cssScale, dirty: true,
          bounds: { minX:x/cssScale, minY:y/cssScale, maxX:(x+w)/cssScale, maxY:(y+h)/cssScale } });
      }
    }
    for (const [key, tile] of tiles) if (!current.has(key)) {
      release(tile.dry); release(tile.wet); release(tile.highlight); tiles.delete(key);
    }
    return [...tiles.values()];
  }

  function context(tile, layer, reset) {
    let canvas = tile[layer];
    if (!canvas) {
      canvas = tile[layer] = document.createElement('canvas');
      canvas.className = 'ink-tile ink-' + layer;
      canvas.dataset.html2canvasIgnore = '';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { left:tile.x+'px', top:tile.y+'px', width:tile.w+'px', height:tile.h+'px' });
      canvas.width = Math.ceil(tile.w * tile.density);
      canvas.height = Math.ceil(tile.h * tile.density);
      card.append(canvas);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (reset) {
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    const rx = canvas.width / tile.w, ry = canvas.height / tile.h;
    ctx.setTransform(rx*tile.cssScale,0,0,ry*tile.cssScale,-tile.x*rx,-tile.y*ry);
    return ctx;
  }

  return { update, context, clear, drop(tile, layer) { release(tile[layer]); tile[layer] = undefined; } };
}
