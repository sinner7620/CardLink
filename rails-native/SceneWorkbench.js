var __MNAM_SCENE_WORKBENCH_GLOBAL__ = (function () {
  var sessions = Object.create(null), sequence = 0;
  var legacy = __MNAM_WEB_PANEL_GLOBAL__;
  var originalShow = legacy.showPanel, originalHide = legacy.hidePanel;
  var originalVisible = legacy.isVisible, originalRestore = legacy.restorePanelAfterNotebookSwitch;
  var OPEN_KEY = "marginnote.extension.mn4-answer-matcher.rails.open";
  function key(owner) { return typeof owner.cardLinkSceneToken === "string" ? owner.cardLinkSceneToken : ""; }
  function session(owner) { return owner ? sessions[key(owner)] : null; }
  function version() { return String(Application.sharedInstance().appVersion || ""); }
  function eligible() { return CardLinkHostPolicy.versionAtLeast450(version()) && typeof AddonWebPanel !== "undefined"; }
  function log(event, detail) { __MN_ANSWER_CORE_GLOBAL__.annotationLog(event, String(detail || "").slice(0, 400)); }
  function remember(open) { NSUserDefaults.standardUserDefaults().setObjectForKey(open, OPEN_KEY); }
  function clearStartTimer(current) {
    if (current.startTimer) { current.startTimer.invalidate(); current.startTimer = null; }
  }
  function hide(owner, rememberClosed) {
    var current = session(owner);
    if (!current) return;
    clearStartTimer(current);
    delete sessions[key(owner)];
    current.confirmed = false;
    current.panel.hideFloating();
    if (rememberClosed !== false) remember(false);
  }
  function defer(callback) { NSTimer.scheduledTimerWithTimeInterval(0.05, false, callback); }
  function rejectScene(current, controller, reason) {
    if (current.rejected) return;
    current.rejected = true;
    current.confirmed = false;
    clearStartTimer(current);
    log("panel.sceneRejected", reason || "回到经典面板");
    defer(function () {
      if (session(current.owner) !== current) return;
      hide(current.owner, false); originalShow(controller);
    });
  }
  function tryShow(controller) {
    if (!__MN_ANSWER_CORE_GLOBAL__.sceneWorkbenchEnabled()) {
      if (controller && controller.addon && session(controller.addon)) hide(controller.addon, false);
      return false;
    }
    var owner = controller && controller.addon;
    if (!owner || !eligible()) { log("panel.classic", "host=" + version()); return false; }
    var current = session(owner);
    if (current) {
      var wasCollapsed = current.collapsed === true;
      current.collapsed = false;
      remember(true);
      current.panel.showFloatingIn(Application.sharedInstance().studyController(owner.window));
      current.panel.post("workbenchRequested", {});
      if (current.confirmed) current.panel.post("panelShown", { skipReload: wasCollapsed || !!controller.preserveAcrossNotebookSwitch });
      controller.preserveAcrossNotebookSwitch = false;
      return true;
    }
    // The host only creates panels permitted by the current scene/template.
    var panel = AddonWebPanel.panel();
    if (!panel) { log("panel.unavailable", "host=" + version() + "; 当前场景未获面板许可"); return false; }
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
        current.confirmed = CardLinkHostPolicy.sceneEnabled(version(), data);
        current.stage = "加载并渲染工作台脚本";
        log("panel.sceneReady", "host=" + version() + "; enabled=" + current.confirmed);
        return { enabled: current.confirmed };
      }
      if (name === "sceneRejected") {
        rejectScene(current, controller, data && (data.stage + ": " + data.reason));
        return { fallback: true };
      }
      if (name === "sceneClose") { defer(function () { hide(owner, true); }); return { closed: true }; }
      if (!eligible() || !current.confirmed) return { error: { message: "新面板要求软件 4.5.0 及以上，并处于场景页面" } };
      if (name === "sceneMinimize") {
        current.collapsed = true;
        remember(false);
        current.panel.post("workbenchCollapse", {});
        return { minimized: true };
      }
      if (name === "sceneExpand") {
        if (!__MN_ANSWER_CORE_GLOBAL__.sceneWorkbenchEnabled()) {
          defer(function () { hide(owner, false); originalShow(controller); });
          return { fallback: true };
        }
        current.collapsed = false;
        remember(true);
        current.panel.post("workbenchRequested", {});
        return { expanded: true };
      }
      if (name === "sceneCommandReady") {
        current.appRendered = true;
        clearStartTimer(current);
        log("panel.commandReady", "菜单小面板已渲染");
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
          clearStartTimer(current);
          log("panel.appRendered", "工作台已渲染");
        }
        var context = {
          addon: owner, controller: controller,
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
      if (panel.loadPanel() === false) { log("panel.loadFailed", "loadPanel返回false"); hide(owner, false); return false; }
      originalHide(controller, false);
      panel.showFloatingIn(Application.sharedInstance().studyController(owner.window));
      remember(true);
      if (!current.appRendered) current.startTimer = NSTimer.scheduledTimerWithTimeInterval(20, false, function () {
        if (sessions[token] !== current || current.appRendered) return;
        rejectScene(current, controller, "启动超时：" + current.stage);
      });
      return true;
    } catch (error) { log("panel.failed", error.message || String(error)); hide(owner, false); return false; }
  }
  legacy.showPanel = function (controller) { if (!tryShow(controller)) originalShow(controller); };
  legacy.hidePanel = function (controller, rememberClosed) {
    var current = controller && session(controller.addon);
    if (current && rememberClosed !== false && current.confirmed && current.appRendered) {
      current.collapsed = true;
      remember(false);
      current.panel.post("workbenchCollapse", {});
    } else if (current) hide(controller.addon, rememberClosed);
    originalHide(controller, rememberClosed);
  };
  legacy.isVisible = function (controller) { var current = controller && session(controller.addon); return !!(current && !current.collapsed) || originalVisible(controller); };
  legacy.restorePanelAfterNotebookSwitch = function (controller) {
    if (!tryShow(controller)) originalRestore(controller);
  };
  return {
    eligible: eligible,
    enabled: function (owner) { var current = session(owner); return eligible() && !!current && current.confirmed === true; },
    dispose: function (owner) { hide(owner, false); },
    notify: function (owner, event, data) { var current = session(owner); if (current && current.confirmed) current.panel.post(event, data || {}); }
  };
})();
