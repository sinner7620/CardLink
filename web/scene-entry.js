
    window.__MN_SCENE_ENTRY__ = true;
    window.__MN_ASSET_BASE__ = "/pkg/web-dist/";
    window.__MN_BOOT_ASSET_FAILURE__ = function (file) {
      var message = document.getElementById("boot-message");
      if (message) message.textContent = "启动资源加载失败：" + file + "。正在恢复经典面板…";
      if (window.mn && typeof window.mn.call === "function") {
        window.mn.call("sceneRejected", { stage: "resources", reason: "资源加载失败：" + file }).catch(function () {});
      }
    };

window.addEventListener('error', function(event) { if (event.target && event.target.tagName === 'SCRIPT') window.__MN_BOOT_ASSET_FAILURE__(event.target.src.split('/').pop()); }, true);
