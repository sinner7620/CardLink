// Documented AddonWebPanel.putMedia(key, NSData, MIME) -> /media/<key>.
var __MNAM_SCENE_MEDIA_GLOBAL__ = (function () {
  function create(panel) {
    var sequence = 0, keys = Object.create(null);
    function put(data, type) {
      if (!data) throw new Error("图片数据不可用");
      var key = "cardlink-" + (++sequence);
      panel.putMedia(key, data, type);
      keys[key] = type;
      return { key: key, url: "/media/" + key };
    }
    function dataUri(value) {
      var match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ""));
      if (!match || match[2].length > 48 * 1024 * 1024) throw new Error("不支持的图片格式或图片过大");
      return put(__MNAM_WEB_BRIDGE_GLOBAL__.decodeMediaBase64(match[2]), match[1]);
    }
    function previewFile(value) {
      // Only the existing PDF export's private preview files may be read.
      var app = Application.sharedInstance();
      var base = String(app.tempPath || app.documentPath || "").replace(/\/$/, "");
      var path = decodeURIComponent(String(value || "").replace(/^file:\/\//, "").split("?")[0]);
      var prefix = base + "/CardLink/temp/pdf-cache/";
      if (!base || path.indexOf(prefix) !== 0 || !/^preview-page-\d+\.jpg$/.test(path.slice(prefix.length))) throw new Error("预览文件路径无效");
      return put(NSData.dataWithContentsOfFile(path), "image/jpeg");
    }
    function release(list) {
      (list || []).forEach(function (key) {
        if (keys[key]) { panel.putMedia(key, null, keys[key]); delete keys[key]; }
      });
    }
    return { dataUri: dataUri, previewFile: previewFile, release: release };
  }
  return { create: create };
})();
