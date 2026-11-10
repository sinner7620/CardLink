// Run against the production fixture with playwright-cli run-code.
async (page) => {
  await page.route("**/unit-1.js", async route => {
    const response = await route.fetch();
    const script = await response.text();
    const samples = [[900, 600], [100, 60]].map(([width, height]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/></svg>`;
      return `<figure><img data-test-width="${width}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></figure>`;
    }).join("");
    await route.fulfill({ response, body: script + "\nwindow.__MN_PDF_UNIT__ = window.__MN_PDF_UNIT__.replace('</figure>', " + JSON.stringify("</figure>" + samples) + ");" });
  });
  await page.route("**/image-1.js", async route => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="2600"><rect width="300" height="1020" fill="#cc0000"/><rect y="1020" width="300" height="1020" fill="#00cc00"/><rect y="2040" width="300" height="560" fill="#0000cc"/></svg>';
    const source = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    await route.fulfill({ contentType: "text/javascript", body: `document.querySelector('img[data-pdf-image-id="image-1"]').src=${JSON.stringify(source)}` });
  });
  await page.reload();
  await page.route("**/previous-question.js", route => route.fulfill({
    contentType: "text/javascript",
    body: 'window.__MN_PDF_UNIT__ = "<div style=\'height:865px\'>上一题</div>";'
  }));
  await page.addStyleTag({ content: ".card-content { padding-block: 50px; }" });
  await page.evaluate(() => {
    const manifest = window.__MN_PDF_MANIFEST__;
    const question = manifest.units[0];
    manifest.units = [
      { name: "previous-question.js", kind: "question", index: 0 },
      { ...question, index: 1 }
    ];
    const capture = window.html2canvas;
    window.slices = [];
    window.sampleWidths = {};
    window.html2canvas = async (node, options) => {
      const title = node.querySelector(".problem-title");
      const opening = node.querySelector("[data-pdf-image-slice]");
      if (title && (!opening || opening.getBoundingClientRect().height < 96 || node.textContent.includes("上一题"))) {
        throw Error("Question title did not move with the image opening");
      }
      if (!window.slices.length && opening && !title) throw Error("Image opening lacks its title");
      const canvas = await capture(node, options);
      for (const sample of node.querySelectorAll("[data-test-width]")) {
        window.sampleWidths[sample.dataset.testWidth] = sample.getBoundingClientRect().width;
      }
      for (const slice of node.querySelectorAll("[data-pdf-image-slice]")) {
        const image = slice.querySelector("img");
        const overlay = slice.querySelector("canvas");
        const rect = slice.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const pageRect = node.getBoundingClientRect();
        if (rect.bottom > pageRect.top + options.height) throw Error("Image slice extends past the page");
        if (Math.abs(imageRect.width - 300 * 703 * 0.75 / 483.28) > 1) throw Error("Image size is not 96 px/in");
        if (!overlay.width || Math.abs(overlay.getBoundingClientRect().width - imageRect.width) > 1) throw Error("Missing or misaligned handwriting overlay");
        const pixel = canvas.getContext("2d").getImageData(
          Math.round((imageRect.left - pageRect.left + imageRect.width / 2) * options.scale),
          Math.round((rect.top - pageRect.top + rect.height / 2) * options.scale), 1, 1
        ).data;
        window.slices.push({ offset: rect.top - imageRect.top, height: rect.height, imageHeight: imageRect.height, color: Array.from(pixel).indexOf(204), expected: Math.floor((rect.top - imageRect.top + rect.height / 2) * 2600 / imageRect.height / 1020) });
      }
      return canvas;
    };
    window.__MN_PDF_FILE_FALLBACK_BEGIN__();
  });
  await page.waitForFunction(() => ["data-ready", "error"].includes(window.__MN_PDF_EXPORT_STATE__.stage));
  return page.evaluate(() => {
    if (window.__MN_PDF_EXPORT_STATE__.stage === "error") throw Error(window.__MN_PDF_EXPORT_STATE__.error);
    let position = 0;
    const slices = window.slices;
    if (slices.length < 3 || slices.some(slice => slice.color !== slice.expected)) throw Error("Raster output lacks the expected image sections: " + JSON.stringify(slices));
    for (const slice of slices) {
      if (Math.abs(slice.offset - position) > 1) throw Error("Image sections overlap or have a gap");
      position += slice.height;
    }
    if (Math.abs(position - slices[0].imageHeight) > 1) throw Error("Image was truncated");
    const samples = window.sampleWidths;
    if (!(Math.abs(samples[900] - 1061 / 4 * 900 / 600) <= 1)) throw Error("Large landscape image was not capped");
    if (!(Math.abs(samples[100] - 100 * 703 * 0.75 / 483.28) <= 1)) throw Error("Small image lost its original scale");
    return { pages: window.__MN_PDF_EXPORT_INFO__.pages, slices };
  });
}
