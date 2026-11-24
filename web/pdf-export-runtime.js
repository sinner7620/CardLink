(function () {
  "use strict";

  var CHUNK_SIZE = 65536;
  var started = false;
  var notified = false;
  var pdfBytes = null;
  var cancelled = false;
  var activeFrame = null;
  var pdfPreviewPages = [];
  var readiness;
  var readinessStarted = false;
  var runtimeState = window.__MN_PDF_EXPORT_STATE__ = { stage: "loaded", images: (document.images || []).length };

  function signal(name, message) {
    if (notified) return;
    notified = true;
    if (name === "pdf-render-error") { runtimeState.stage = "error"; runtimeState.error = message; }
    window.location.href = "mnaddon://" + name + (message ? "?message=" + encodeURIComponent(message) : "");
  }

  function markBrokenImage(image) {
    if (!image || image.__mnPdfPlaceholder) return;
    image.__mnPdfPlaceholder = true;
    try {
      var holder = document.createElement("div");
      holder.setAttribute("data-pdf-image-error", "true");
      holder.textContent = "图片加载失败，原位置已保留";
      holder.style.cssText = "min-height:48px;padding:14px;border:1px dashed #cbd5e1;border-radius:6px;background:#f8fafc;color:#64748b;text-align:center;font-size:11px";
      image.style.display = "none";
      if (image.parentNode) image.parentNode.insertBefore(holder, image.nextSibling);
    } catch (error) {}
  }

  function waitForImages() {
    return new Promise(function (resolve, reject) {
      var images = Array.prototype.slice.call(document.images || []);
      var remaining = images.length;
      var failed = 0;
      var settled = false;
      var cleanup = [];
      if (!remaining) { resolve(); return; }
      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup.forEach(function (remove) { remove(); });
        if (failed) reject(new Error("有 " + failed + " 张图片未能加载，已停止 PDF 导出"));
        else resolve();
      }
      function done(ok, image) {
        if (settled || image.__mnPdfImageSettled) return;
        image.__mnPdfImageSettled = true;
        if (!ok) { failed += 1; markBrokenImage(image); }
        remaining -= 1;
        if (!remaining) finish();
      }
      var timer = setTimeout(function () {
        images.forEach(function (image) {
          if (!image.__mnPdfImageSettled) { failed += 1; markBrokenImage(image); }
        });
        finish();
      }, 5000);
      images.forEach(function (image) {
        if (image.complete) { done(image.naturalWidth !== 0, image); return; }
        function loaded() { done(image.naturalWidth !== 0, image); }
        function broken() { done(false, image); }
        cleanup.push(function () { image.removeEventListener("load", loaded); image.removeEventListener("error", broken); });
        image.addEventListener("load", loaded);
        image.addEventListener("error", broken);
      });
    });
  }

  function waitForFonts() {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(done, 3000);
      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      var fonts = document.fonts && document.fonts.ready;
      if (fonts && typeof fonts.then === "function") fonts.then(done, done);
      else done();
    });
  }

  function waitForStableLayout() {
    return new Promise(function (resolve, reject) {
      var previous = "";
      var stable = 0;
      var deadline = Date.now() + 6000;
      function sample() {
        var signature = document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight + "|" + document.querySelectorAll("*").length;
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        if (stable >= 3) { resolve(); return; }
        if (Date.now() >= deadline) { reject(new Error("PDF 页面布局未能稳定")); return; }
        // Offscreen UIWebView can suspend animation frames. Timers must drive readiness.
        setTimeout(sample, 120);
      }
      sample();
    });
  }

  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function measureMathGlyph(image) {
    var factor = Math.min(1, 1500 / Math.max(image.naturalWidth, image.naturalHeight),
      Math.sqrt(1400000 / (image.naturalWidth * image.naturalHeight)));
    var width = Math.max(1, Math.round(image.naturalWidth * factor));
    var height = Math.max(1, Math.round(image.naturalHeight * factor));
    var canvas = image.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var pixels;
    try {
      var context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height).data;
    } catch (error) {
      // An unreadable canvas must never stop an export.
      return;
    } finally {
      canvas.width = canvas.height = 0;
    }

    var luminance = new Uint8Array(width * height);
    var border = [];
    var borderX = Math.max(2, width * .025), borderY = Math.max(2, height * .025);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var index = y * width + x, offset = index * 4;
        luminance[index] = Math.round(.2126 * pixels[offset] + .7152 * pixels[offset + 1] + .0722 * pixels[offset + 2]);
        if ((x < borderX || x >= width - borderX || y < borderY || y >= height - borderY) && (x + y) % 9 === 0) {
          border.push(luminance[index]);
        }
      }
    }
    var background = border.length ? median(border) : 255;
    var darkInk = background >= 128;
    var threshold = darkInk ? Math.max(80, background - 38) : Math.min(180, background + 38);
    var ink = luminance.map(function (value) { return darkInk ? value < threshold : value > threshold; });
    var seen = new Uint8Array(ink.length), queue = new Int32Array(ink.length);
    var glyphs = [], meaningfulCount = 0;
    for (var seed = 0; seed < ink.length; seed++) {
      if (!ink[seed] || seen[seed]) continue;
      var count = 1, left = width, right = 0, top = height, bottom = 0;
      queue[0] = seed;
      seen[seed] = 1;
      for (var head = 0; head < count; head++) {
        var pixel = queue[head], px = pixel % width, py = Math.floor(pixel / width);
        left = Math.min(left, px); right = Math.max(right, px);
        top = Math.min(top, py); bottom = Math.max(bottom, py);
        for (var ny = Math.max(0, py - 1); ny <= Math.min(height - 1, py + 1); ny++) {
          for (var nx = Math.max(0, px - 1); nx <= Math.min(width - 1, px + 1); nx++) {
            var neighbor = ny * width + nx;
            if (!ink[neighbor] || seen[neighbor]) continue;
            seen[neighbor] = 1;
            queue[count++] = neighbor;
          }
        }
      }
      var w = right - left + 1, h = bottom - top + 1;
      if (count >= 5 && (w >= 2 || h >= 5)) meaningfulCount++;
      if (h >= 4 && w >= 2 && count >= 6 && w / h >= .18 && w / h <= 2.6 &&
          h <= height * .74 && w <= width * .43 && count / (w * h) > .045) {
        glyphs.push({ width: w, height: h, pixels: count });
      }
    }
    if (!glyphs.length) return;
    var stride = Math.ceil(glyphs.length / 1500);
    if (stride > 1) glyphs = glyphs.filter(function (_, index) { return index % stride === 0; });
    var typical = median(glyphs.map(function (glyph) { return glyph.height; }));
    var heights = glyphs.map(function (glyph) { return glyph.height; }).filter(function (h) {
      return h >= Math.max(4, typical * .52) && h <= Math.max(7, typical * 2);
    });
    var peak = 0, bestScore = -1;
    heights.forEach(function (height) {
      var score = heights.reduce(function (sum, other) {
        var distance = Math.log(height / other) / .19;
        return sum + Math.exp(-.5 * distance * distance);
      }, 0) * Math.pow(Math.max(.55, height / typical), .22);
      if (score > bestScore) { bestScore = score; peak = height; }
    });
    heights.sort(function (a, b) { return a - b; });
    // The upper quantile keeps numerous subscripts from setting the body size.
    var glyphHeight = Math.max(peak, heights[Math.floor((heights.length - 1) * .88)]);
    var near = heights.filter(function (h) { return Math.abs(Math.log(h / glyphHeight)) < .28; }).length;
    var lowConfidence = near < 4 || near / glyphs.length < .16;
    var strokeRuns = [];
    for (var row = 0; row < height; row += Math.max(1, Math.floor(height / 170))) {
      for (var column = 0; column < width;) {
        if (!ink[row * width + column]) { column++; continue; }
        var first = column;
        while (column < width && ink[row * width + column]) column++;
        if (column - first <= 10) strokeRuns.push(column - first);
      }
    }
    if (strokeRuns.length && glyphHeight / median(strokeRuns) < 2.7) lowConfidence = true;
    if (glyphs.length <= 3 && meaningfulCount <= 4) {
      var largest = glyphs.reduce(function (a, b) { return a.pixels >= b.pixels ? a : b; });
      if (largest.height >= 18 && largest.height >= largest.width * 1.5) {
        glyphHeight = largest.height / 2.25;
        lowConfidence = true;
      }
    }
    return { height: glyphHeight / factor, lowConfidence: lowConfidence };
  }

  function sizeImage(image, scope, pixelsPerOriginalPixel, landscapeHeightLimit) {
    var figure = image.parentElement;
    var target = Math.min(scope.getBoundingClientRect().width, figure.getBoundingClientRect().width || Infinity);
    var width = Math.min(target, image.naturalWidth * pixelsPerOriginalPixel);
    if (landscapeHeightLimit && !figure.classList.contains("paint-note")) {
      var glyph = measureMathGlyph(image);
      if (glyph && glyph.height > 0) {
        var scale = Math.max(glyph.lowConfidence ? .55 : .20,
          Math.min(glyph.lowConfidence ? 1.65 : 3.6, 18 / glyph.height));
        width = Math.min(target, image.naturalWidth * scale * pixelsPerOriginalPixel);
      }
    }
    if (landscapeHeightLimit && image.naturalHeight > 0 && image.naturalHeight <= image.naturalWidth) {
      width = Math.min(width, landscapeHeightLimit * image.naturalWidth / image.naturalHeight);
    }
    image.style.setProperty("width", width + "px", "important");
    image.style.setProperty("height", "auto", "important");
    image.style.setProperty("max-height", "none", "important");
    image.style.display = "block";
    if (figure.classList.contains("paint-note")) figure.style.width = width + "px";
  }

  function sizeImages(root, pixelsPerOriginalPixel, landscapeHeightLimit) {
    Array.prototype.forEach.call(root.querySelectorAll(".card-content, .answer-content"), function (scope) {
      Array.prototype.forEach.call(scope.querySelectorAll("img"), function (image) {
        if (image.naturalWidth && !image.closest(".bound-mindmap-handwriting")) {
          sizeImage(image, scope, pixelsPerOriginalPixel, landscapeHeightLimit);
        }
      });
    });
  }

  function ensureReady() {
    if (!readiness) {
      runtimeState.stage = "waiting-resources";
      readiness = Promise.all([waitForFonts(), waitForImages()]).then(function () {
        sizeImages(document, 1);
        runtimeState.stage = "waiting-layout";
        return waitForStableLayout();
      }).then(function () { runtimeState.stage = "ready"; });
    }
    return readiness;
  }

  window.__MN_PDF_EXPORT_PROTOCOL_V2__ = true;
  window.__MN_PDF_EXPORT_BEGIN__ = function () {
    if (readinessStarted) return;
    readinessStarted = true;
    ensureReady().then(function () { window.location.href = "mnaddon://pdf-render-ready"; })
      .catch(function (error) { signal("pdf-render-error", error && error.message ? error.message : String(error)); });
  };

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var output = "";
    var step = 16383;
    for (var offset = 0; offset < bytes.length; offset += step) {
      var end = Math.min(bytes.length, offset + step);
      var part = "";
      for (var index = offset; index < end; index += 1) part += String.fromCharCode(bytes[index]);
      output += btoa(part);
    }
    return output;
  }

  function checkCancelled() {
    if (cancelled) throw new Error("已取消导出");
  }

  function yieldPage() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); }).then(checkCancelled);
  }

  function progress(stage, completed, total) {
    runtimeState.stage = stage;
    runtimeState.completed = completed;
    runtimeState.total = total;
    runtimeState.updatedAt = Date.now();
    // A completed page/unit is a watchdog event, not a time-based progress tick.
    window.location.href = "mnaddon://pdf-progress?stage=" + stage + "&completed=" + completed + "&total=" + total + "&pages=" + (runtimeState.pages || 0);
  }

  function loadScript(doc, name) {
    return new Promise(function (resolve, reject) {
      checkCancelled();
      var script = doc.createElement("script");
      var timer = setTimeout(function () { finish(new Error("PDF 资源加载超时：" + name)); }, 10000);
      function finish(error) {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        if (error) reject(error); else resolve();
      }
      script.src = new URL(name, window.location.href).href;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error("PDF 资源加载失败：" + name)); };
      doc.head.appendChild(script);
    });
  }

  function createPageDocument() {
    var frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:0;top:0;width:704px;height:1100px;border:0;background:white";
    document.body.appendChild(frame);
    activeFrame = frame;
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    Array.prototype.forEach.call(document.querySelectorAll("style"), function (style) { doc.head.appendChild(style.cloneNode(true)); });
    var sheets = Array.prototype.map.call(document.querySelectorAll('link[rel="stylesheet"]'), function (link) {
      return new Promise(function (resolve, reject) {
        var copy = doc.createElement("link");
        var timer = setTimeout(function () { reject(new Error("PDF 公式样式加载超时")); }, 10000);
        copy.rel = "stylesheet"; copy.href = link.href;
        copy.onload = function () { clearTimeout(timer); resolve(); };
        copy.onerror = function () { clearTimeout(timer); reject(new Error("PDF 公式样式加载失败")); };
        doc.head.appendChild(copy);
      });
    });
    doc.body.className = document.body.className;
    var draw = document.querySelector("script[data-pdf-drawing-renderer]");
    if (draw) { var script = doc.createElement("script"); script.textContent = draw.textContent; doc.head.appendChild(script); }
    var page = doc.createElement("div");
    page.className = "pdf-flow";
    page.style.cssText = "width:703px;display:flow-root;background:white";
    doc.body.appendChild(page);
    return { ready: Promise.all(sheets), frame: frame, doc: doc, page: page, height: Math.floor(703 * (841.89 - 112) / (595.28 - 112)) };
  }

  async function prepareUnit(view, html) {
    var doc = view.doc;
    var holder = doc.createElement("div");
    holder.innerHTML = html;
    view.page.appendChild(holder);
    var ids = [];
    Array.prototype.forEach.call(holder.querySelectorAll("[data-pdf-image-id], [data-pdf-drawing-id]"), function (node) {
      var id = node.getAttribute("data-pdf-image-id") || node.getAttribute("data-pdf-drawing-id");
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    for (var i = 0; i < ids.length; i++) await loadScript(doc, ids[i] + ".js");
    await Promise.all(Array.prototype.map.call(holder.querySelectorAll("img"), function (img) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { done(false); }, 10000);
        function done(ok) {
          clearTimeout(timer); img.onload = img.onerror = null;
          if (ok) resolve(); else reject(new Error("题目图片未能加载"));
        }
        img.onload = function () { done(img.naturalWidth > 0); };
        img.onerror = function () { done(false); };
        if (img.complete) done(img.naturalWidth > 0);
      });
    }));
    checkCancelled();
    // The raster surface is mapped to the PDF content box. Preserve 96 source
    // pixels per printed inch before applying the column-width cap.
    sizeImages(holder, view.page.getBoundingClientRect().width * 0.75 / (595.28 - 112), view.height / 4);
    wrapLongImages(view, holder);
    if (doc.fonts && doc.fonts.ready) await new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("PDF 字体加载超时")); }, 10000);
      doc.fonts.ready.then(function () { clearTimeout(timer); resolve(); }, function (error) { clearTimeout(timer); reject(error); });
    });
    if (doc.defaultView.__MN_PDF_DRAW__) doc.defaultView.__MN_PDF_DRAW__();
    if (holder.querySelector(".missing-image")) throw new Error("题目含无法解析的图片或手写内容");
    // Paint is synchronous after images and fonts. Yield so layout and cancellation can settle.
    await yieldPage();
    return holder;
  }

  function contentBottom(view, node) {
    var doc = view.doc;
    var bottom = view.page.getBoundingClientRect().top + view.height;
    var reserve = 1;
    var parent = node.parentElement;
    if (node.nodeType === 1) reserve += Math.max(0, parseFloat(doc.defaultView.getComputedStyle(node).marginBottom) || 0);
    while (parent && parent !== view.page) {
      var css = doc.defaultView.getComputedStyle(parent);
      reserve += Math.max(0, parseFloat(css.paddingBottom) || 0) + Math.max(0, parseFloat(css.borderBottomWidth) || 0) + Math.max(0, parseFloat(css.marginBottom) || 0);
      parent = parent.parentElement;
    }
    return bottom - reserve;
  }

  function wrapLongImages(view, holder) {
    var sliceHeight = view.height - 40;
    Array.prototype.forEach.call(holder.querySelectorAll(".card-content img, .answer-content img"), function (image) {
      if (image.closest(".bound-mindmap-handwriting")) return;
      var imageRect = image.getBoundingClientRect();
      if (imageRect.height <= sliceHeight) return;
      var source = image.parentElement.matches("figure") ? image.parentElement : image;
      var sourceRect = source.getBoundingClientRect();
      var clip = view.doc.createElement("div");
      clip.setAttribute("data-pdf-image-slice", "");
      clip.setAttribute("data-pdf-atomic", "");
      clip.style.cssText = "position:relative;overflow:hidden;margin:0 auto;width:" + sourceRect.width + "px;height:" + sourceRect.height + "px";
      source.parentNode.insertBefore(clip, source);
      source.style.setProperty("margin", "0", "important");
      source.style.position = "absolute";
      source.style.top = "0px";
      source.style.width = sourceRect.width + "px";
      clip.appendChild(source);
    });
  }

  function hasContent(node) {
    return !!(node.textContent.trim() || node.querySelector("img,canvas,svg,math,.writing-space"));
  }

  // Split at actual line/atomic-element boundaries, retaining the ancestor markup.
  // The detached remainder is never part of html2canvas's document clone.
  function splitOverflow(view, holder) {
    var doc = view.doc;
    var boundary = null;
    function visit(node) {
      if (boundary) return;
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) return;
        var range = doc.createRange();
        range.selectNodeContents(node);
        if (range.getBoundingClientRect().bottom <= contentBottom(view, node)) return;
        var low = 0, high = node.length;
        while (low < high) {
          var mid = Math.ceil((low + high) / 2);
          range.setStart(node, 0); range.setEnd(node, mid);
          if (range.getBoundingClientRect().bottom <= contentBottom(view, node)) low = mid; else high = mid - 1;
        }
        if (low > 0 && /[\uD800-\uDBFF]/.test(node.textContent.charAt(low - 1))) low--;
        boundary = { node: node, offset: low };
        return;
      }
      if (node.nodeType !== 1) return;
      var atomic = node.matches("figure,img,canvas,svg,math,.katex,.katex-display,table,header,h1,h2,h3,.writing-space,[data-pdf-atomic]");
      if (atomic) {
        var rect = node.getBoundingClientRect();
        var bottom = contentBottom(view, node);
        if (rect.bottom <= bottom) return;
        if (node.hasAttribute("data-pdf-image-slice")) {
          var available = Math.floor(bottom - rect.top);
          if (available > 0) {
            var remainder = node.cloneNode(true);
            remainder.style.height = (rect.height - available) + "px";
            remainder.firstElementChild.style.top =
              (parseFloat(node.firstElementChild.style.top) - available) + "px";
            node.style.height = available + "px";
            node.parentNode.insertBefore(remainder, node.nextSibling);
            boundary = { before: remainder };
            return;
          }
        }
        boundary = { before: node };
        return;
      }
      Array.prototype.forEach.call(node.childNodes, visit);
    }
    visit(holder);
    if (!boundary) return { tail: null };
    var tail = holder.cloneNode(false);
    tail.style.minHeight = "0";
    var cut = doc.createRange();
    if (boundary.before) cut.setStartBefore(boundary.before); else cut.setStart(boundary.node, boundary.offset);
    cut.setEnd(holder, holder.childNodes.length);
    var element = boundary.before || boundary.node.parentElement;
    var description = describeOverflow(element, view);
    if (!hasContent(cut.cloneContents())) return { tail: null, description: description };
    tail.appendChild(cut.extractContents());
    return { tail: tail, description: description };
  }

  function describeOverflow(element, view) {
    var tag = element.tagName.toLowerCase();
    var className = (element.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return tag + (className ? "." + className : "") + "，高 " +
      Math.round(element.getBoundingClientRect().height) + " px / 页高 " + view.height + " px";
  }

  function paginationError(unit, reason, description) {
    return new Error("第 " + (unit.index + 1) + " 题" +
      (unit.title ? "「" + unit.title.replace(/\s+/g, " ").trim().slice(0, 160) + "」" : "") +
      "的" + (unit.kind === "answer" ? "答案" : "题干") + reason + "（" + description + "）");
  }

  function shrinkOversize(view, holder) {
    var atomic = Array.prototype.find.call(holder.querySelectorAll("figure,img,canvas,svg,math,.katex-display,table,[data-pdf-atomic]"), function (node) {
      return !node.closest("[data-pdf-image-slice]") && node.getBoundingClientRect().height > view.height - 40;
    });
    if (!atomic) return false;
    var rect = atomic.getBoundingClientRect();
    var scale = (view.height - 40) / rect.height;
    if (scale < 0.35) throw new Error("内容过高，缩放后无法辨认，请拆分该卡片后导出");
    var wrapper = view.doc.createElement("div");
    wrapper.setAttribute("data-pdf-atomic", "true");
    wrapper.style.cssText = "position:relative;width:" + rect.width * scale + "px;height:" + rect.height * scale + "px";
    atomic.parentNode.insertBefore(wrapper, atomic);
    wrapper.appendChild(atomic);
    atomic.style.setProperty("width", rect.width + "px", "important");
    atomic.style.position = "absolute";
    atomic.style.transformOrigin = "top left";
    atomic.style.transform = "scale(" + scale + ")";
    return true;
  }

  function shouldMoveTitledImage(view, holder) {
    if (!holder.querySelector(".problem-title")) return false;
    var image = holder.querySelector(".card-content img, .answer-content img");
    if (!image) return false;
    var slice = image.closest("[data-pdf-image-slice]");
    var block = slice || image.closest("figure") || image;
    var rect = block.getBoundingClientRect();
    // Regular images stay whole. Long images need room for a readable opening.
    var required = slice ? Math.min(rect.height, 96) : rect.height;
    if (required <= 0) return false;
    var end = rect.top + required;
    var bottom = contentBottom(view, block);
    var used = holder.getBoundingClientRect().top - view.page.getBoundingClientRect().top;
    return end > bottom && end - used <= bottom;
  }

  async function paginate(manifest, emit) {
    var view = createPageDocument();
    var pages = 0;
    var slots = { "one-per-page": 1, "two-per-page": 2, "three-per-page": 3 }[manifest.pageLayout] || 0;
    var group = -1, kind = "";
    async function flush() {
      if (!hasContent(view.page)) return;
      checkCancelled();
      await emit(view, ++pages);
      // Explicitly release backing stores before detaching the completed page.
      Array.prototype.forEach.call(view.page.querySelectorAll("canvas"), function (canvas) { canvas.width = canvas.height = 0; });
      view.page.textContent = "";
      await yieldPage();
    }
    try {
      await view.ready;
      for (var i = 0; i < manifest.units.length; i++) {
        checkCancelled();
        var unit = manifest.units[i];
        runtimeState.unit = i + 1;
        runtimeState.record = unit.index + 1;
        var nextGroup = slots ? Math.floor(unit.index / slots) : 0;
        if ((slots && nextGroup !== group && unit.kind === "question") || (manifest.answerLayout === "end" && kind && kind !== unit.kind)) await flush();
        group = nextGroup; kind = unit.kind;
        await loadScript(view.doc, unit.name);
        var html = view.doc.defaultView.__MN_PDF_UNIT__;
        view.doc.defaultView.__MN_PDF_UNIT__ = null;
        if (typeof html !== "string") throw new Error("题目片段未能读取");
        var holder = await prepareUnit(view, html);
        if (slots && unit.kind === "question") holder.style.minHeight = Math.floor(view.height / slots) + "px";
        html = null;
        while (view.page.getBoundingClientRect().height > view.height + 0.5) {
          checkCancelled();
          var hadPrevious = holder.previousSibling !== null;
          // A slot reserves blank writing space. It must never force a split by itself.
          holder.style.minHeight = "0";
          if (view.page.getBoundingClientRect().height <= view.height + 0.5) break;
          if (hadPrevious && shouldMoveTitledImage(view, holder)) {
            holder.remove();
            await flush();
            view.page.appendChild(holder);
            continue;
          }
          if (shrinkOversize(view, holder)) continue;
          var split = splitOverflow(view, holder);
          var tail = split.tail;
          if (!tail) {
            if (!hadPrevious) throw paginationError(unit, "无法安全分页", split.description || describeOverflow(holder, view));
            holder.remove();
            await flush();
            view.page.appendChild(holder);
            continue;
          }
          if (!hasContent(holder)) {
            holder.remove();
            if (!hadPrevious) throw paginationError(unit, "含无法放入页面的内容", split.description);
          }
          await flush();
          holder = tail;
          view.page.appendChild(holder);
          // Range clones ancestor canvas elements without pixels. Repaint surviving drawings.
          if (view.doc.defaultView.__MN_PDF_DRAW__) view.doc.defaultView.__MN_PDF_DRAW__();
        }
        if (!emit.rendering) progress("planning", i + 1, manifest.units.length);
      }
      await flush();
      return pages;
    } finally {
      view.frame.remove();
      activeFrame = null;
    }
  }

  async function generatePdf() {
    if (typeof window.html2canvas !== "function") throw new Error("html2canvas 未加载");
    if (typeof window.createCardLinkPdf !== "function") throw new Error("PDF 写入器未加载");
    var manifest = window.__MN_PDF_MANIFEST__;
    if (!manifest || !manifest.units.length) throw new Error("PDF 任务清单为空");
    runtimeState.pages = 0;
    var total = await paginate(manifest, async function () {});
    runtimeState.totalPages = total;
    var pdf = window.createCardLinkPdf();
    async function render(view, pageNumber) {
      checkCancelled();
      runtimeState.stage = "rasterizing";
      var began = Date.now();
      var canvas;
      try {
        canvas = await window.html2canvas(view.page, { scale: 2, backgroundColor: "#ffffff", logging: false,
          useCORS: true, allowTaint: false, imageTimeout: 10000, scrollX: 0, scrollY: 0,
          ignoreElements: function (element) { return element.tagName === "IFRAME" || element.hasAttribute("data-pdf-control"); },
          width: 703, height: view.height });
        checkCancelled();
        pdf.addPage(canvas);
        if (window.__MN_PDF_PREVIEW_MODE__) {
          var preview = document.createElement("canvas");
          try {
            preview.width = 1191; preview.height = 1684;
            var ctx = preview.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, preview.width, preview.height);
            ctx.drawImage(canvas, 112, 112, 967, 1460);
            pdfPreviewPages.push(preview.toDataURL("image/jpeg", 0.92).split(",")[1]);
          } finally { preview.width = preview.height = 0; }
        }
        runtimeState.pages = pageNumber;
        runtimeState.lastPageMs = Date.now() - began;
        runtimeState.domNodes = view.doc.querySelectorAll("*").length;
        progress("rendering", pageNumber, total);
      } finally { if (canvas) canvas.width = canvas.height = 0; }
    }
    render.rendering = true;
    var written = await paginate(manifest, render);
    if (!written || written !== total || pdf.getPageCount() !== total) throw new Error("PDF 页数与分页计划不一致");
    checkCancelled();
    progress("serializing", written, total);
    await yieldPage();
    pdfBytes = pdf.finish();
    pdf = null;
    checkCancelled();
    var base64Length = 4 * Math.ceil(pdfBytes.length / 3);
    window.__MN_PDF_EXPORT_INFO__ = {
      byteLength: pdfBytes.length, base64Length: base64Length, chunkSize: CHUNK_SIZE,
      chunks: Math.ceil(base64Length / CHUNK_SIZE), pages: written,
      previewPageLengths: pdfPreviewPages.map(function (page) { return page.length; })
    };
    runtimeState.stage = "data-ready";
    signal("pdf-data-ready");
  }

  window.__MN_PDF_EXPORT_TAKE_CHUNK__ = function (index) {
    checkCancelled();
    if (!pdfBytes) return "";
    // 65536 Base64 chars = 49152 bytes, a multiple of three. Encode only the requested chunk.
    var offset = Math.max(0, Number(index) || 0) * (CHUNK_SIZE / 4 * 3);
    return arrayBufferToBase64(pdfBytes.subarray(offset, offset + CHUNK_SIZE / 4 * 3));
  };

  window.__MN_PDF_EXPORT_RELEASE_DATA__ = function () { pdfBytes = null; return true; };

  window.__MN_PDF_EXPORT_TAKE_PREVIEW_CHUNK__ = function (pageIndex, chunkIndex) {
    var page = pdfPreviewPages[Math.max(0, Number(pageIndex) || 0)] || "";
    var offset = Math.max(0, Number(chunkIndex) || 0) * CHUNK_SIZE;
    return page.slice(offset, offset + CHUNK_SIZE);
  };

  window.__MN_PDF_EXPORT_RELEASE__ = function () {
    cancelled = true;
    notified = true;
    pdfBytes = null;
    if (activeFrame) { activeFrame.remove(); activeFrame = null; }
    pdfPreviewPages = [];
    window.__MN_PDF_EXPORT_INFO__ = null;
    return true;
  };

  window.__MN_PDF_FILE_FALLBACK__ = true;
  window.__MN_PDF_FILE_FALLBACK_BEGIN__ = function () {
    if (started) return;
    started = true;
    ensureReady().then(generatePdf)
      .catch(function (error) {
        pdfBytes = null; pdfPreviewPages = [];
        signal("pdf-render-error", error && error.message ? error.message : String(error));
      });
  };
})();
