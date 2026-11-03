import { PenOptions } from '../types';

/**
 * Computes line width dynamic multiplier based on nib flatness and stroke angle
 * 计算切向角对平尖笔尖粗细的投影增益 (模拟书法横细竖粗)
 */
export function computeFlatnessMultiplier(strokeAngle: number, nibAngle: number, flatness: number): number {
  if (flatness <= 0) return 1.0;

  const diff = strokeAngle - nibAngle;
  const a = 1.0;
  const b = Math.max(0.25, 1.0 - flatness * 0.65);
  return Math.sqrt(a * a * Math.sin(diff) * Math.sin(diff) + b * b * Math.cos(diff) * Math.cos(diff));
}

/**
 * Draws an initial nib stamp (circle or rotated ellipse)
 * 绘制落笔接触点微观墨迹印记
 */
export function drawNibStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  options: PenOptions
): void {
  ctx.fillStyle = options.color;
  if (options.flatness > 0) {
    const radiusX = width / 2;
    const radiusY = Math.max(0.5, radiusX * (1 - options.flatness * 0.65));
    const rotation = options.nibAngle || -Math.PI * 0.22;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
