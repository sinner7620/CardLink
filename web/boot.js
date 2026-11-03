// 先绘制轻量启动页，再解析应用包；捕获启动异常，不再无限白屏。
(function () {
  var started = Date.now();
  window.__MN_BOOT_STARTED_AT__ = started;
  var stage = "启动资源";
  function status(text) {
    var message = document.getElementById("boot-message");
    if (message) message.textContent = text;
  }
  function failure(reason) {
    status("工作台启动失败（" + stage + "）：" + reason + (window.__MN_SCENE_ENTRY__ || window.mn ? "。正在恢复经典面板…" : "。请关闭插件窗口后重试。"));
    if (window.mn) {
      bounded(function () { return window.mn.call("sceneRejected", { stage: stage, reason: String(reason) }); }, 1000).catch(function () {});
    }
  }
  async function bounded(operation, timeout) {
    var timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("等待宿主响应超时")); }, timeout || 5000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  window.addEventListener("error", function (event) { failure(event.message || "脚本加载失败"); });
  // 隐藏 UIWebView 会暂停 rAF；启动脚本不能依赖它，否则首次显示前永远未初始化。
  async function start() {
    var resolveReady, rejectReady;
    var ready = new Promise(function (resolve, reject) { resolveReady = resolve; rejectReady = reject; });
    ready.catch(function () {});
    if (window.mn && window.CardLinkCardMenu) window.CardLinkCardMenu.install(window.mn);
    commandSurface = window.mn && window.CardLinkCommandSurface ? window.CardLinkCommandSurface.install(window.mn, ready) : null;
    if (window.mn || window.__MN_SCENE_ENTRY__) {
      try {
        stage = "读取宿主版本";
        status("正在载入错题工作台：" + stage + "…");
        if (!window.mn) throw new Error("宿主未注入 window.mn");
        var host = await bounded(function () { return window.mn.call("hostInfo", {}); });
        window.__MN_HOST_VERSION__ = host.version;
        if (!window.CardLinkHostPolicy.versionAtLeast450(host.version)) throw new Error("宿主版本低于4.5.0");
        stage = "检测场景状态";
        status("正在载入错题工作台：" + stage + "…");
        var ui = await bounded(function () { return window.mn.api("/ui-state"); });
        if (!window.CardLinkHostPolicy.sceneEnabled(host.version, ui)) throw new Error("当前不是场景页面");
        stage = "确认场景面板";
        status("正在载入错题工作台：" + stage + "…");
        var sceneStatus = await bounded(function () { return window.mn.call("sceneReady", ui); });
        if (!sceneStatus.enabled) throw new Error("新面板未获启用");
        window.__MN_SCENE_ENABLED__ = true;
        document.documentElement.dataset.host = "scene";
        document.body.style.padding = "0";
        document.body.style.boxSizing = "border-box";
        document.getElementById("root").style.height = "100vh";
      } catch (error) {
        rejectReady(error);
        failure(error.message || String(error));
        return;
      }
    }
      resolveReady();
      if (commandSurface?.active() && !workbenchRequested) return;
      loadWorkbench();
  }
  var commandSurface, workbenchRequested = false, appLoaded = false;
  var retainedSize, retainedScroll = [], restoreTimer, restoringWorkbench = false;
  function restoreScroll() {
    retainedScroll.forEach(function (item) { item.element.scrollTop = item.top; item.element.scrollLeft = item.left; });
  }
  function finishRestore() {
    if (window.__MN_WORKBENCH_COLLAPSED__ || !restoringWorkbench) return;
    var root = document.getElementById("root");
    root.style.width = ""; root.style.height = "100vh";
    restoreScroll(); retainedScroll = []; restoringWorkbench = false;
  }
  function minimizeWorkbench() {
    if (!appLoaded || window.__MN_WORKBENCH_COLLAPSED__) return;
    var root = document.getElementById("root");
    retainedSize = { width: window.innerWidth >= 360 ? window.innerWidth : 640, height: window.innerHeight >= 360 ? window.innerHeight : 620 };
    try { window.localStorage.setItem("cardlink.scene.windowSize", JSON.stringify(retainedSize)); } catch (_) {}
    retainedScroll = Array.from(root.querySelectorAll("*")).filter(function (element) { return element.scrollTop || element.scrollLeft; })
      .map(function (element) { return { element: element, top: element.scrollTop, left: element.scrollLeft }; });
    Array.from(root.querySelectorAll("iframe")).forEach(function (frame) {
      try { var element = frame.contentDocument.scrollingElement; retainedScroll.push({ element: element, top: element.scrollTop, left: element.scrollLeft }); } catch (_) {}
    });
    root.style.width = retainedSize.width + "px"; root.style.height = retainedSize.height + "px";
    root.style.visibility = "hidden"; root.inert = true;
    restoringWorkbench = false; clearTimeout(restoreTimer);
    window.__MN_WORKBENCH_COLLAPSED__ = true;
    document.documentElement.dataset.cardlinkCollapsed = "true";
    window.mn.mode("mini"); window.mn.size(1, 54);
  }
  window.addEventListener("mn:workbenchCollapse", minimizeWorkbench);
  window.addEventListener("resize", function () {
    if (!window.__MN_WORKBENCH_COLLAPSED__ && restoringWorkbench) {
      restoreScroll(); clearTimeout(restoreTimer); restoreTimer = setTimeout(finishRestore, 180);
    }
  });
  function loadWorkbench() {
    var wasCollapsed = window.__MN_WORKBENCH_COLLAPSED__ === true;
    window.__MN_WORKBENCH_COLLAPSED__ = false;
    document.documentElement.dataset.cardlinkCollapsed = "false";
    commandSurface?.restoreWorkbench?.();
    var root = document.getElementById("root");
    root.hidden = false; root.style.visibility = ""; root.inert = false;
    window.__MN_WORKBENCH_MOUNTING__ = true;
    if (window.__MN_SCENE_ENABLED__) {
      var saved;
      try { saved = JSON.parse(window.localStorage.getItem("cardlink.scene.defaultSizePreset") || "null"); } catch (_) {}
      if (retainedSize) saved = retainedSize;
      var valid = saved && Number.isInteger(saved.width) && saved.width >= 360 && Number.isInteger(saved.height) && saved.height >= 360 && saved.height <= 1000;
      window.mn.mode("workspace");
      window.mn.size(valid ? saved.width : 720, valid ? saved.height : 520);
      retainedSize = null;
    }
    if (wasCollapsed) {
      restoringWorkbench = true;
      restoreScroll();
      setTimeout(restoreScroll, 0);
      clearTimeout(restoreTimer); restoreTimer = setTimeout(finishRestore, 400);
    }
    if (appLoaded) return;
    appLoaded = true;
    var script = document.createElement("script");
    stage = "加载工作台脚本";
    status("正在载入错题工作台：" + stage + "…");
    script.src = (window.__MN_ASSET_BASE__ || "./") + "app.js";
    script.onerror = function () { failure("app.js 资源加载失败"); };
    document.body.appendChild(script);
  }
  window.addEventListener("mn:workbenchRequested", function () {
    workbenchRequested = true;
    if (window.__MN_SCENE_ENABLED__) loadWorkbench();
  });
  setTimeout(start, 0);
})();
