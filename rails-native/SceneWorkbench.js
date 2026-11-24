var __MNAM_SCENE_WORKBENCH_GLOBAL__ = (function () {
  var sessions = Object.create(null), sequence = 0;
  var legacy = __MNAM_WEB_PANEL_GLOBAL__;
  var originalShow = legacy.showPanel, originalHide = legacy.hidePanel;
  var originalVisible = legacy.isVisible, originalRestore = legacy.restorePanelAfterNotebookSwitch;
  var OPEN_KEY = "marginnote.extension.mn4-answer-matcher.rails.open";
  function key(owner) { return typeof owner.cardLinkSceneToken === "string" ? owner.cardLinkSceneToken : ""; }
  function session(owner) { return owner ? sessions[key(owner)] : null; }
  function reviewing(current) {
    var owner = current && current.owner;
    return !!(owner && owner.cardLinkReviewMode && (owner.cardLinkReviewMode.writingMode === "annotation" || owner.cardLinkReviewMode.writingMode === "handwriting") && typeof owner.cardLinkReviewAnnotationClosed === "function");
  }
  function version() { return String(Application.sharedInstance().appVersion || ""); }
  function eligible(owner) { return __MN_ANSWER_CORE_GLOBAL__.isSceneMode(owner) && typeof AddonWebPanel !== "undefined"; }
  function log(event, detail) { __MN_ANSWER_CORE_GLOBAL__.annotationLog(event, String(detail || "").slice(0, 400)); }
  function remember(open) { NSUserDefaults.standardUserDefaults().setObjectForKey(open, OPEN_KEY); }
  function surfaceLog(current, event, detail) {
    current.owner.cardLinkSceneSurfaceStatus = { event: event, detail: detail, at: Date.now() };
    try { console.log('CardLink ' + event + ': ' + detail); } catch (_) {}
    log(event, detail);
  }
  function nativeClassName(view) {
    try {
      var name = typeof view.className === 'function' ? view.className() : view.className;
      if (name) return String(name);
    } catch (_) {}
    try {
      var description = typeof view.description === 'function' ? view.description() : view.description;
      var match = String(description || view).match(/<?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:|\s*>)/);
      if (match) return match[1];
    } catch (_) {}
    try {
      var tag = Object.prototype.toString.call(view).match(/^\[object ([^\]]+)\]$/);
      if (tag && tag[1] !== 'Object') return tag[1];
    } catch (_) {}
    return '';
  }
  // 面板表面可见性补偿：宿主会把承载插件的原生容器淡化到约 0.6，这里只读取
  // 原生 alpha／图层值，在被淡化时校正回可见；不依赖 URL、网页脚本或页面标识。
  function opacityNumber(value) { return typeof value === 'number' && isFinite(value) ? Math.round(value * 1000) / 1000 : null; }
  function nativeSurfaceState(view) {
    var alpha = null, opacity = null;
    try { alpha = opacityNumber(view.alpha); } catch (_) {}
    try { opacity = opacityNumber(view.layer.opacity); } catch (_) {}
    return { alpha: alpha, opacity: opacity };
  }
  function fadedSurfaceCandidates(owner) {
    var result = [], scanned = 0, stack = [{ view: owner.window, depth: 0 }];
    while (stack.length && scanned++ < 2600) {
      var entry = stack.pop(), view = entry.view;
      if (!view) continue;
      if (nativeClassName(view) === 'WKWebView') {
        try {
          var parent = view.superview, frame = parent && parent.frame, alpha = parent && parent.alpha;
          if (parent && !view.hidden && !parent.hidden && nativeClassName(parent) === 'UIView' &&
              opacityNumber(alpha) !== null && alpha >= .51 && alpha <= .71 && frame && frame.width >= 280 && frame.height >= 180) {
            result.push({ view: parent, web: view });
          }
        } catch (_) {}
      }
      if (entry.depth >= 14) continue;
      try {
        var children = view.subviews || [];
        for (var i = Math.min(children.length, 100) - 1; i >= 0; i--) stack.push({ view: children[i], depth: entry.depth + 1 });
      } catch (_) {}
    }
    return result;
  }
  function restoreSurfaceVisibility(view) {
    var before = nativeSurfaceState(view);
    try { if (view.layer) view.layer.opacity = 1; } catch (_) {}
    var after = nativeSurfaceState(view);
    if ((after.opacity === null || after.opacity < .985) && typeof view.setAlpha === 'function') {
      try { view.setAlpha(1); } catch (_) {}
      after = nativeSurfaceState(view);
    }
    return { before: before, after: after,
      success: after.opacity !== null && after.opacity >= .985 || after.alpha !== null && after.alpha >= .985 };
  }
  function applySurfaceVisibility(current, target) {
    var result = restoreSurfaceVisibility(target);
    current.surfaceFailures = result.success ? 0 : (current.surfaceFailures || 0) + 1;
    current.surfaceRepairs = (current.surfaceRepairs || 0) + 1;
    if (current.surfaceVisible !== result.success || current.surfaceRepairs === 1) {
      surfaceLog(current, result.success ? 'panel.surfaceVisible' : 'panel.surfaceHidden',
        'alpha=' + result.before.alpha + ', layer=' + result.before.opacity + ' -> alpha=' + result.after.alpha + ', layer=' + result.after.opacity);
    }
    current.surfaceVisible = result.success;
    return result.success;
  }
  function watchPanelSurface(current) {
    if (current.surfaceTimer || current.collapsed || current.rejected) return;
    var lastLookup = 0;
    function checkSurface() {
      if (current.collapsed || current.rejected) return;
      try {
        var target = current.surfaceTarget;
        if (!target || !target.superview) {
          current.surfaceTarget = null;
          if (Date.now() - lastLookup < 1000) return;
          lastLookup = Date.now();
          var candidates = fadedSurfaceCandidates(current.owner);
          if (current.surfaceCandidateCount !== candidates.length) {
            current.surfaceCandidateCount = candidates.length;
            surfaceLog(current, 'panel.surfaceCandidates', candidates.length === 0 ? '等待原生网页容器 alpha 变为约 0.6'
              : candidates.length === 1 ? '发现唯一被淡化的原生网页容器，执行首次校正'
              : '检测到 ' + candidates.length + ' 个被淡化的原生网页容器，为避免误改，不处理任何一个');
          }
          if (candidates.length !== 1) return;
          target = candidates[0].view;
          // 首次绑定即校正一次：alpha 可能已读为 .6，而 CALayer.opacity 仍读为 1。
          if (applySurfaceVisibility(current, target)) current.surfaceTarget = target;
          return;
        }
        if (target.hidden || !target.layer) return;
        var state = nativeSurfaceState(target);
        // 图层值优先，仅当图层属性不可读时才回退到 alpha。
        var value = state.opacity !== null ? state.opacity : state.alpha;
        if (value !== null && value > .05 && value < .97) {
          applySurfaceVisibility(current, target);
          if (current.surfaceFailures > 10) {
            current.surfaceTarget = null;
            surfaceLog(current, 'panel.surfaceWatchStopped', '连续校正失败，停止监视此容器，等待重新检测');
          }
        }
      } catch (error) {
        current.surfaceTarget = null;
        surfaceLog(current, 'panel.surfaceWatch', error.message || String(error));
      }
    }
    current.surfaceTimer = NSTimer.scheduledTimerWithTimeInterval(0.5, true, checkSurface);
    try {
      if (typeof NSRunLoop !== 'undefined') {
        var loop = typeof NSRunLoop.mainRunLoop === 'function' ? NSRunLoop.mainRunLoop()
          : typeof NSRunLoop.currentRunLoop === 'function' ? NSRunLoop.currentRunLoop() : null;
        if (loop && typeof loop.addTimerForMode === 'function') loop.addTimerForMode(current.surfaceTimer,
          typeof NSRunLoopCommonModes !== 'undefined' ? NSRunLoopCommonModes : 'kCFRunLoopCommonModes');
      }
    } catch (_) {}
    checkSurface();
  }
  function unwatchPanelSurface(current) {
    if (current.surfaceTimer) { current.surfaceTimer.invalidate(); current.surfaceTimer = null; }
  }
  function clearStartTimer(current) {
    if (current.startTimer) { current.startTimer.invalidate(); current.startTimer = null; }
  }
  function finishReady(current, value) {
    if (current.readyTimer) { current.readyTimer.invalidate(); current.readyTimer = null; }
    if (!current.readyWaiters) return;
    var waiters = current.readyWaiters; current.readyWaiters = null;
    waiters.forEach(function (resolve) { resolve(value); });
  }
  function hide(owner, rememberClosed) {
    var core = globalThis.__MN_ANSWER_CORE_GLOBAL__;
    if (core && typeof core.closeCardMistakePanel === "function") core.closeCardMistakePanel(owner);
    var current = session(owner);
    if (!current) return;
    core.disableMistakeDrag(owner);
    if (current.clipperToolsRequest) {
      current.clipperToolsRequest.timer.invalidate();
      current.clipperToolsRequest.reject(new Error("场景面板已关闭，未读取摘录工具"));
      current.clipperToolsRequest = null;
    }
    if (current.annotationRequest) {
      current.annotationRequest.timer.invalidate();
      current.annotationRequest.reject(new Error("场景面板已关闭，请检查批注窗口"));
      current.annotationRequest = null;
    }
    if (current.foldRequest) {
      current.foldRequest.timer.invalidate();
      current.foldRequest.reject(new Error("场景面板已关闭，分支折叠结果未确认"));
      current.foldRequest = null;
    }
    clearStartTimer(current);
    unwatchPanelSurface(current);
    current.surfaceTarget = null;
    finishReady(current, false);
    delete sessions[key(owner)];
    current.confirmed = false;
    current.panel.hideFloating();
    if (rememberClosed !== false) remember(false);
  }
  function defer(callback) { NSTimer.scheduledTimerWithTimeInterval(0.05, false, callback); }
  function collapse(current) {
    current.collapsed = true;
    __MN_ANSWER_CORE_GLOBAL__.disableMistakeDrag(current.owner);
    unwatchPanelSurface(current);
    clearStartTimer(current);
    remember(false);
    current.panel.post("workbenchCollapse", {});
  }
  function rejectScene(current, controller, reason) {
    finishReady(current, false);
    __MN_ANSWER_CORE_GLOBAL__.disableMistakeDrag(current.owner);
    if (reviewing(current)) {
      current.confirmed = false;
      clearStartTimer(current);
      log("panel.sceneSuspended", reason || "保留批注复习回执通道");
      return;
    }
    if (current.rejected) return;
    current.rejected = true;
    unwatchPanelSurface(current);
    current.confirmed = false;
    clearStartTimer(current);
    log("panel.sceneRejected", reason || "回到经典面板");
    defer(function () {
      if (session(current.owner) !== current) return;
      hide(current.owner, true);
      if (__MN_ANSWER_CORE_GLOBAL__.isSceneMode(current.owner)) __MN_ANSWER_CORE_GLOBAL__.notifySceneUnavailable(reason || "当前场景无法加载 CardLink");
      else originalShow(controller);
    });
  }
  function tryShow(controller) {
    var owner = controller && controller.addon;
    if (!owner || !eligible(owner)) {
      if (owner && session(owner)) hide(owner, false);
      return false;
    }
    var current = session(owner);
    if (current) {
      if (current.confirmed) __MN_ANSWER_CORE_GLOBAL__.enableMistakeDrag(owner);
      var wasCollapsed = current.collapsed === true;
      current.collapsed = false;
      remember(true);
      current.panel.showFloatingIn(Application.sharedInstance().studyController(owner.window));
      watchPanelSurface(current);
      current.panel.post("workbenchRequested", {});
      if (current.confirmed) current.panel.post("panelShown", { skipReload: wasCollapsed || !!controller.preserveAcrossNotebookSwitch });
      controller.preserveAcrossNotebookSwitch = false;
      return true;
    }
    // The host only creates panels permitted by the current scene/template.
    var panel;
    try { panel = AddonWebPanel.panel(); } catch (error) { log("panel.factoryFailed", String(error)); }
    if (!panel) {
      log("panel.unavailable", "host=" + version() + "; 当前场景未获面板许可");
      __MN_ANSWER_CORE_GLOBAL__.notifySceneUnavailable("当前场景模板未授权 CardLink 面板，请检查模板配置");
      return false;
    }
    var token = "cardlink.scene:" + Date.now() + ":" + (++sequence);
    owner.cardLinkSceneToken = token;
    current = { owner: owner, panel: panel, media: __MNAM_SCENE_MEDIA_GLOBAL__.create(panel), confirmed: false, stage: "加载启动资源", appRendered: false };
    sessions[token] = current;
    panel.onMessage = function (name, data) {
      if (sessions[token] !== current) return { error: { message: "场景面板已关闭" } };
      if (name === "hostInfo") {
        current.stage = "读取版本后检测场景状态";
        log("panel.hostInfo", "host=" + version());
        return { version: version() };
      }
      if (name === "sceneLog") { log(data && data.event, data && data.detail); return { logged: true }; }
      if (name === "sceneReady") {
        if (current.rejected) return { enabled: false };
        current.confirmed = eligible(owner) && CardLinkHostPolicy.sceneEnabled(version(), data);
        if (current.confirmed && !current.collapsed) __MN_ANSWER_CORE_GLOBAL__.enableMistakeDrag(owner);
        current.stage = "加载并渲染工作台脚本";
        log("panel.sceneReady", "host=" + version() + "; enabled=" + current.confirmed);
        return { enabled: current.confirmed };
      }
      if (name === "sceneRejected") {
        rejectScene(current, controller, data && data.reason ? (data.stage ? data.stage + ": " : "") + data.reason : "");
        return reviewing(current) ? { retained: true } : { fallback: true };
      }
      if (name === "sceneClose") {
        if (reviewing(current)) { collapse(current); return { minimized: true }; }
        defer(function () { hide(owner, true); }); return { closed: true };
      }
      // Established request replies and close receipts must survive temporary
      // scene suspension. New business still requires a confirmed scene below.
      if (name === "reviewAnnotationReply") {
        var pending = current.annotationRequest;
        if (!pending || !data || pending.id !== data.requestId) return { ignored: true };
        pending.timer.invalidate(); current.annotationRequest = null;
        if (data.error) pending.reject(Object.assign(new Error(data.error), { editorMayBeOpen: data.editorMayBeOpen !== false }));
        else pending.resolve(data.result);
        return { accepted: true };
      }
      if (name === "clipperToolsReply") {
        var toolRequest = current.clipperToolsRequest;
        if (!toolRequest || !data || toolRequest.id !== data.requestId) return { ignored: true };
        toolRequest.timer.invalidate(); current.clipperToolsRequest = null;
        if (data.error) toolRequest.reject(new Error(data.error));
        else toolRequest.resolve(data.result);
        return { accepted: true };
      }
      // 分支折叠只接受当前题卡与该请求的回执；身份在回执里一并带回，供 JSB 读回前核对。
      if (name === "foldBranchReply") {
        var foldRequest = current.foldRequest;
        if (!foldRequest || !data || foldRequest.id !== data.requestId) return { ignored: true };
        foldRequest.timer.invalidate(); current.foldRequest = null;
        var foldResult = Object.assign({}, data.result || {}, { noteid: foldRequest.noteid, sceneToken: key(owner) });
        if (data.error) foldRequest.reject(Object.assign(new Error(String(data.error)),
          { code: data.code, topicid: data.topicid, dispatched: data.dispatched === true }));
        else foldRequest.resolve(foldResult);
        return { accepted: true };
      }
      if (name === "reviewAnnotationClosed") {
        var opening = current.annotationRequest;
        if (opening && !opening.operation && data && opening.reviewToken === data.reviewToken) {
          opening.timer.invalidate(); current.annotationRequest = null;
          opening.resolve({ editorOpened: true });
        }
        var accepted = typeof owner.cardLinkReviewAnnotationClosed === "function" && owner.cardLinkReviewAnnotationClosed(data) === true;
        return { accepted: accepted };
      }
      if (!eligible(owner) || !current.confirmed) return { error: { message: "CardLink 场景面板需要 MarginNote 5 场景模式" } };
      if (name === "sceneMinimize") {
        collapse(current);
        return { minimized: true };
      }
      if (name === "sceneExpand") {
        if (!eligible(owner)) {
          defer(function () { hide(owner, false); originalShow(controller); });
          return { fallback: true };
        }
        current.collapsed = false;
        __MN_ANSWER_CORE_GLOBAL__.enableMistakeDrag(owner);
        remember(true);
        watchPanelSurface(current);
        current.panel.post("workbenchRequested", {});
        return { expanded: true };
      }
      if (name === "sceneCommandReady") {
        current.appRendered = true;
        clearStartTimer(current);
        log("panel.commandReady", "菜单小面板已渲染");
        if (current.readyWaiters) current.panel.post("workbenchRequested", {});
        return { ready: true };
      }
      if (name === "sceneMedia") {
        try { return data && data.file ? current.media.previewFile(data.file) : current.media.dataUri(data && data.dataUri); }
        catch (error) { return { error: { message: error.message || String(error) } }; }
      }
      if (name === "sceneReleaseMedia") { current.media.release(data && data.keys); return { released: true }; }
      if (name === "bridgeRequest") {
        var request = data || {};
        var handwriting = request.command === "openMistakeHandwriting";
        if (handwriting) {
          log("annotation.target.start", "解析详情原题身份，不定位或切换学习集");
        }
        if (request.command === "runtimeLog" && request.payload && request.payload.event === "boot.appRendered") {
          current.appRendered = true;
          current.workbenchRendered = true;
          clearStartTimer(current);
          if (current.prepareOnly) { current.prepareOnly = false; collapse(current); }
          finishReady(current, current.confirmed);
          log("panel.appRendered", "工作台已渲染");
        }
        var context = {
          addon: owner, controller: controller,
          sceneDragActive: function () {
            return sessions[token] === current && eligible(owner) && current.confirmed && !current.collapsed && !current.rejected;
          },
          closePanel: function () { hide(owner, true); },
          resetPanelFrame: function () { return { reset: true, scene: true }; },
          panelCloseButtonSide: legacy.panelCloseButtonSide,
          setPanelCloseButtonSide: legacy.setPanelCloseButtonSide,
          pluginEnabled: function () { return __MN_ANSWER_CORE_GLOBAL__.cardToolbar.isEnabled(owner); }
        };
        // onMessage returns JSON synchronously; async business replies use the
        // documented panel.post -> mn:<event> channel, never return a Promise.
        Promise.resolve().then(function () {
          return __MNAM_WEB_BRIDGE_GLOBAL__.dispatch(context, request.command, request.payload);
        }).then(function (payload) {
          if (handwriting) {
            log("annotation.target.ready", "原题身份已取得；面板存活=" + (sessions[token] === current));
          }
          if (sessions[token] === current) panel.post("bridgeResponse", { requestId: request.requestId, payload: payload });
        }, function (error) {
          if (handwriting) log("annotation.target.failed", error.message || String(error));
          if (sessions[token] === current) panel.post("bridgeResponse", { requestId: request.requestId, error: { message: error.message || String(error), code: error.code } });
        });
        return { accepted: true };
      }
      return { error: { message: "未知场景消息" } };
    };
    try {
      panel.maxContentHeight = 1000;
      if (panel.loadPanel() === false) {
        log("panel.loadFailed", "loadPanel返回false");
        hide(owner, false);
        __MN_ANSWER_CORE_GLOBAL__.notifySceneUnavailable("CardLink 场景面板加载失败");
        return false;
      }
      originalHide(controller, false);
      panel.showFloatingIn(Application.sharedInstance().studyController(owner.window));
      watchPanelSurface(current);
      remember(true);
      if (!current.appRendered) current.startTimer = NSTimer.scheduledTimerWithTimeInterval(20, false, function () {
        if (sessions[token] !== current || current.appRendered) return;
        rejectScene(current, controller, "启动超时：" + current.stage);
      });
      return true;
    } catch (error) {
      log("panel.failed", error.message || String(error));
      hide(owner, false);
      __MN_ANSWER_CORE_GLOBAL__.notifySceneUnavailable("CardLink 场景面板加载失败");
      return false;
    }
  }
  legacy.showPanel = function (controller) {
    if (!controller) return;
    if (__MN_ANSWER_CORE_GLOBAL__.isSceneMode(controller.addon)) {
      if (!tryShow(controller)) { originalHide(controller, false); remember(false); }
    } else {
      if (session(controller.addon)) hide(controller.addon, false);
      originalShow(controller);
    }
  };
  legacy.hidePanel = function (controller, rememberClosed) {
    var current = controller && session(controller.addon);
    if (current && (reviewing(current) || (rememberClosed !== false && current.confirmed && current.appRendered))) {
      collapse(current);
    } else if (current) hide(controller.addon, rememberClosed);
    originalHide(controller, rememberClosed);
  };
  legacy.isVisible = function (controller) { var current = controller && session(controller.addon); return !!(current && !current.collapsed) || originalVisible(controller); };
  legacy.restorePanelAfterNotebookSwitch = function (controller) {
    if (controller && __MN_ANSWER_CORE_GLOBAL__.isSceneMode(controller.addon)) legacy.showPanel(controller);
    else originalRestore(controller);
  };
  return {
    syncMode: function (owner) {
      var controller = owner.webController;
      if (!controller) return;
      var mode = __MN_ANSWER_CORE_GLOBAL__.isSceneMode(owner);
      if (controller.cardLinkSceneMode === mode) return;
      controller.cardLinkSceneMode = mode;
      var current = session(owner);
      var visible = current ? !current.collapsed : originalVisible(controller);
      if (!mode && current) hide(owner, false);
      if (visible && (mode ? !current : !!current)) legacy.showPanel(controller);
    },
    readClipperTools: function (owner) {
      var current = session(owner);
      if (!current || !current.confirmed) return Promise.reject(new Error("请先打开当前场景的 CardLink 面板再绑定摘录工具"));
      if (current.clipperToolsRequest) return Promise.reject(new Error("正在读取场景摘录工具，请稍候"));
      return new Promise(function (resolve, reject) {
        var id = "clipper-tools-" + (++sequence);
        var timer = NSTimer.scheduledTimerWithTimeInterval(15, false, function () {
          if (!current.clipperToolsRequest || current.clipperToolsRequest.id !== id) return;
          current.clipperToolsRequest = null;
          reject(new Error("读取场景摘录工具超时，请重试"));
        });
        current.clipperToolsRequest = { id: id, timer: timer, resolve: resolve, reject: reject };
        try { current.panel.post("clipperToolsRead", { requestId: id }); }
        catch (error) { timer.invalidate(); current.clipperToolsRequest = null; reject(error); }
      });
    },
    ensureReady: function (owner) {
      if (!owner || !eligible(owner) || !owner.webController) return Promise.resolve(false);
      var current = session(owner);
      if (current && current.confirmed && current.workbenchRendered) return Promise.resolve(true);
      if (!current) {
        if (!tryShow(owner.webController)) return Promise.resolve(false);
        current = session(owner);
        if (!current) return Promise.resolve(false);
        current.prepareOnly = true;
      }
      if (current.rejected) return Promise.resolve(false);
      var ready = new Promise(function (resolve) { (current.readyWaiters || (current.readyWaiters = [])).push(resolve); });
      if (!current.readyTimer) current.readyTimer = NSTimer.scheduledTimerWithTimeInterval(20, false, function () { finishReady(current, false); });
      if (current.confirmed && current.appRendered) current.panel.post("workbenchRequested", {});
      return ready;
    },
    enabled: function (owner) { var current = session(owner); return eligible(owner) && !!current && current.confirmed === true; },
    openReviewAnnotation: function (owner, target) {
      var current = session(owner);
      if (!current || (!current.confirmed && !reviewing(current))) return Promise.reject(new Error("请在场景面板中开启批注复习"));
      if (current.annotationRequest) return Promise.reject(new Error("正在处理批注请求，请稍候"));
      return new Promise(function (resolve, reject) {
        var id = "review-annotation-" + (++sequence);
        var timer = NSTimer.scheduledTimerWithTimeInterval(target.operation && (target.operation.indexOf("ink-") === 0 || target.operation.indexOf("practice-") === 0 || target.operation.indexOf("writing-") === 0) ? 45 : target.operation ? 5 : 45, false, function () {
          if (!current.annotationRequest || current.annotationRequest.id !== id) return;
          current.annotationRequest = null;
          reject(new Error(target.operation ? "同步批注窗口状态超时，请重试" : "打开批注超时，结果未确认，请检查批注窗口"));
        });
        current.annotationRequest = { id: id, reviewToken: target.reviewToken, operation: target.operation, resolve: resolve, reject: reject, timer: timer };
        try { current.panel.post("reviewAnnotationOpen", { requestId: id, target: target }); }
        catch (error) {
          timer.invalidate(); current.annotationRequest = null;
          reject(Object.assign(new Error(error.message || String(error)), { editorMayBeOpen: false }));
        }
      });
    },
    dispose: function (owner) { hide(owner, false); },
    // 空数据默认仍是 {}（既有通知不变）；显式 null 原样传递，让更新提示等
    // 关闭信号到达面板时仍是关闭，而不是变成空壳载荷。
    notify: function (owner, event, data) {
      var current = session(owner);
      if (current && current.confirmed) current.panel.post(event, data === null ? null : (data || {}));
    },
    // 当前已授权场景会话的身份；JSB 用它在写入前后核对窗口与代次。
    sceneToken: function (owner) { var current = session(owner); return current && current.confirmed ? key(owner) : ""; },
    // 分支折叠：只把当前题卡与目标折叠值交给面板，由面板用官方 SDK 调用
    // POST /notes/fold。响应不作为成功依据，JSB 侧另行读回。
    foldBranch: function (owner, request) {
      var current = session(owner);
      if (!current || !current.confirmed) return Promise.reject(new Error("场景面板尚未授权，无法折叠脑图分支"));
      if (!current.appRendered) return Promise.reject(new Error("场景面板尚未完成渲染，无法折叠脑图分支"));
      if (!request || typeof request.noteid !== "string" || !request.noteid) return Promise.reject(new Error("折叠请求缺少题卡"));
      if (current.foldRequest) return Promise.reject(new Error("正在处理分支折叠请求，请稍候"));
      return new Promise(function (resolve, reject) {
        var id = "fold-branch-" + (++sequence);
        var timer = NSTimer.scheduledTimerWithTimeInterval(8, false, function () {
          if (!current.foldRequest || current.foldRequest.id !== id) return;
          current.foldRequest = null;
          // 已投递给面板却没有回执：可能已写入，JSB 必须按"结果未知"处理并读回。
          reject(Object.assign(new Error("分支折叠请求超时，结果未确认"), { dispatched: true }));
        });
        current.foldRequest = { id: id, noteid: request.noteid, timer: timer, resolve: resolve, reject: reject };
        try {
          current.panel.post("foldBranch", { requestId: id, noteid: request.noteid,
            notebookId: request.notebookId || "", folded: request.folded === true });
        } catch (error) {
          timer.invalidate(); current.foldRequest = null;
          reject(Object.assign(new Error(error.message || String(error)), { accepted: false }));
        }
      });
    }
  };
})();
