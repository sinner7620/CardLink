(function () {
  "use strict";

  var CHUNK_SIZE = 65536;
  var started = false;
  var notified = false;
  var pdfBase64 = "";
  var pdfPreviewPages = [];

  function signal(name, message) {
    if (notified) return;
    notified = true;
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
    return new Promise(function (resolve) {
      var images = Array.prototype.slice.call(document.images || []);
      var remaining = images.length;
      var settled = false;
      if (!remaining) {
        resolve();
        return;
      }
      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      function done(ok, image) {
        if (settled || image.__mnPdfImageSettled) return;
        image.__mnPdfImageSettled = true;
        if (!ok) markBrokenImage(image);
        remaining -= 1;
        if (!remaining) finish();
      }
      var timer = setTimeout(function () {
        images.forEach(function (image) {
          if (!image.__mnPdfImageSettled) {
            image.__mnPdfImageSettled = true;
            markBrokenImage(image);
          }
        });
        finish();
      }, 5000);
      images.forEach(function (image) {
        if (image.complete) {
          done(image.naturalWidth !== 0, image);
          return;
        }
        function loaded() { cleanup(); done(true, image); }
        function broken() { cleanup(); done(false, image); }
        function cleanup() {
          image.removeEventListener("load", loaded);
          image.removeEventListener("error", broken);
        }
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
    return new Promise(function (resolve) {
      var previous = "";
      var stable = 0;
      var deadline = Date.now() + 6000;
      function sample() {
        requestAnimationFrame(function () {
          var signature = document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight + "|" + document.querySelectorAll("*").length;
          stable = signature === previous ? stable + 1 : 0;
          previous = signature;
          if (stable >= 3 || Date.now() >= deadline) resolve();
          else setTimeout(sample, 120);
        });
      }
      sample();
    });
  }

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

  function renderNodeToPdf(pdf, node, state) {
    var pixelRatio = Number(window.devicePixelRatio) || 1;
    var scale = Math.max(2.5, Math.min(3, pixelRatio * 1.5));
    return window.html2canvas(node, {
      scale: scale,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      allowTaint: false,
      imageTimeout: 5000,
      scrollX: 0,
      scrollY: 0,
      onclone: function (clonedDocument) {
        Array.prototype.forEach.call(clonedDocument.querySelectorAll("iframe, [data-pdf-control]"), function (element) {
          if (element.parentNode) element.parentNode.removeChild(element);
        });
      },
      ignoreElements: function (element) {
        return element.tagName === "IFRAME" || (element.hasAttribute && element.hasAttribute("data-pdf-control"));
      }
    }).then(function (canvas) {
      var pageWidth = pdf.internal.pageSize.getWidth();
      var pageHeight = pdf.internal.pageSize.getHeight();
      // 正常 A4 页边距：56pt ≈ 19.8mm（此前 42pt ≈ 14.8mm，观感贴边）
      var margin = 56;
      var drawWidth = pageWidth - margin * 2;
      var drawHeight = pageHeight - margin * 2;
      // 预览/落盘统一走"白底 A4 整页画布"：把内容按边距位置合成到完整页面上，
      // 保证导出预览所见即所得（此前预览推的是未加边距的原始切片）。
      function composeFullPage(source, sx, sy, sw, sh, destX, destY, destW, destH) {
        var pxPerPt = canvas.width / drawWidth;
        var page = document.createElement("canvas");
        page.width = Math.round(pageWidth * pxPerPt);
        page.height = Math.round(pageHeight * pxPerPt);
        var context = page.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, page.width, page.height);
        context.drawImage(source, sx, sy, sw, sh, Math.round(destX * pxPerPt), Math.round(destY * pxPerPt), Math.round(destW * pxPerPt), Math.round(destH * pxPerPt));
        return page.toDataURL("image/jpeg", 0.97);
      }
      var isFixedPage = node.classList && node.classList.contains("pdf-page");
      if (isFixedPage) {
        if (state.pages > 0) pdf.addPage("a4", "portrait");
        var fixedScale = Math.min(drawWidth / canvas.width, drawHeight / canvas.height);
        var fixedWidth = canvas.width * fixedScale;
        var fixedHeight = canvas.height * fixedScale;
        var fixedX = (pageWidth - fixedWidth) / 2;
        var fixedY = (pageHeight - fixedHeight) / 2;
        var composedFixed = composeFullPage(canvas, 0, 0, canvas.width, canvas.height, fixedX, fixedY, fixedWidth, fixedHeight);
        pdf.addImage(composedFixed, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "SLOW");
        if (window.__MN_PDF_PREVIEW_MODE__) pdfPreviewPages.push(composedFixed.replace(/^data:image\/jpeg;base64,/, ""));
        state.pages += 1;
        canvas.width = 1;
        canvas.height = 1;
        return;
      }
      var sliceHeight = Math.max(1, Math.floor(canvas.width * drawHeight / drawWidth));
      for (var y = 0; y < canvas.height; y += sliceHeight) {
        if (state.pages > 0) pdf.addPage("a4", "portrait");
        var height = Math.min(sliceHeight, canvas.height - y);
        var slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = height;
        var context = slice.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, slice.width, slice.height);
        context.drawImage(canvas, 0, y, canvas.width, height, 0, 0, canvas.width, height);
        var renderedHeight = drawWidth * height / canvas.width;
        var composedSlice = composeFullPage(slice, 0, 0, slice.width, slice.height, margin, margin, drawWidth, renderedHeight);
        pdf.addImage(composedSlice, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "SLOW");
        if (window.__MN_PDF_PREVIEW_MODE__) pdfPreviewPages.push(composedSlice.replace(/^data:image\/jpeg;base64,/, ""));
        state.pages += 1;
        slice.width = 1;
        slice.height = 1;
      }
      canvas.width = 1;
      canvas.height = 1;
    });
  }

  function generatePdf() {
    if (typeof window.html2canvas !== "function") throw new Error("html2canvas 未加载");
    if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") throw new Error("jsPDF 未加载");
    var covers = Array.prototype.slice.call(document.querySelectorAll(".cover"));
    var layoutNodes = Array.prototype.slice.call(document.querySelectorAll(".pdf-page, .pdf-flow"));
    var nodes = layoutNodes.length ? covers.concat(layoutNodes) : [document.body];
    var pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true, precision: 16 });
    var state = { pages: 0 };
    var chain = Promise.resolve();
    nodes.forEach(function (node) {
      chain = chain.then(function () { return renderNodeToPdf(pdf, node, state); });
    });
    return chain.then(function () {
      if (!state.pages) throw new Error("没有可写入 PDF 的页面");
      pdfBase64 = arrayBufferToBase64(pdf.output("arraybuffer"));
      window.__MN_PDF_EXPORT_INFO__ = {
        byteLength: Math.floor(pdfBase64.length * 3 / 4),
        base64Length: pdfBase64.length,
        chunkSize: CHUNK_SIZE,
        chunks: Math.ceil(pdfBase64.length / CHUNK_SIZE),
        pages: state.pages,
        previewPageLengths: pdfPreviewPages.map(function (page) { return page.length; })
      };
      signal("pdf-data-ready");
    });
  }

  window.__MN_PDF_EXPORT_TAKE_CHUNK__ = function (index) {
    var offset = Math.max(0, Number(index) || 0) * CHUNK_SIZE;
    return pdfBase64.slice(offset, offset + CHUNK_SIZE);
  };

  window.__MN_PDF_EXPORT_TAKE_PREVIEW_CHUNK__ = function (pageIndex, chunkIndex) {
    var page = pdfPreviewPages[Math.max(0, Number(pageIndex) || 0)] || "";
    var offset = Math.max(0, Number(chunkIndex) || 0) * CHUNK_SIZE;
    return page.slice(offset, offset + CHUNK_SIZE);
  };

  window.__MN_PDF_EXPORT_RELEASE__ = function () {
    pdfBase64 = "";
    pdfPreviewPages = [];
    window.__MN_PDF_EXPORT_INFO__ = null;
    return true;
  };

  window.__MN_PDF_FILE_FALLBACK__ = true;
  window.__MN_PDF_FILE_FALLBACK_BEGIN__ = function () {
    if (started) return;
    started = true;
    Promise.all([waitForFonts(), waitForImages()])
      .then(waitForStableLayout)
      .then(generatePdf)
      .catch(function (error) {
        signal("pdf-render-error", error && error.message ? error.message : String(error));
      });
  };
})();
