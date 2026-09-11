// 先绘制轻量启动页，再解析应用包；捕获启动异常，不再无限白屏。
(function () {
  var started = Date.now();
  window.__MN_BOOT_STARTED_AT__ = started;
  function failure() {
    var message = document.getElementById("boot-message");
    if (message) message.textContent = "界面加载失败，请关闭插件窗口后重试。";
  }
  window.addEventListener("error", failure);
  // 隐藏 UIWebView 会暂停 rAF；启动脚本不能依赖它，否则首次显示前永远未初始化。
  setTimeout(function () {
      var script = document.createElement("script");
      script.src = "./app.js";
      script.onerror = failure;
      document.body.appendChild(script);
  }, 0);
})();
