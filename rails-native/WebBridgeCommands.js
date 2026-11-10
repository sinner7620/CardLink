var __MNAM_WEB_BRIDGE_GLOBAL__ = (function () {
  var PDF_RENDER_TIMEOUT = 20;

  function tracePdf(controller, stage, message) {
    try {
      var pending = __MN_ANSWER_CORE_GLOBAL__.bridge("pdfExportStage", { stage: stage, taskId: controller.exportPdfTask && controller.exportPdfTask.id, message: message || "" });
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (error) {}
  }

  function clearPdfRenderTimer(controller) {
    if (!controller || !controller.exportPdfRenderTimer) return;
    try { controller.exportPdfRenderTimer.invalidate(); } catch (error) {}
    controller.exportPdfRenderTimer = null;
  }

  function clearPdfCleanupTimer(controller) {
    if (!controller || !controller.exportPdfCleanupTimer) return;
    try { controller.exportPdfCleanupTimer.invalidate(); } catch (error) {}
    controller.exportPdfCleanupTimer = null;
  }

  function cleanupPdfSource(result) {
    if (!result || !result.pdfSourceDirectory) return;
    // Only the task-owned directory returned by the core; never derive paths from a filename.
    try { NSFileManager.defaultManager().removeItemAtPath(result.pdfSourceDirectory); } catch (error) {}
    result.pdfSourceDirectory = null;
  }

  function releasePdfRequest(controller) {
    if (!controller) return;
    clearPdfRenderTimer(controller);
    clearPdfCleanupTimer(controller);
    cleanupPdfSource(controller.exportPdfRequest && controller.exportPdfRequest.result);
    if (controller.exportWebView) {
      try { controller.exportWebView.evaluateJavaScript("window.__MN_PDF_EXPORT_RELEASE__&&window.__MN_PDF_EXPORT_RELEASE__()", function () {}); } catch (error) {}
      controller.exportWebView.delegate = null;
      try { if (controller.exportWebView.superview) controller.exportWebView.removeFromSuperview(); } catch (error) {}
    }
    if (controller.exportPdfRenderDirectory) {
      try { NSFileManager.defaultManager().removeItemAtPath(controller.exportPdfRenderDirectory); } catch (error) {}
      controller.exportPdfRenderDirectory = null;
    }
    controller.exportWebView = null;
    controller.exportPdfRequest = null;
    controller.exportPdfRenderStarted = false;
  }

  function rejectPdfRequest(controller, error) {
    var request = controller && controller.exportPdfRequest;
    if (!request) return;
    releasePdfRequest(controller);
    request.reject(error instanceof Error ? error : new Error(String(error)));
  }

  function preparePdfHtml(html, previewMode) {
    var source = String(html || "");
    if (source.indexOf("__MN_PDF_FILE_FALLBACK__") >= 0) return source;
    var script = '<link rel="stylesheet" href="./katex.min.css">' + (previewMode ? '<script>window.__MN_PDF_PREVIEW_MODE__=true;</script>' : "") +
      '<script src="./html2canvas.min.js"></script>' +
      '<script src="./jspdf.umd.min.js"></script>' +
      '<script src="./pdf-export-runtime.js"></script>';
    var bodyEnd = source.toLowerCase().lastIndexOf("</body>");
    return bodyEnd < 0 ? source + script : source.slice(0, bodyEnd) + script + source.slice(bodyEnd);
  }

  function removePdfPath(manager, path) {
    try { if (manager.fileExistsAtPath(path)) manager.removeItemAtPath(path); } catch (error) {}
  }

  function ensureCardLinkTempRoot(app) {
    var base = app.tempPath || app.documentPath;
    if (!base) throw new Error("当前 MarginNote 未提供临时目录");
    base = String(base).replace(/\/$/, "");
    var manager = NSFileManager.defaultManager();
    cleanupPdfArtifacts(base, manager);
    var directory = base + "/CardLink/temp";
    if (!manager.fileExistsAtPath(directory) &&
        !manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(directory, true, null)) {
      throw new Error("CardLink 临时目录创建失败");
    }
    return directory;
  }

  function cleanupPdfArtifacts(root, manager) {
    var base = String(root).replace(/\/$/, "");
    ["beta33", "beta34", "beta35", "beta36"].forEach(function (version) {
      removePdfPath(manager, base + "/MN4AnswerMatcherPdfRuntime-" + version);
    });
    removePdfPath(manager, base + "/MN4AnswerMatcherPdfRuntime");
    removePdfPath(manager, base + "/MN4AnswerMatcherPdfCache");
    removePdfPath(manager, base + "/MN4错题导出预览.pdf");
    for (var index = 1; index <= 200; index += 1) removePdfPath(manager, base + "/MN4错题导出预览-" + index + ".jpg");
  }

  function ensurePdfCacheDirectory(root) {
    var manager = NSFileManager.defaultManager();
    var directory = String(root).replace(/\/$/, "") + "/pdf-cache";
    if (!manager.fileExistsAtPath(directory) &&
        !manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(directory, true, null)) {
      throw new Error("PDF 缓存目录创建失败");
    }
    return directory;
  }

  function stagePdfRenderPage(controller, html, previewMode, assets) {
    var app = Application.sharedInstance();
    var root = ensureCardLinkTempRoot(app);
    var manager = NSFileManager.defaultManager();
    cleanupPdfArtifacts(root, manager);
    var directory = String(root).replace(/\/$/, "") + "/pdf-runtime/" + controller.exportPdfTask.id;
    controller.exportPdfRenderDirectory = directory;
    if (!manager.fileExistsAtPath(directory) &&
        !manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(directory, true, null)) {
      throw new Error("PDF 临时目录创建失败");
    }
    ["html2canvas.min.js", "jspdf.umd.min.js", "pdf-export-runtime.js", "katex.min.css"].forEach(function (name) {
      var destination = directory + "/" + name;
      var source = String(controller.mainPath || "") + "/web-dist/vendor/" + name;
      if (!manager.fileExistsAtPath(source)) throw new Error("PDF 兼容资源不存在：" + name);
      if (manager.fileExistsAtPath(destination)) {
        try { manager.removeItemAtPath(destination); } catch (error) {}
      }
      manager.copyItemAtPathToPath(source, destination);
      if (!manager.fileExistsAtPath(destination)) throw new Error("PDF 兼容资源复制失败：" + name);
    });
    (assets || []).forEach(function (asset) {
      if (!/^(image|drawing|unit)-\d+\.js$/.test(asset.name)) throw new Error("PDF 图片资源名称无效");
      var destination = directory + "/" + asset.name;
      if (!manager.fileExistsAtPath(asset.path)) throw new Error("PDF 图片资源不存在：" + asset.name);
      manager.copyItemAtPathToPath(asset.path, destination);
      if (!manager.fileExistsAtPath(destination)) throw new Error("PDF 图片资源复制失败：" + asset.name);
    });
    var pagePath = directory + "/render.html";
    var data = NSData.dataWithStringEncoding(preparePdfHtml(html, previewMode), 4);
    if (!data || !dataLength(data) || !data.writeToFileAtomically(pagePath, true)) {
      throw new Error("PDF 渲染页面写入失败");
    }
    cleanupPdfSource(controller.exportPdfRequest && controller.exportPdfRequest.result);
    controller.exportPdfRenderHtmlPath = pagePath;
    tracePdf(controller, "html.staged", "assets=" + (assets || []).length + " chars=" + html.length);
    return pagePath;
  }

  function dataLength(data) {
    if (!data) return 0;
    try { return typeof data.length === "function" ? Number(data.length()) : Number(data.length || 0); } catch (error) { return 0; }
  }

  function decodeBase64ToBinaryString(value) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var source = String(value || "").replace(/\s/g, "");
    var parts = [];
    var part = "";
    var buffer = 0;
    var bits = 0;
    for (var index = 0; index < source.length; index += 1) {
      var character = source.charAt(index);
      if (character === "=") break;
      var code = alphabet.indexOf(character);
      if (code < 0) throw new Error("PDF Base64 数据无效");
      buffer = (buffer << 6) | code;
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        part += String.fromCharCode((buffer >> bits) & 255);
        buffer = bits ? buffer & ((1 << bits) - 1) : 0;
        if (part.length >= 16384) {
          parts.push(part);
          part = "";
        }
      }
    }
    if (part) parts.push(part);
    return parts.join("");
  }

  function decodePdfBase64(base64) {
    var binary = decodeBase64ToBinaryString(base64);
    var data = NSData.dataWithStringEncoding(binary, 5);
    if (!data || !dataLength(data)) throw new Error("PDF 二进制数据转换失败");
    return data;
  }

  function saveGeneratedPdf(controller, webView, info, chunks, previewPages) {
    var request = controller && controller.exportPdfRequest;
    if (!request || webView !== controller.exportWebView) return;
    try {
      var binary = chunks.join("");
      chunks.length = 0;
      if (binary.length !== Number(info.byteLength) || info.receivedBase64Length !== Number(info.base64Length)) throw new Error("PDF 数据接收不完整");
      if (binary.slice(0, 5) !== "%PDF-" || !/%%EOF\s*$/.test(binary.slice(-1024))) throw new Error("PDF 文件结构不完整");
      var data = NSData.dataWithStringEncoding(binary, 5);
      binary = null;
      if (dataLength(data) !== Number(info.byteLength)) throw new Error("PDF 字节数校验失败");
      if (controller.exportPdfTask) controller.exportPdfTask.progress = 92;
      var app = Application.sharedInstance();
      var root = ensureCardLinkTempRoot(app);
      if (request.result.renderPdfPreview) {
        var cacheDirectory = ensurePdfCacheDirectory(root);
        var previewPath = cacheDirectory + "/preview.pdf";
        if (!data.writeToFileAtomically(previewPath, true)) throw new Error("PDF 预览文件写入失败");
        var previewUrl = String(NSURL.fileURLWithPath(previewPath).absoluteString()) + "?t=" + Date.now();
        var previewResult = { preview: true, pdfPreview: true, format: "pdf", pdfUrl: previewUrl, previewPages: previewPages || [], count: request.result.count, previewCount: request.result.previewCount, truncated: request.result.truncated === true, missing: request.result.missing || 0, pages: Number(info.pages) || 0, bytes: dataLength(data) };
        // The page images already carry everything the UI shows; returning the
        // full export HTML too would push a multi-megabyte response through the
        // bridge for nothing. Keep it only as the no-pages fallback.

        releasePdfRequest(controller);
        request.resolve(previewResult);
        return;
      }
      if (typeof app.saveFileWithUti !== "function") throw new Error("当前 MarginNote 未提供文件保存接口");
      var filename = String(request.result.filename || "MN4错题导出.pdf").replace(/\.html$/i, ".pdf");
      var path = ensurePdfCacheDirectory(root) + "/" + filename;
      if (!data.writeToFileAtomically(path, true)) throw new Error("PDF 文件写入失败");
      if (controller.exportPdfTask && controller.exportPdfTask.cancelled) {
        // 用户已取消：丢弃产物，不再弹保存面板
        releasePdfRequest(controller);
        return;
      }
      if (controller.exportPdfTask) {
        controller.exportPdfTask.status = "saving";
        controller.exportPdfTask.progress = 96;
      }
      try { webView.evaluateJavaScript("window.__MN_PDF_EXPORT_RELEASE__&&window.__MN_PDF_EXPORT_RELEASE__()", function () {}); } catch (error) {}
      app.saveFileWithUti(path, "com.adobe.pdf");
      releasePdfRequest(controller);
      request.resolve({ savePanelOpened: true, pdfGenerated: true, format: "pdf", filename: filename, count: request.result.count, pages: Number(info.pages) || 0, bytes: dataLength(data) });
    } catch (error) {
      rejectPdfRequest(controller, error);
    }
  }

  function pullPdfChunks(controller, webView) {
    var request = controller && controller.exportPdfRequest;
    if (!request || webView !== controller.exportWebView) return;
    webView.evaluateJavaScript("JSON.stringify(window.__MN_PDF_EXPORT_INFO__||null)", function (rawInfo) {
      var info;
      try { info = JSON.parse(String(rawInfo || "null")); } catch (error) {}
      if (!info || Number(info.chunkSize) !== 65536 || !Number(info.byteLength) || !Number(info.pages) || !Number(info.chunks) || Number(info.chunks) > 4096 || Number(info.base64Length) > 150 * 1024 * 1024) {
        rejectPdfRequest(controller, new Error("PDF 分块信息无效或文件过大"));
        return;
      }
      var chunks = [];
      info.receivedBase64Length = 0;
      function pull(index) {
        if (!controller.exportPdfRequest || webView !== controller.exportWebView) return;
        if (index >= Number(info.chunks)) {
          webView.evaluateJavaScript("window.__MN_PDF_EXPORT_RELEASE_DATA__&&window.__MN_PDF_EXPORT_RELEASE_DATA__()", function () {
            if (!controller.exportPdfRequest || webView !== controller.exportWebView) return;
            if (controller.exportPdfRequest.result.renderPdfPreview) pullPdfPreviewPages(controller, webView, info, chunks);
            else saveGeneratedPdf(controller, webView, info, chunks, []);
          });
          return;
        }
        if (controller.exportPdfTask) controller.exportPdfTask.progress = Math.min(90, 68 + Math.round(index / Number(info.chunks) * 22));
        startPdfTransferTimer(controller);
        webView.evaluateJavaScript("window.__MN_PDF_EXPORT_TAKE_CHUNK__(" + index + ")", function (chunk) {
          var text = String(chunk || "");
          if (!text.length) {
            rejectPdfRequest(controller, new Error("PDF 数据第 " + (index + 1) + " 块读取失败"));
            return;
          }
          var expectedLength = Math.min(Number(info.chunkSize), Number(info.base64Length) - index * Number(info.chunkSize));
          if (text.length !== expectedLength) { rejectPdfRequest(controller, new Error("PDF 分块长度不匹配")); return; }
          try { chunks.push(decodeBase64ToBinaryString(text)); }
          catch (error) { rejectPdfRequest(controller, error); return; }
          info.receivedBase64Length += text.length;
          pull(index + 1);
        });
      }
      pull(0);
    });
  }

  function pullPdfPreviewPages(controller, webView, info, pdfChunks) {
    var lengths = Array.isArray(info.previewPageLengths) ? info.previewPageLengths.map(Number) : [];
    if (!lengths.length || lengths.length > 200 || lengths.some(function (length) { return !length || length > 30 * 1024 * 1024; })) {
      saveGeneratedPdf(controller, webView, info, pdfChunks, []);
      return;
    }
    var app = Application.sharedInstance();
    var root;
    try { root = ensureCardLinkTempRoot(app); } catch (error) {
      rejectPdfRequest(controller, new Error("当前 MarginNote 未提供 PDF 预览临时目录"));
      return;
    }
    var cacheDirectory = ensurePdfCacheDirectory(root);
    var urls = [];
    function pullPage(pageIndex) {
      if (!controller.exportPdfRequest || webView !== controller.exportWebView) return;
      if (pageIndex >= lengths.length) {
        saveGeneratedPdf(controller, webView, info, pdfChunks, urls);
        return;
      }
      var expectedLength = lengths[pageIndex];
      var chunkCount = Math.ceil(expectedLength / 65536);
      var pageChunks = [];
      function pullChunk(chunkIndex) {
        if (!controller.exportPdfRequest || webView !== controller.exportWebView) return;
        if (chunkIndex >= chunkCount) {
          var base64 = pageChunks.join("");
          if (base64.length !== expectedLength) {
            rejectPdfRequest(controller, new Error("PDF 预览第 " + (pageIndex + 1) + " 页数据不完整"));
            return;
          }
          try {
            var data = decodePdfBase64(base64);
            var path = cacheDirectory + "/preview-page-" + (pageIndex + 1) + ".jpg";
            if (!data.writeToFileAtomically(path, true)) throw new Error("预览图片写入失败");
            urls.push(String(NSURL.fileURLWithPath(path).absoluteString()) + "?t=" + Date.now());
            pullPage(pageIndex + 1);
          } catch (error) {
            rejectPdfRequest(controller, error);
          }
          return;
        }
        startPdfTransferTimer(controller);
        webView.evaluateJavaScript("window.__MN_PDF_EXPORT_TAKE_PREVIEW_CHUNK__(" + pageIndex + "," + chunkIndex + ")", function (chunk) {
          var text = String(chunk || "");
          if (!text.length) {
            rejectPdfRequest(controller, new Error("PDF 预览第 " + (pageIndex + 1) + " 页读取失败"));
            return;
          }
          pageChunks.push(text);
          pullChunk(chunkIndex + 1);
        });
      }
      pullChunk(0);
    }
    pullPage(0);
  }

  function beginPdfFileGeneration(controller, webView) {
    if (!controller || webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    if (controller.exportPdfTask) controller.exportPdfTask.progress = 36;
    tracePdf(controller, "raster.begin");
    webView.evaluateJavaScript("window.__MN_PDF_FILE_FALLBACK__&&window.__MN_PDF_FILE_FALLBACK_BEGIN__?window.__MN_PDF_FILE_FALLBACK_BEGIN__():'missing-pdf-generator'", function (value) {
      if (String(value) === "missing-pdf-generator") {
        rejectPdfRequest(controller, new Error("PDF 生成模块未能加载"));
      }
    });
  }

  function completePdfExport(controller, webView) {
    if (!controller || webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    if (controller.exportPdfRenderStarted) return;
    controller.exportPdfRenderStarted = true;
    if (controller.exportPdfTask) controller.exportPdfTask.progress = 34;
    tracePdf(controller, "ready.begin");
    try {
      webView.evaluateJavaScript("window.__MN_PDF_EXPORT_PROTOCOL_V2__&&window.__MN_PDF_EXPORT_BEGIN__?window.__MN_PDF_EXPORT_BEGIN__():'missing-v2'", function (value) {
        if (String(value) === "missing-v2") {
          rejectPdfRequest(controller, new Error("PDF 页面渲染检查未能加载"));
        }
      });
    } catch (error) {
      rejectPdfRequest(controller, new Error("无法启动 PDF 页面渲染检查：" + (error.message || String(error))));
    }
  }

  function pdfRenderReady(controller, webView) {
    if (!controller || webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    if (controller.exportPdfTask) controller.exportPdfTask.progress = 36;
    beginPdfFileGeneration(controller, webView);
  }

  function pdfDataReady(controller, webView) {
    if (!controller || webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    // 数据传输阶段换上独立看门狗：任一块回调丢失都能兜底，不再无限等待
    startPdfTransferTimer(controller);
    if (controller.exportPdfTask) controller.exportPdfTask.progress = 68;
    pullPdfChunks(controller, webView);
  }

  function pdfProgress(controller, webView, url) {
    if (webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    var task = controller.exportPdfTask;
    if (!task || task.cancelled) return;
    var match = String(url).match(/stage=(sizing|planning|rendering|serializing)&completed=(\d+)&total=(\d+)&pages=(\d+)/);
    if (!match) return;
    task.stage = match[1];
    task.completed = Number(match[2]); task.total = Number(match[3]);
    task.pages = Number(match[4]);
    if (task.stage === "planning") task.progress = 36 + Math.floor(12 * task.completed / Math.max(1, task.total));
    if (task.stage === "rendering") task.progress = 48 + Math.floor(19 * task.completed / Math.max(1, task.total));
    if (task.stage === "serializing") task.progress = 67;
    tracePdf(controller, task.stage, task.completed + "/" + task.total + " pages=" + task.pages);
    clearPdfRenderTimer(controller);
    controller.exportPdfRenderTimer = NSTimer.scheduledTimerWithTimeInterval(120, false, function () {
      if (controller.exportPdfTask === task) rejectPdfRequest(controller, new Error("PDF " + task.stage + " 阶段无进展，请查看诊断日志"));
    });
  }

  function startPdfTransferTimer(controller) {
    clearPdfRenderTimer(controller);
    controller.exportPdfRenderTimer = NSTimer.scheduledTimerWithTimeInterval(120, false, function () {
      rejectPdfRequest(controller, new Error("PDF 数据传输超时，请缩小导出范围后重试"));
    });
  }

  function pdfRenderError(controller, webView, message) {
    if (!controller || webView !== controller.exportWebView || !controller.exportPdfRequest) return;
    tracePdf(controller, "render.error", message);
    rejectPdfRequest(controller, new Error("PDF 页面渲染失败：" + (message || "未知错误")));
  }

  function renderPdf(context, result, preparationTask) {
    if (!result || (!result.renderPdf && !result.renderPdfPreview)) return result;
    var isPreview = result.renderPdfPreview === true;
    return new Promise(function (resolve, reject) {
      var controller = context.controller;
      if (preparationTask && (preparationTask.cancelled || controller.exportPdfTask !== preparationTask)) { resolve({ cancelled: true }); return; }
      var active = preparationTask ? null : controller.exportPdfTask;
      if (active && active.preview && (active.status === "preparing" || active.status === "rendering" || active.status === "saving")) {
        // 兼容旧版本残留的预览幽灵任务：预览不轮询、不可能真在进行中，直接丢弃
        releasePdfRequest(controller);
        controller.exportPdfTask = null;
        active = null;
      }
      if (active && (active.status === "preparing" || active.status === "rendering" || active.status === "saving")) {
        // 预览与正式导出共用任务槽：任何方向有活动任务都拒绝新的，防止 WebView 串线
        reject(new Error("已有 PDF 导出任务进行中，请等待完成或取消"));
        return;
      }
      var task = preparationTask || {
        id: "pdf-" + Date.now().toString(36),
        status: "rendering",
        preview: isPreview,
        count: Number(result.count) || 0,
        filename: String(result.filename || ""),
        pages: 0,
        progress: 5,
        saved: false,
        cancelled: false,
        error: undefined
      };
      task.status = "rendering";
      task.progress = 32;
      task.count = Number(result.count) || 0;
      task.filename = String(result.filename || "");
      controller.exportPdfTask = task;
      controller.exportPdfRequest = {
        result: result,
        resolve: function (value) {
          if (isPreview) {
            // 预览不走轮询：立即清空任务槽，绝不能残留 rendering 状态阻塞后续导出
            controller.exportPdfTask = null;
            resolve(value);
            return;
          }
          // 任务式：导出完成后状态落账（保存面板已由 completePdfExport 打开）
          task.status = task.cancelled ? "cancelled" : "generated";
          task.progress = task.cancelled ? task.progress : 100;
          task.saved = false;
          task.pages = Number(value && value.pages) || task.pages;
        },
        reject: function (error) {
          task.status = task.cancelled ? "cancelled" : "error";
          task.error = error && error.message ? String(error.message) : String(error);
          if (isPreview) controller.exportPdfTask = null;
          reject(error);
        }
      };
      controller.exportPdfRenderStarted = false;
      var timeout = Math.min(600, Math.max(90, Number(result.count || 1) * 20));
      controller.exportPdfRenderTimer = NSTimer.scheduledTimerWithTimeInterval(timeout, false, function () {
        rejectPdfRequest(controller, new Error("PDF 生成准备超时，请缩小导出范围后重试"));
      });
      try {
        controller.exportWebView = new UIWebView({ x: -10000, y: 0, width: 595.2, height: 841.8 });
        controller.exportWebView.delegate = controller;
        var study = Application.sharedInstance().studyController(context.addon.window);
        study.view.addSubview(controller.exportWebView);
        var entry = NSURL.fileURLWithPath(stagePdfRenderPage(controller, result.html, isPreview, result.pdfAssets));
        result.html = "";
      controller.exportWebView.loadRequest(NSURLRequest.requestWithURL(entry));
      } catch (error) {
        // 初始化失败同样要终账：释放 WebView、失效定时器、清空任务槽
        rejectPdfRequest(controller, error);
        return;
      }
      if (!isPreview) {
        // 任务式受理：立即应答，前端经 pdfTaskStatus 轮询进度
        resolve({ taskAccepted: true, taskId: task.id, status: task.status, progress: task.progress, filename: task.filename, count: task.count });
      }
    });
  }

  function dispatch(context, command, payload) {
    if (command === "clearLocalCache") {
      var cacheTask = context.controller.exportPdfTask;
      if (context.controller.exportPdfRequest || (cacheTask && ["preparing", "rendering", "saving"].indexOf(cacheTask.status) >= 0)) {
        throw new Error("请等待 PDF 预览或导出完成后再清理缓存");
      }
    }
    if (command === "closePanel") {
      context.closePanel(context.controller);
      // 官方"工具栏与命令"要求：可见性状态变化后必须刷新，否则图标选中态与实际脱节
      try { Application.sharedInstance().studyController(context.addon.window).refreshAddonCommands(); } catch (error) {}
      return { closed: true };
    }
    if (command === "resetPanelFrame") {
      return context.resetPanelFrame(context.controller);
    }
    if (command === "setPanelCloseButtonSide") {
      return context.setPanelCloseButtonSide(context.controller, payload && payload.side);
    }
    if (command === "setPluginEnabled") {
      // 显式传入所属 addon；委托回调中的全局 self 可能是 PanelController。
      return __MN_ANSWER_CORE_GLOBAL__.cardToolbar.setEnabled(payload && payload.enabled === true, context.addon);
    }
    if (command === "dashboard") {
      var dashboard = __MN_ANSWER_CORE_GLOBAL__.bridge(command, payload, context.addon);
      function attachPanelSettings(value) {
        if (value && value.matching) {
          value.matching.panelCloseButtonSide = context.panelCloseButtonSide();
          value.matching.pluginEnabled = context.pluginEnabled();
        }
        return value;
      }
      return dashboard && typeof dashboard.then === "function"
        ? dashboard.then(attachPanelSettings)
        : attachPanelSettings(dashboard);
    }
    if (command === "pdfTaskStatus") {
      var task = context.controller.exportPdfTask;
      if (!task || (payload && payload.id && payload.id !== task.id)) return { exists: false, status: "idle" };
      function taskStatus(progress) {
        if (context.controller.exportPdfTask !== task) return { exists: false, status: "idle" };
        if (task.status === "preparing" && progress && progress.total) task.progress = 6 + Math.floor(24 * progress.prepared / progress.total);
        return { exists: true, id: task.id, status: task.status, progress: task.progress, pages: task.pages, stage: task.stage, completed: task.completed, total: task.total, snapshot: task.snapshot, saved: task.saved, error: task.error, filename: task.filename, preview: task.preview };
      }
      if (task.status === "preparing") {
        var progress = __MN_ANSWER_CORE_GLOBAL__.bridge("mistakeExportPreparationStatus", {}, context.addon);
        return progress && typeof progress.then === "function" ? progress.then(taskStatus) : taskStatus(progress);
      }
      return taskStatus();
    }
    if (command === "pdfTaskCancel") {
      var task = context.controller.exportPdfTask;
      if (!task || !payload || payload.id !== task.id) return { cancelled: false, status: "stale" };
      if (task.status === "preparing") __MN_ANSWER_CORE_GLOBAL__.bridge("cancelMistakeExportPreparation", {}, context.addon);
      var cancellable = task.status === "preparing" || task.status === "rendering" || task.status === "saving";
      if (cancellable) {
        task.cancelled = true;
        task.status = "cancelled";
        var request = context.controller.exportPdfRequest;
        releasePdfRequest(context.controller);
        if (request) request.reject(new Error("已取消导出"));
      }
      return { cancelled: cancellable, id: task.id, status: task.status };
    }
    // 需要创建原生控件的命令必须拿到真正的 addon；WebPanelController 只负责
    // 桥接与窗口，不具备 addon 上注册的 selector。
    if (command === "previewMistakeExport") {
      var exporting = context.controller.exportPdfTask;
      if (context.controller.exportPdfPreparing || (exporting && /^(preparing|rendering|saving)$/.test(exporting.status))) throw new Error("已有导出任务进行中");
    }
    if (command === "exportMistakes" && payload && payload.format === "pdf") {
      var controller = context.controller;
      var previous = controller.exportPdfTask;
      if (controller.exportPdfPreparing || (previous && /^(preparing|rendering|saving)$/.test(previous.status))) throw new Error("已有导出任务进行中");
      payload = JSON.parse(JSON.stringify(payload));
      var preparation = { snapshot: payload, id: "pdf-" + Date.now().toString(36), status: "preparing", progress: 6, count: (payload.recordIds || []).length, filename: payload.filename, saved: false, cancelled: false };
      controller.exportPdfTask = preparation;
      controller.exportPdfPreparing = true;
      NSTimer.scheduledTimerWithTimeInterval(0.01, false, function () {
        if (preparation.cancelled) { controller.exportPdfPreparing = false; return; }
        Promise.resolve().then(function () {
          return __MN_ANSWER_CORE_GLOBAL__.bridge(command, payload, context.addon);
        }).then(function (value) {
          controller.exportPdfPreparing = false;
          if (preparation.cancelled) { cleanupPdfSource(value); return; }
          return renderPdf(context, value, preparation);
        }).catch(function (error) {
          controller.exportPdfPreparing = false;
          if (preparation.cancelled) return;
          preparation.status = "error";
          preparation.error = error && error.message ? String(error.message) : String(error);
        });
      });
      return { taskAccepted: true, taskId: preparation.id, status: preparation.status, progress: preparation.progress, count: preparation.count, snapshot: preparation.snapshot };
    }
    var result = __MN_ANSWER_CORE_GLOBAL__.bridge(command, payload, context.addon);
    if (command !== "exportMistakes" && command !== "previewMistakeExport") return result;
    if (result && typeof result.then === "function") return result.then(function (value) { return renderPdf(context, value); });
    return renderPdf(context, result);
  }

  return {
    decodeMediaBase64: decodePdfBase64,
    dispatch: dispatch,
    completePdfExport: completePdfExport,
    pdfRenderReady: pdfRenderReady,
    pdfDataReady: pdfDataReady,
    pdfProgress: pdfProgress,
    pdfRenderError: pdfRenderError
  };
})();
