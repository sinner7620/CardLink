JSB.require("ui-constants");
var __MNAM_WEB_PANEL_GLOBAL__ = (function () {
  // Panel size is session-only; every MarginNote restart returns to the default frame.
  var FRAME_KEY = "marginnote.extension.mn4-answer-matcher.rails.frame.v4";
  var OPEN_KEY = "marginnote.extension.mn4-answer-matcher.rails.open";
  var CLOSE_SIDE_KEY = "marginnote.extension.mn4-answer-matcher.rails.close-side.v1";
  var SCHEME = "mnaddon";
  // P1-7：数值来自 rails-native/ui-constants.js 单一来源
  var TITLE_HEIGHT = __MNAM_UI_CONSTANTS__.TITLE_HEIGHT;
  var CONTROL_CLUSTER_WIDTH = __MNAM_UI_CONSTANTS__.CONTROL_CLUSTER_WIDTH;
  var MIN_WIDTH = __MNAM_UI_CONSTANTS__.MIN_WIDTH;
  var MIN_HEIGHT = __MNAM_UI_CONSTANTS__.MIN_HEIGHT;
  // Responses larger than this are stored and pulled chunk by chunk (the
  // chunk slices stay small enough that their own responses never re-chunk).
  var RESPONSE_CHUNK_LIMIT = 48000;
  var RESPONSE_CHUNK_CHARS = 32000;
  var MAX_PENDING_RESPONSES = 8;
  var MAX_PENDING_REQUESTS = 8;

  function responseScript(response, serialized) {
    var raw = (serialized || JSON.stringify(response)).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return "window.__MN_WEB_BRIDGE_RECEIVE_FN__('" + raw + "')";
  }

  function sendResponse(controller, webView, requestId, payload, error) {
    var response = {
      requestId: requestId,
      payload: payload === undefined ? null : payload,
      // 码化错误的 code 随信封透出（未码化错误无 code，序列化时省略）；
      // Web 端只消费 message，code 仅供诊断与后续按码翻译。
      error: error ? { code: typeof error.code === "string" ? error.code : undefined, message: error.message || String(error) } : null
    };
    var raw = JSON.stringify(response);
    if (raw.length > RESPONSE_CHUNK_LIMIT) {
      var chunks = [];
      for (var index = 0; index < raw.length; index += RESPONSE_CHUNK_CHARS) {
        chunks.push(raw.slice(index, index + RESPONSE_CHUNK_CHARS));
      }
      if (controller) {
        controller.pendingResponses = controller.pendingResponses || {};
        var keys = Object.keys(controller.pendingResponses);
        while (keys.length >= MAX_PENDING_RESPONSES) {
          delete controller.pendingResponses[keys.shift()];
          keys = Object.keys(controller.pendingResponses);
        }
        controller.pendingResponses[requestId] = { chunks: chunks };
      }
      webView.evaluateJavaScript(responseScript({
        requestId: requestId,
        chunked: { total: chunks.length, length: raw.length }
      }), function () {});
      return;
    }
    webView.evaluateJavaScript(responseScript(response, raw), function () {});
  }

  function respondWithResponseChunk(controller, webView, message) {
    var target = String(message.payload && message.payload.requestId || "");
    var index = Number(message.payload && message.payload.index) || 0;
    var stored = controller.pendingResponses && controller.pendingResponses[target];
    if (!stored || index < 0 || index >= stored.chunks.length) {
      sendResponse(controller, webView, message.requestId, null, new Error("响应分块不存在或已过期，请重试"));
      return;
    }
    var done = index >= stored.chunks.length - 1;
    sendResponse(controller, webView, message.requestId, {
      requestId: target,
      index: index,
      data: stored.chunks[index],
      done: done
    }, null);
    if (done) delete controller.pendingResponses[target];
  }

  function handleRequestPart(controller, webView, part, respond) {
    controller.pendingRequests = controller.pendingRequests || {};
    var requestId = String(part.requestId || "");
    var total = Number(part.total) || 0;
    var index = Number(part.index) || 0;
    if (!requestId || total < 1 || total > 4096 || index < 0 || index >= total) {
      sendResponse(controller, webView, requestId || "unknown", null, new Error("请求分块信息无效"));
      return;
    }
    var keys = Object.keys(controller.pendingRequests);
    while (keys.length >= MAX_PENDING_REQUESTS) {
      delete controller.pendingRequests[keys.shift()];
      keys = Object.keys(controller.pendingRequests);
    }
    var entry = controller.pendingRequests[requestId];
    if (!entry || entry.total !== total) {
      entry = { total: total, parts: {}, received: 0 };
      controller.pendingRequests[requestId] = entry;
    }
    if (entry.parts[index] === undefined) {
      entry.parts[index] = String(part.data || "");
      entry.received += 1;
    }
    if (entry.received < total) return;
    delete controller.pendingRequests[requestId];
    var slices = [];
    for (var position = 0; position < total; position++) slices.push(entry.parts[position] || "");
    var assembled;
    try {
      assembled = JSON.parse(slices.join(""));
    } catch (error) {
      sendResponse(controller, webView, requestId, null, new Error("请求分块重组失败：" + (error.message || String(error))));
      return;
    }
    respond({ command: assembled.command, requestId: requestId, payload: assembled.payload });
  }

  function decodeMessage(url) {
    var absolute = String(url.absoluteString());
    var marker = "payload=";
    var index = absolute.indexOf(marker);
    if (index < 0) throw new Error("桥接消息缺少 payload");
    return JSON.parse(decodeURIComponent(absolute.slice(index + marker.length)));
  }

  function defaultFrame(controller) {
    var bounds = panelHost(controller).bounds;
    var width = Math.max(MIN_WIDTH, Math.min(720, bounds.width - 32));
    var height = Math.max(MIN_HEIGHT, Math.min(560, bounds.height - 32));
    return {
      x: 16,
      y: 16,
      width: width,
      height: height
    };
  }

  // 只限制尺寸（下限 + 不超过宿主）；位置由 clampFrameTop 单独约束顶边。
  function clampFrameSize(controller, frame) {
    var host = panelHost(controller);
    var bounds = host ? host.bounds : null;
    if (!bounds || !Number(bounds.width) || !Number(bounds.height)) {
      return {
        x: Number(frame.x) || 0,
        y: Number(frame.y) || 0,
        width: Math.max(MIN_WIDTH, Number(frame.width) || MIN_WIDTH),
        height: Math.max(MIN_HEIGHT, Number(frame.height) || MIN_HEIGHT)
      };
    }
    return {
      x: Number(frame.x) || 0,
      y: Number(frame.y) || 0,
      width: Math.min(Math.max(MIN_WIDTH, Number(bounds.width) - 16), Math.max(MIN_WIDTH, Number(frame.width) || MIN_WIDTH)),
      height: Math.min(Math.max(MIN_HEIGHT, Number(bounds.height) - 16), Math.max(MIN_HEIGHT, Number(frame.height) || MIN_HEIGHT))
    };
  }

  var FALLBACK_SAFE_AREA_TOP = 20;
  // 根源修复：UIWindow 宿主下浮窗可被拖入窗口顶部安全区，UIKit 会调整
  // UIWebView.scrollView 的 inset/contentOffset，触发旧版 UIWebView 对
  // position:fixed 的错误锚定（顶栏下移、露出白条）。只约束顶边不越入
  // 安全区，其余方向保持自由拖动——这是 v61 时代无此 bug 的结构性原因。
  function safeAreaTop(controller) {
    try {
      var insets = controller.addon.window.safeAreaInsets;
      var top = Number(insets && insets.top);
      if (Number.isFinite(top) && top >= 0) return top;
    } catch (error) {}
    return FALLBACK_SAFE_AREA_TOP;
  }

  function clampFrameTop(controller, frame) {
    return {
      x: Number(frame.x) || 0,
      y: Math.max(safeAreaTop(controller), Number(frame.y) || 0),
      width: Number(frame.width),
      height: Number(frame.height)
    };
  }

  function savedFrame(controller) {
    var value = controller.sessionFrame;
    var frame = clampFrameSize(controller, value && value.width && value.height
      ? {
        x: Number(value.x),
        y: Number(value.y),
        width: Math.max(MIN_WIDTH, Number(value.width)),
        height: Math.max(MIN_HEIGHT, Number(value.height))
      }
      : defaultFrame(controller));
    return clampFrameTop(controller, frame);
  }

  function saveFrame(controller) {
    if (!controller || !controller.view) return;
    var frame = controller.view.frame;
    controller.sessionFrame = {
      x: Number(frame.x),
      y: Number(frame.y),
      width: Number(frame.width),
      height: Number(frame.height)
    };
    var bounds = panelHost(controller).bounds;
    controller.hostSize = { width: Number(bounds.width), height: Number(bounds.height) };
  }

  function resetFrame(controller) {
    if (!controller || !controller.view) return { reset: false };
    var frame = defaultFrame(controller);
    controller.view.autoresizingMask = 0;
    controller.view.frame = frame;
    layoutCloseButton(controller, panelCloseButtonSide());
    saveFrame(controller);
    return { reset: true, frame: frame };
  }

  function closePanel(controller, remember) {
    if (!controller) return;
    if (!controller.webView) {
      if (remember !== false) NSUserDefaults.standardUserDefaults().setObjectForKey(false, OPEN_KEY);
      return;
    }
    // Do not save here. MarginNote may be in the middle of resizing its study
    // view while a notebook is closing; sampling that transient frame causes
    // cumulative panel growth across notebook switches.
    controller.view.hidden = true;
    if (controller.view.superview) controller.view.removeFromSuperview();
    if (remember !== false) NSUserDefaults.standardUserDefaults().setObjectForKey(false, OPEN_KEY);
  }

  function preservePanelForNotebookSwitch(controller) {
    if (!controller || !controller.webView) return;
    controller.preserveAcrossNotebookSwitch = true;
    controller.view.autoresizingMask = 0;
    // Reapply only the stable session frame. Never learn a new size from the
    // notebook transition itself.
    controller.view.frame = savedFrame(controller);
  }

  function restorePanelAfterNotebookSwitch(controller) {
    if (!controller) return;
    var host = panelHost(controller);
    var frame = savedFrame(controller);
    controller.view.autoresizingMask = 0;
    if (controller.view.superview !== host) {
      if (controller.view.superview) controller.view.removeFromSuperview();
      host.addSubview(controller.view);
    }
    controller.view.frame = frame;
    layoutCloseButton(controller, panelCloseButtonSide());
    controller.view.hidden = false;
    controller.preserveAcrossNotebookSwitch = false;
  }

  function ensureLayout(controller) {
    if (!controller || !controller.view || controller.userAdjustingFrame) return;
    if (!controller.sessionFrame || controller.view.hidden) return;
    var bounds = panelHost(controller).bounds;
    if (controller.hostSize && controller.hostSize.width === Number(bounds.width) && controller.hostSize.height === Number(bounds.height)) return;
    controller.hostSize = { width: Number(bounds.width), height: Number(bounds.height) };
    var frame = savedFrame(controller);
    var current = controller.view.frame;
    // 卡片选择也会触发布局回调。几何未变化时不重新赋 frame/重置滚动。
    if (current && ["x", "y", "width", "height"].every(function (key) {
      return Math.abs(Number(current[key]) - Number(frame[key])) < 0.5;
    })) return;
    controller.view.autoresizingMask = 0;
    controller.view.frame = frame;
    layoutCloseButton(controller, panelCloseButtonSide());
  }

  function panelCloseButtonSide() {
    return NSUserDefaults.standardUserDefaults().objectForKey(CLOSE_SIDE_KEY) === "right"
      ? "right"
      : "left";
  }

  function layoutCloseButton(controller, side) {
    if (!controller || !controller.view) return;
    controller.panelCloseSide = side === "right" ? "right" : "left";
  }

  function setCloseButtonSide(controller, side) {
    var normalized = side === "right" ? "right" : "left";
    NSUserDefaults.standardUserDefaults().setObjectForKey(normalized, CLOSE_SIDE_KEY);
    layoutCloseButton(controller, normalized);
    // 同一设置同时控制插件页与答案窗口；只通知已存在的答案窗口重排，
    // 不在此处复制答案窗口的坐标、关闭或刷新逻辑。
    try {
      if (controller.addon && typeof controller.addon.onPanelCloseButtonSideChanged === "function") {
        controller.addon.onPanelCloseButtonSideChanged(normalized);
      }
    } catch (error) {}
    return { side: normalized };
  }

  function setup(controller) {
    var frame = { x: 0, y: 0, width: 900, height: 640 };
    controller.view.autoresizingMask = 0;
    controller.view.frame = frame;
    controller.view.backgroundColor = UIColor.clearColor();
    controller.view.layer.cornerRadius = 14;
    controller.view.layer.masksToBounds = false;
    controller.view.layer.shadowColor = UIColor.blackColor();
    controller.view.layer.shadowOffset = { width: 0, height: 3 };
    controller.view.layer.shadowRadius = 12;
    controller.view.layer.shadowOpacity = 0.16;

    controller.webReady = false;
    controller.webView = new UIWebView({
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height
    });
    controller.webView.autoresizingMask = (1 << 1) | (1 << 4);
    try { controller.webView.opaque = false; } catch (error) {}
    try { controller.webView.backgroundColor = UIColor.clearColor(); } catch (error) {}
    try { controller.webView.layer.cornerRadius = 14; } catch (error) {}
    try { controller.webView.layer.masksToBounds = true; } catch (error) {}
    // Scroll architecture: all scrolling happens inside inner Web containers
    // (.mistakeList / .reviewPage / ...). The root UIScrollView is disabled ONCE
    // here and never participates again — the native layer only manages window
    // geometry; no scroll compensation runs on drag/layout events.
    try { controller.webView.scrollView.scrollEnabled = false; } catch (error) {}
    try { controller.webView.scrollView.bounces = false; } catch (error) {}
    try { controller.webView.scrollView.alwaysBounceVertical = false; } catch (error) {}
    try { controller.webView.scrollView.alwaysBounceHorizontal = false; } catch (error) {}
    try { controller.automaticallyAdjustsScrollViewInsets = false; } catch (error) {}
    try { controller.webView.scrollView.contentInsetAdjustmentBehavior = 2; } catch (error) {}
    try { controller.webView.scrollView.contentInset = { top: 0, left: 0, bottom: 0, right: 0 }; } catch (error) {}
    try { controller.webView.scrollView.scrollIndicatorInsets = { top: 0, left: 0, bottom: 0, right: 0 }; } catch (error) {}
    controller.webView.delegate = controller;
    controller.view.addSubview(controller.webView);
    var bootLabel = new UILabel({ x: 20, y: 60, width: frame.width - 40, height: 36 });
    bootLabel.text = "正在载入错题工作台…";
    // 运行时不暴露 UIFont 全局：此处引用会抛错并中断 setup（启动提示因此从未显示过）。
    bootLabel.textColor = UIColor.grayColor();
    bootLabel.autoresizingMask = 1 << 1;
    controller.view.addSubview(bootLabel);
    controller.bootLabel = bootLabel;
    controller.headerPan = new UIPanGestureRecognizer(controller, "handleHeaderPan:");
    controller.headerPan.cancelsTouchesInView = false;
    // UIWebView 会把 iPad 蓝牙鼠标/触控板的间接指针事件优先交给网页。
    // 显式允许 direct touch(0) 与 indirect pointer(4)，让同一原生标题栏拖动
    // 架构同时接收手指和外接鼠标，不另叠一层会遮挡网页按钮的透明视图。
    try { controller.headerPan.allowedTouchTypes = [0, 4]; } catch (error) {}
    try { controller.headerPan.allowedScrollTypesMask = 3; } catch (error) {}
    controller.headerPan.delegate = controller;
    controller.webView.addGestureRecognizer(controller.headerPan);
    layoutCloseButton(controller, panelCloseButtonSide());

    // HIG 最小触控目标 44×44。
    var resize = new UILabel({ x: frame.width - 50, y: frame.height - 50, width: 44, height: 44 });
    resize.text = "↘";
    resize.textAlignment = 1;
    resize.textColor = UIColor.grayColor();
    resize.userInteractionEnabled = true;
    resize.autoresizingMask = (1 << 0) | (1 << 3);
    var resizePan = new UIPanGestureRecognizer(controller, "handleResize:");
    try { resizePan.allowedTouchTypes = [0, 4]; } catch (error) {}
    try { resizePan.allowedScrollTypesMask = 3; } catch (error) {}
    resize.addGestureRecognizer(resizePan);
    controller.resizePan = resizePan;
    controller.view.addSubview(resize);

    var entry = NSURL.fileURLWithPath(controller.mainPath + "/web-dist/index.html");
    controller.webView.loadRequest(NSURLRequest.requestWithURL(entry));
  }

  function dispatchBridgeMessage(controller, webView, message) {
    if (message.command === "runtimeLog" && message.payload && message.payload.event === "boot.appRendered" && controller.bootLabel) {
      controller.bootLabel.removeFromSuperview();
      controller.bootLabel = null;
    }
    var context = {
      controller: controller,
      addon: controller.addon,
      closePanel: closePanel,
      resetPanelFrame: resetFrame,
      panelCloseButtonSide: panelCloseButtonSide,
      setPanelCloseButtonSide: setCloseButtonSide,
      pluginEnabled: function () { return __MN_ANSWER_CORE_GLOBAL__.cardToolbar.isEnabled(); }
    };
    try {
      var result = __MNAM_WEB_BRIDGE_GLOBAL__.dispatch(context, message.command, message.payload);
      if (result && typeof result.then === "function") {
        result.then(function (payload) { sendResponse(controller, webView, message.requestId, payload, null); })
          .catch(function (error) { sendResponse(controller, webView, message.requestId, null, error); });
      } else {
        sendResponse(controller, webView, message.requestId, result, null);
      }
    } catch (error) {
      sendResponse(controller, webView, message ? message.requestId : "unknown", null, error);
    }
  }

  var PanelClass = JSB.defineClass(
    "MNAnswerMatcherRailsPanel : UIViewController <UIWebViewDelegate, UIGestureRecognizerDelegate>",
    {
      viewDidLoad: function () { setup(self); },
      gestureRecognizerShouldBegin: function (gesture) {
        if (gesture !== self.headerPan) return true;
        var start = gesture.locationInView(self.view);
        var width = Number(self.view.bounds.width || self.view.frame.width || 0);
        var controlsOnRight = self.panelCloseSide === "right";
        var insideHeader = Number(start.y) >= 0 && Number(start.y) <= TITLE_HEIGHT;
        var insideControls = controlsOnRight
          ? Number(start.x) >= width - CONTROL_CLUSTER_WIDTH
          : Number(start.x) <= CONTROL_CLUSTER_WIDTH;
        self.headerPanActive = insideHeader && !insideControls;
        return self.headerPanActive;
      },
      handleHeaderPan: function (gesture) {
        if (gesture.state === 1) {
          if (self.headerPanActive) self.userAdjustingFrame = true;
        }
        if (!self.headerPanActive) {
          gesture.setTranslationInView({ x: 0, y: 0 }, self.view.superview);
          return;
        }
        var translation = gesture.translationInView(self.view.superview);
        var frame = self.view.frame;
        // 位置自由，仅顶边受 clampFrameTop 约束：浮窗顶部不越入窗口安全区，
        // UIKit 就不会调整 UIWebView 的 inset/contentOffset，旧版 UIWebView
        // 对 position:fixed 的错误锚定（顶栏下移白条）无从触发。
        self.view.frame = clampFrameTop(self, {
          x: Number(frame.x) + Number(translation.x),
          y: Number(frame.y) + Number(translation.y),
          width: Number(frame.width),
          height: Number(frame.height)
        });
        gesture.setTranslationInView({ x: 0, y: 0 }, self.view.superview);
        if (gesture.state === 3 || gesture.state === 4 || gesture.state === 5) {
          saveFrame(self);
          self.userAdjustingFrame = false;
          self.headerPanActive = false;
        }
      },
      handleResize: function (gesture) {
        if (gesture.state === 1) {
          self.userAdjustingFrame = true;
        self.resizeStart = { location: gesture.locationInView(self.view.superview), frame: self.view.frame };
        }
        if (!self.resizeStart) return;
        var point = gesture.locationInView(self.view.superview);
        self.view.frame = {
          x: self.resizeStart.frame.x,
          y: self.resizeStart.frame.y,
          width: Math.max(MIN_WIDTH, self.resizeStart.frame.width + point.x - self.resizeStart.location.x),
          height: Math.max(MIN_HEIGHT, self.resizeStart.frame.height + point.y - self.resizeStart.location.y)
        };
        layoutCloseButton(self, panelCloseButtonSide());
        if (gesture.state === 3 || gesture.state === 4 || gesture.state === 5) {
          saveFrame(self);
          self.resizeStart = null;
          self.userAdjustingFrame = false;
        }
      },
      webViewShouldStartLoadWithRequestNavigationType: function (webView, request) {
        var url = request.URL();
        if (String(url.scheme || "").toLowerCase() !== SCHEME) return true;
        var absolute = String(url.absoluteString());
        if (webView === self.exportWebView && absolute.indexOf("mnaddon://pdf-render-ready") === 0) {
          __MNAM_WEB_BRIDGE_GLOBAL__.pdfRenderReady(self, webView);
          return false;
        }
        if (webView === self.exportWebView && absolute.indexOf("mnaddon://pdf-data-ready") === 0) {
          __MNAM_WEB_BRIDGE_GLOBAL__.pdfDataReady(self, webView);
          return false;
        }
        if (webView === self.exportWebView && absolute.indexOf("mnaddon://pdf-render-error") === 0) {
          var marker = "message=";
          var markerIndex = absolute.indexOf(marker);
          var renderError = markerIndex < 0 ? "未知错误" : decodeURIComponent(absolute.slice(markerIndex + marker.length));
          __MNAM_WEB_BRIDGE_GLOBAL__.pdfRenderError(self, webView, renderError);
          return false;
        }
        var message;
        try {
          message = decodeMessage(url);
        } catch (error) {
          sendResponse(self, webView, "unknown", null, error);
          return false;
        }
        if (message.__bridgeRequestPart) {
          handleRequestPart(self, webView, message.__bridgeRequestPart, function (assembled) {
            dispatchBridgeMessage(self, webView, assembled);
          });
          return false;
        }
        if (message.command === "__pullResponseChunk") {
          respondWithResponseChunk(self, webView, message);
          return false;
        }
        dispatchBridgeMessage(self, webView, message);
        return false;
      },
      webViewDidFinishLoad: function (webView) {
        if (self.exportWebView && webView === self.exportWebView) {
          __MNAM_WEB_BRIDGE_GLOBAL__.completePdfExport(self, webView);
          return;
        }
        if (webView === self.webView) {
          self.webReady = true;
          // 页面载入完成即做一次完整复位：面板可能已停在屏幕顶部，
          // fixed 顶栏需要按清零后的 offset 重新锚定。
        }
      }
    }
  );

  function createController(mainPath, addon) {
    var controller = PanelClass.new();
    controller.mainPath = mainPath;
    controller.addon = addon;
    // 提前装载同一 WebView，隐藏期间也可解析脚本；不打开窗口、不发送重复 dashboard。
    controller.view.hidden = true;
    return controller;
  }

  function panelHost(controller) {
    // 学习视图选中卡片会临时改 frame；插件面板是独立浮窗，坐标归属场景 UIWindow。
    return controller.addon.window;
  }

  function showPanel(controller) {
    if (!controller) return;
    var host = panelHost(controller);
    if (!host) return;
    var frame = savedFrame(controller);
    controller.view.autoresizingMask = 0;
    if (controller.view.superview !== host) {
      if (controller.view.superview) controller.view.removeFromSuperview();
      host.addSubview(controller.view);
    }
    controller.view.frame = frame;
    layoutCloseButton(controller, panelCloseButtonSide());
    // Establish a stable frame at a controlled point. Only explicit user
    // movement/resizing or resetFrame may change sessionFrame afterwards.
    saveFrame(controller);
    controller.view.hidden = false;
    NSUserDefaults.standardUserDefaults().setObjectForKey(true, OPEN_KEY);
    // 首次创建由 React 挂载后的单次初始加载负责 dashboard；仅在后续
    // 已完成页面加载的面板重新显示时刷新，避免冷启动双请求阻塞首帧。
    // 跨学习集定位跳转后的恢复携带 skipReload：跳转不改变错题数据。
    if (controller.webReady) {
      var skipReload = false;
      try {
        if (controller.addon && typeof controller.addon.shouldSuppressPanelReload === "function") {
          skipReload = controller.addon.shouldSuppressPanelReload() === true;
        }
      } catch (error) {}
      controller.webView.evaluateJavaScript(
        "window.__onPanelShow&&window.__onPanelShow(" + (skipReload ? "true" : "false") + ")",
        function () {}
      );
    }
  }

  function resetAndShowPanel(controller) {
    if (!controller) return { reset: false };
    // 先强制挂回学习视图并触发 view 加载，再应用默认尺寸；隐藏状态也能复原。
    showPanel(controller);
    return resetFrame(controller);
  }

  function destroyPanel(controller) {
    closePanel(controller, false);
    if (controller && controller.webView) controller.webView.delegate = null;
    if (controller) {
      controller.pendingResponses = null;
      controller.pendingRequests = null;
    }
  }

  return {
    createController: createController,
    showPanel: showPanel,
    preservePanelForNotebookSwitch: preservePanelForNotebookSwitch,
    restorePanelAfterNotebookSwitch: restorePanelAfterNotebookSwitch,
    resetFrame: resetFrame,
    resetAndShowPanel: resetAndShowPanel,
    hidePanel: closePanel,
    destroyPanel: destroyPanel,
    shouldRestorePanel: function () { return NSUserDefaults.standardUserDefaults().objectForKey(OPEN_KEY) === true; },
    isVisible: function (controller) { return !!(controller && controller.view && controller.view.superview && !controller.view.hidden); },
    ensureLayout: ensureLayout,
    // v64：把现有实现导出给悬浮球快捷菜单复用；持久化与布局仍由原函数完成
    panelCloseButtonSide: panelCloseButtonSide,
    setPanelCloseButtonSide: setCloseButtonSide
  };
})();
