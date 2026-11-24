(function () {
  "use strict";

  // CardLink exports one RGB canvas JPEG per page. PDF can embed these
  // bytes directly with DCTDecode, without another image encoder.
  var PAGE_WIDTH = 595.28;
  var PAGE_HEIGHT = 841.89;
  var MARGIN = 56;

  window.createCardLinkPdf = function () {
    var encoder = new TextEncoder();
    var chunks = [];
    var offsets = [0];
    var pages = [];
    var length = 0;

    function append(bytes) {
      if (typeof bytes === "string") bytes = encoder.encode(bytes);
      chunks.push(bytes);
      length += bytes.length;
    }

    function startObject(id) {
      offsets[id] = length;
      append(id + " 0 obj\n");
    }

    function endObject() {
      append("\nendobj\n");
    }

    append("%PDF-1.4\n");
    append(Uint8Array.of(37, 226, 227, 207, 211, 10));
    startObject(1);
    append("<< /Type /Catalog /Pages 2 0 R >>");
    endObject();

    return {
      addPage: function (canvas) {
        var jpeg = canvas.toDataURL("image/jpeg", 0.92);
        var prefix = "data:image/jpeg;base64,";
        if (!jpeg.startsWith(prefix) || !canvas.width || !canvas.height) throw new Error("PDF 页面截图无效");
        var binary = atob(jpeg.slice(prefix.length));
        if (binary.length < 4 || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216) throw new Error("PDF 页面截图格式无效");
        var image = new Uint8Array(binary.length);
        for (var i = 0; i < image.length; i++) image[i] = binary.charCodeAt(i);

        var pageId = 3 + pages.length * 3;
        var contentId = pageId + 1;
        var imageId = pageId + 2;
        pages.push(pageId + " 0 R");
        startObject(pageId);
        append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_WIDTH + " " + PAGE_HEIGHT +
          "] /Resources << /XObject << /PageImage " + imageId + " 0 R >> >> /Contents " + contentId + " 0 R >>");
        endObject();

        var width = (PAGE_WIDTH - 2 * MARGIN).toFixed(2);
        var height = (PAGE_HEIGHT - 2 * MARGIN).toFixed(2);
        var drawing = "q\n" + width + " 0 0 " + height + " " + MARGIN + " " + MARGIN + " cm\n/PageImage Do\nQ\n";
        startObject(contentId);
        append("<< /Length " + drawing.length + " >>\nstream\n" + drawing + "endstream");
        endObject();

        startObject(imageId);
        append("<< /Type /XObject /Subtype /Image /Width " + canvas.width + " /Height " + canvas.height +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.length + " >>\nstream\n");
        append(image);
        append("\nendstream");
        endObject();
      },
      getPageCount: function () { return pages.length; },
      finish: function () {
        startObject(2);
        append("<< /Type /Pages /Count " + pages.length + " /Kids [" + pages.join(" ") + "] >>");
        endObject();
        var xref = length;
        var table = ["xref\n0 " + offsets.length + "\n0000000000 65535 f \n"];
        for (var id = 1; id < offsets.length; id++) table.push(String(offsets[id]).padStart(10, "0") + " 00000 n \n");
        append(table.join(""));
        append("trailer\n<< /Size " + offsets.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
        var bytes = new Uint8Array(length);
        var position = 0;
        for (var j = 0; j < chunks.length; j++) {
          bytes.set(chunks[j], position);
          position += chunks[j].length;
        }
        return bytes;
      }
    };
  };
})();
