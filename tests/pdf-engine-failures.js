// playwright-cli run-code --filename tests/pdf-engine-failures.js
async (page) => {
  await page.route("**/image-1.js", route => route.abort());
  await page.reload();
  await page.evaluate(() => {
    window.__MN_PDF_MANIFEST__.units = window.__MN_PDF_MANIFEST__.units.slice(0, 1);
    window.__MN_PDF_FILE_FALLBACK_BEGIN__();
  });
  await page.waitForFunction(() => window.__MN_PDF_EXPORT_STATE__.stage === "error");
  const failure = await page.evaluate(() => {
    if (window.__MN_PDF_EXPORT_INFO__ || document.querySelector("iframe")) throw Error("Failed task leaked output/frame");
    return window.__MN_PDF_EXPORT_STATE__.error;
  });
  await page.unroute("**/image-1.js");
  await page.reload();
  await page.evaluate(() => {
    window.__MN_PDF_MANIFEST__.units = window.__MN_PDF_MANIFEST__.units.slice(0, 1);
    window.html2canvas = () => new Promise(resolve => { window.releaseCapture = () => {
      const canvas = document.createElement("canvas"); canvas.width = 703; canvas.height = 1061;
      window.cancelCanvas = canvas;
      resolve(canvas);
    }; });
    window.__MN_PDF_FILE_FALLBACK_BEGIN__();
  });
  await page.waitForFunction(() => typeof window.releaseCapture === "function");
  await page.evaluate(() => { window.__MN_PDF_EXPORT_RELEASE__(); window.releaseCapture(); });
  await page.waitForFunction(() => window.cancelCanvas.width === 0);
  await page.evaluate(() => {
    if (window.__MN_PDF_EXPORT_INFO__ || document.querySelector("iframe")) throw Error("Cancelled task leaked output/frame");
  });
  return { missingImage: failure, cancelledDuringCapture: true, canvasReleased: true, outputSuppressed: true };
}
