import { StrokePoint } from '../types';

/**
 * Laplacian Curve Tension Operator (拉普拉斯曲线张力纠偏算子)
 *
 * 在光滑玻璃表面书写时，向弦中点施加向内拉力，使连笔和圆弧紧绷收敛；
 * 在顿笔折角处 (相邻夹角 >= 68°) 张力自适应释放为零，保全折笔锋芒。
 */
export function applyLaplacianRectification(points: StrokePoint[], rectification: number): StrokePoint[] {
  if (rectification <= 0 || points.length < 3) {
    return points.map(p => ({ ...p }));
  }

  const pts = points.map(p => ({ ...p }));
  const rect = Math.min(1.0, Math.max(0.0, rectification));

  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];

    const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    let diff = Math.abs(a2 - a1);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;

    // 仅在弯折角小于约 68 度 (1.2 rad) 的平滑圆弧段施加张力
    if (diff < 1.20) {
      const k = rect * 0.42 * (1.0 - diff / 1.25);
      p1.x += ((p0.x + p2.x) / 2 - p1.x) * k;
      p1.y += ((p0.y + p2.y) / 2 - p1.y) * k;
    }
  }

  return pts;
}
