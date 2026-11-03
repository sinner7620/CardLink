import { ExportSVGOptions, SavedStroke } from '../types';
import { GoodNotesEngine } from '../engine';

/**
 * Export saved strokes to clean, scalable SVG string
 * 将手写笔画导出为标准矢量 SVG 格式
 */
export function exportStrokesToSVG(
  strokes: SavedStroke[],
  options: ExportSVGOptions = {}
): string {
  if (strokes.length === 0) {
    const w = options.width || 800;
    const h = options.height || 600;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  }

  // 计算包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const margin = options.margin ?? 20;
  const strokeMargin = 10;
  const viewBoxX = Math.max(0, minX - margin - strokeMargin);
  const viewBoxY = Math.max(0, minY - margin - strokeMargin);
  const viewBoxW = Math.max(100, (maxX - minX) + (margin + strokeMargin) * 2);
  const viewBoxH = Math.max(100, (maxY - minY) + (margin + strokeMargin) * 2);

  const finalW = options.width || Math.round(viewBoxW);
  const finalH = options.height || Math.round(viewBoxH);
  const bg = options.backgroundColor ? `<rect width="100%" height="100%" fill="${options.backgroundColor}"/>` : '';

  const engine = new GoodNotesEngine();
  const paths: string[] = [];

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    const curvePts = engine.buildCurvePoints(stroke.points, stroke.options);
    if (curvePts.length < 2) continue;

    const color = stroke.options.color || '#1c1917';
    const opacity = stroke.options.penType === 'highlighter' ? '0.45' : '1.0';

    // 生成贝塞尔曲线段路径
    for (let i = 1; i < curvePts.length; i++) {
      const p0 = curvePts[i - 1];
      const p1 = curvePts[i];
      const segWidth = (p0.width + p1.width) / 2;

      if (i === 1) {
        paths.push(
          `<line x1="${p0.x.toFixed(2)}" y1="${p0.y.toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${p1.y.toFixed(2)}" stroke="${color}" stroke-width="${segWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
        );
      } else {
        const prevMidX = ((curvePts[i - 2].x + p0.x) / 2).toFixed(2);
        const prevMidY = ((curvePts[i - 2].y + p0.y) / 2).toFixed(2);
        const curMidX = ((p0.x + p1.x) / 2).toFixed(2);
        const curMidY = ((p0.y + p1.y) / 2).toFixed(2);

        paths.push(
          `<path d="M ${prevMidX} ${prevMidY} Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${curMidX} ${curMidY}" stroke="${color}" stroke-width="${p0.width.toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX.toFixed(2)} ${viewBoxY.toFixed(2)} ${viewBoxW.toFixed(2)} ${viewBoxH.toFixed(2)}" width="${finalW}" height="${finalH}">
  ${bg}
  <g id="goodnotes-ink-strokes">
    ${paths.join('\n    ')}
  </g>
</svg>`;
}
