// Pass this function to playwright-cli run-code after opening the production fixture.
// Real html2canvas + jsPDF: catches lost text, whole-document cloning, and output corruption.
async (page) => {
  const results = [];
  for (const config of [
    { count: 1, layout: "one-per-page", answer: "after-each" },
    { count: 10, layout: "auto", answer: "end" },
    { count: 10, layout: "two-per-page", answer: "after-each" },
    { count: 10, layout: "three-per-page", answer: "end" },
    { count: 100, layout: "auto", answer: "end" },
    { count: 300, layout: "auto", answer: "end", fast: true }
  ]) {
    await page.reload();
    await page.evaluate(async (config) => {
      const manifest = window.__MN_PDF_MANIFEST__;
      manifest.units = manifest.units.filter(unit => unit.index < config.count);
      manifest.pageLayout = config.layout;
      manifest.answerLayout = config.answer;
      document.body.className = "layout-" + config.layout;
      if (config.answer === "after-each") manifest.units.sort((a, b) => a.index - b.index || Number(a.kind === "answer") - Number(b.kind === "answer"));
      const expected = [];
      for (const unit of manifest.units) {
        const script = await (await fetch(unit.name)).text();
        const html = JSON.parse(script.slice(script.indexOf("=") + 1).replace(/;$/, ""));
        const div = document.createElement("div"); div.innerHTML = html;
        expected.push(div.textContent);
      }
      window.audit = { expected: expected.join("").replace(/\s/g, ""), text: "", pages: 0, maxNodes: 0, maxHeight: 0, images: 0 };
      const capture = window.html2canvas;
      window.html2canvas = async (node, options) => {
        const audit = window.audit;
        audit.text += node.textContent.replace(/\s/g, "");
        audit.pages++;
        audit.images += node.querySelectorAll("img").length;
        for (const canvas of node.querySelectorAll("canvas[data-drawing-overlay]")) {
          const image = canvas.parentElement.querySelector("img");
          if (!canvas.width || !canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0)) throw Error("Handwriting pixels missing");
          if (Math.abs(canvas.getBoundingClientRect().width - image.getBoundingClientRect().width) > 1) throw Error("Overlay geometry mismatch");
        }
        audit.maxNodes = Math.max(audit.maxNodes, node.ownerDocument.querySelectorAll("*").length);
        audit.maxHeight = Math.max(audit.maxHeight, node.getBoundingClientRect().height);
        if (node.ownerDocument === document || node.ownerDocument.body.children.length !== 1) throw Error("Capture contains foreign content");
        if (node.getBoundingClientRect().height > options.height + 1) throw Error("Page overflow");
        if (config.fast) { const canvas = document.createElement("canvas"); canvas.width = 703; canvas.height = options.height; return canvas; }
        return capture(node, options);
      };
      window.__MN_PDF_FILE_FALLBACK_BEGIN__();
    }, config);
    await page.waitForFunction(() => ["error", "data-ready"].includes(window.__MN_PDF_EXPORT_STATE__.stage), null, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const state = window.__MN_PDF_EXPORT_STATE__, info = window.__MN_PDF_EXPORT_INFO__, audit = window.audit;
      if (state.stage === "error") throw Error(state.error);
      if (audit.text !== audit.expected) {
        let offset = 0; while (audit.text[offset] === audit.expected[offset] && offset < audit.text.length) offset++;
        throw Error("Content mismatch at " + offset + ": " + audit.text.slice(offset, offset + 80) + " / " + audit.expected.slice(offset, offset + 80));
      }
      if (info.pages !== audit.pages || info.pages !== state.totalPages) throw Error("Page count mismatch");
      let encoded = "";
      for (let i = 0; i < info.chunks; i++) encoded += window.__MN_PDF_EXPORT_TAKE_CHUNK__(i);
      const binary = atob(encoded);
      if (binary.length !== info.byteLength || !binary.startsWith("%PDF-") || !binary.trimEnd().endsWith("%%EOF")) throw Error("Invalid PDF bytes");
      return { pages: info.pages, bytes: info.byteLength, maxNodes: audit.maxNodes, maxHeight: audit.maxHeight, images: audit.images };
    });
    results.push({ ...config, ...result });
    if (config.count === 10 && config.layout === "auto") {
      const downloadPromise = page.waitForEvent("download");
      await page.evaluate(() => {
        const info = window.__MN_PDF_EXPORT_INFO__;
        const parts = [];
        for (let i = 0; i < info.chunks; i++) parts.push(Uint8Array.from(atob(window.__MN_PDF_EXPORT_TAKE_CHUNK__(i)), c => c.charCodeAt(0)));
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(parts, { type: "application/pdf" })); a.download = "pdf-engine.pdf"; a.click();
      });
      await (await downloadPromise).saveAs("output/pdf-engine/verified.pdf");
    }
  }
  await page.evaluate(results => { window.browserTestResults = results; }, results);
  return results;
}
