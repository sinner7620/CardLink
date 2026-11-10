// Run against the production PDF fixture with playwright-cli run-code.
async (page) => {
  function picture(id, scale, content) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${310 * scale}" height="${120 * scale}" viewBox="0 0 310 120">${content}</svg>`;
    return `<figure><img data-sample="${id}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></figure>`;
  }
  const line = (size, text) => `<text x="8" y="67" font-family="sans-serif" font-size="${size}">${text}</text>`;
  const latin = line(42, "HEMNOKVEH");
  const chinese = line(42, "国家因回图园");
  const content = [
    ...[1, 2, 3].map(scale => picture("latin-" + scale, scale, latin)),
    ...[1, 2, 3].map(scale => picture("chinese-" + scale, scale, chinese)),
    picture("short-instruction", 1, line(42, "国因回 ∫ x²")),
    picture("small", 1, line(14, "HEMNOKVEH")),
    picture("formula", 1, line(44, "∫ x² dx")),
    picture("fraction", 1, '<g font-family="serif" font-size="38"><text x="24" y="49">88</text><text x="24" y="87">88</text></g><path d="M18 54H70" stroke="black" stroke-width="2"/>'),
    picture("chart", 1, '<path d="M10 10V105H290 M20 85L80 30L130 65L240 20" fill="none" stroke="black" stroke-width="3"/>')
  ].join("");
  await page.route("**/unit-1.js", route => route.fulfill({
    contentType: "text/javascript",
    body: "window.__MN_PDF_UNIT__ = " + JSON.stringify('<article class="mistake"><section class="card-content">' + content + '</section></article>') + ";"
  }));
  await page.reload();
  await page.evaluate(() => {
    const manifest = window.__MN_PDF_MANIFEST__;
    manifest.units = manifest.units.slice(0, 1);
    manifest.pageLayout = "one-per-page";
    document.body.className = "layout-one-per-page";
    const capture = window.html2canvas;
    window.widths = {};
    window.html2canvas = (node, options) => {
      for (const img of node.querySelectorAll("[data-sample]")) {
        window.widths[img.dataset.sample] = img.getBoundingClientRect().width;
      }
      return capture(node, options);
    };
    window.__MN_PDF_FILE_FALLBACK_BEGIN__();
  });
  await page.waitForFunction(() => ["data-ready", "error"].includes(window.__MN_PDF_EXPORT_STATE__.stage));
  return page.evaluate(() => {
    if (window.__MN_PDF_EXPORT_STATE__.stage === "error") throw Error(window.__MN_PDF_EXPORT_STATE__.error);
    const widths = window.widths;
    for (const language of ["latin", "chinese"]) {
      const values = [1, 2].map(scale => widths[language + "-" + scale]);
      if (!values.every(value => value > 0 && value < widths.small * 0.85)) throw Error("Oversized text was not reduced: " + JSON.stringify(widths));
      if (Math.max(...values) / Math.min(...values) > 1.12) throw Error("Text size depends on screenshot resolution: " + JSON.stringify(widths));
    }
    const originalWidth = 310 * 703 * 0.75 / 483.28;
    if (!(widths.fraction > 0 && widths.fraction < originalWidth * 0.8)) {
      throw Error("Oversized fraction was not reduced: " + JSON.stringify(widths));
    }
    if (!(widths["short-instruction"] > 0 && widths["short-instruction"] < originalWidth * 0.8)) {
      throw Error("A short instruction beside a formula was not reduced: " + JSON.stringify(widths));
    }
    if (!(widths.small > originalWidth && widths.formula < originalWidth)) {
      throw Error("Small text and math did not move toward the target size: " + JSON.stringify(widths));
    }
    const minimumWidth = originalWidth * 3 * .2;
    for (const language of ["latin", "chinese"]) {
      if (Math.abs(widths[language + "-3"] - minimumWidth) > 1) {
        throw Error("V2 minimum scale was not applied: " + JSON.stringify(widths));
      }
    }
    if (Math.abs(widths.chart - originalWidth) > 1) throw Error("Chart was resized: " + JSON.stringify(widths));
    return widths;
  });
}
