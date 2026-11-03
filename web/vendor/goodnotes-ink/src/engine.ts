import {
  CurvePoint,
  PenOptions,
  RenderContext,
  SavedStroke,
  StrokePoint
} from './types';
import { evaluatePressureCurve } from './math/pressure';
import { computeFlatnessMultiplier, drawNibStamp } from './math/flatness';
import { applyLaplacianRectification } from './math/laplacian';

/**
 * GoodNotesInkEngine
 * 核心仿生墨迹渲染引擎
 */
export class GoodNotesEngine {
  public name = 'goodnotes-ink';
  public description = 'GoodNotes 仿生墨迹渲染引擎';

  private points: StrokePoint[] = [];
  private curvePoints: CurvePoint[] = [];
  private lastVelocity = 0;
  private lastEffectiveWidth = 0;
  private lastFilteredPressure = 0;
  private headingVx = 0;
  private headingVy = 1;

  /**
   * Pointer Down - 落笔
   */
  public onPointerDown(point: StrokePoint, options: PenOptions, ctx: RenderContext): void {
    this.points = [point];
    this.curvePoints = [];
    this.lastVelocity = 0;
    this.lastFilteredPressure = point.pressure > 0 ? point.pressure : 0.4;
    this.headingVx = 0;
    this.headingVy = 1;

    const initialWidth = this.computeEffectiveWidth(point, null, 0, options);
    this.lastEffectiveWidth = initialWidth;

    this.curvePoints.push({
      x: point.x,
      y: point.y,
      width: initialWidth,
      time: point.time,
      pressure: point.pressure
    });

    // 绘制落笔初始印记
    const c = ctx.activeCtx;
    c.save();
    this.applyCompositeMode(c, options);
    drawNibStamp(c, point.x, point.y, initialWidth, options);
    c.restore();
  }

  /**
   * Pointer Move - 行笔增量渲染
   */
  public onPointerMove(newPoints: StrokePoint[], options: PenOptions, ctx: RenderContext): void {
    if (this.points.length === 0 || newPoints.length === 0) return;

    const c = ctx.activeCtx;
    c.save();
    this.applyCompositeMode(c, options);

    for (const rawPt of newPoints) {
      const pt = { ...rawPt };
      const prevRaw = this.points[this.points.length - 1];
      const dist = Math.hypot(pt.x - prevRaw.x, pt.y - prevRaw.y);

      // 1. 等距降噪重采样 (若开启直线抗抖)
      if (options.resampleStep && options.resampleStep > 0.5) {
        if (dist < options.resampleStep) continue;
      } else {
        // 玻璃微抖过滤 (自然手写)
        const wobbleThresh = (options.wobbleFilter ?? 0.60) * 1.5;
        if (wobbleThresh > 0 && this.points.length >= 2 && dist < wobbleThresh) {
          const pA = this.points[this.points.length - 2];
          const v1x = prevRaw.x - pA.x;
          const v1y = prevRaw.y - pA.y;
          const v2x = pt.x - prevRaw.x;
          const v2y = pt.y - prevRaw.y;
          if (v1x * v2x + v1y * v2y < 0) {
            continue; // 忽略高频亚像素抖动
          }
        }
        if (dist < 0.4) continue;
      }

      // 2. 稳定阻尼滤波 (0 - 200 扩展范围)
      if (options.stabilization > 0) {
        const s = options.stabilization;
        const stabWeight = s <= 1.0 ? s * 0.85 : Math.min(0.95, 0.85 + (s - 1.0) * 0.10);
        pt.x = prevRaw.x * stabWeight + pt.x * (1 - stabWeight);
        pt.y = prevRaw.y * stabWeight + pt.y * (1 - stabWeight);
        pt.pressure = prevRaw.pressure * stabWeight + pt.pressure * (1 - stabWeight);
      }

      // 3. 侧向摩擦阻尼与方向向量滤波 (可选直线消瘤)
      if (options.lateralDrag && options.lateralDrag > 0 && this.points.length >= 2) {
        const hf = options.headingFilter ?? 0.82;
        const rawDx = pt.x - prevRaw.x;
        const rawDy = pt.y - prevRaw.y;
        this.headingVx = this.headingVx * hf + rawDx * (1 - hf);
        this.headingVy = this.headingVy * hf + rawDy * (1 - hf);
        const headLen = Math.hypot(this.headingVx, this.headingVy) || 1;
        const nx = -this.headingVy / headLen;
        const ny = this.headingVx / headLen;
        const latOffset = rawDx * nx + rawDy * ny;
        const dampLat = latOffset * (1 - Math.min(0.85, options.lateralDrag * 0.72));
        pt.x = prevRaw.x + (rawDx - latOffset * nx) + dampLat * nx;
        pt.y = prevRaw.y + (rawDy - latOffset * ny) + dampLat * ny;
      }

      // 4. 计算运笔方向角
      let strokeAngle = 0;
      if (options.headingFilter && options.headingFilter > 0) {
        strokeAngle = Math.atan2(this.headingVy, this.headingVx);
      } else {
        strokeAngle = Math.atan2(pt.y - prevRaw.y, pt.x - prevRaw.x);
      }

      // 5. 计算有效线宽
      const targetWidth = this.computeEffectiveWidth(pt, prevRaw, strokeAngle, options);

      // 6. 粘滞平滑阻尼
      const visc = options.widthViscosity ?? 0;
      const baseAlpha = options.stabilization === 0 ? 0.65 : Math.max(0.2, 1 - options.smoothing * 0.7);
      const widthAlpha = visc > 0 ? Math.max(0.10, baseAlpha * (1 - visc * 0.75)) : baseAlpha;
      const effectiveWidth = this.lastEffectiveWidth * (1 - widthAlpha) + targetWidth * widthAlpha;
      this.lastEffectiveWidth = effectiveWidth;

      this.points.push(pt);
      this.curvePoints.push({
        x: pt.x,
        y: pt.y,
        width: effectiveWidth,
        time: pt.time,
        pressure: pt.pressure
      });

      // 7. 增量样条渲染 (Quadratic Bezier)
      const len = this.curvePoints.length;
      if (len >= 3) {
        const p0 = this.curvePoints[len - 3];
        const p1 = this.curvePoints[len - 2];
        const p2 = this.curvePoints[len - 1];

        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const segWidth = (p1.width + p2.width) / 2;

        this.drawSegment(c, mid1, p1, mid2, segWidth, options);
      } else if (len === 2) {
        const p0 = this.curvePoints[0];
        const p1 = this.curvePoints[1];
        c.strokeStyle = options.color;
        c.lineWidth = (p0.width + p1.width) / 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(p0.x, p0.y);
        c.lineTo(p1.x, p1.y);
        c.stroke();
      }
    }

    c.restore();
  }

  /**
   * Pointer Up - 提笔完成
   * 采用 1:1 位图无损提交，彻底解决抖动与变细
   */
  public onPointerUp(point: StrokePoint, options: PenOptions, ctx: RenderContext): SavedStroke | null {
    if (this.points.length === 0) return null;

    const prev = this.points[this.points.length - 1];
    const strokeAngle = Math.atan2(point.y - prev.y, point.x - prev.x);

    // 出锋收尾
    let liftWidth = this.computeEffectiveWidth(point, prev, strokeAngle, options);
    if (options.tipSharpness > 0) {
      liftWidth = Math.max(0.8, liftWidth * (1 - options.tipSharpness * 0.75));
    }

    this.curvePoints.push({
      x: point.x,
      y: point.y,
      width: liftWidth,
      time: point.time,
      pressure: 0
    });
    this.points.push(point);

    // 绘制收尾段到 activeCanvas
    const activeC = ctx.activeCtx;
    activeC.save();
    this.applyCompositeMode(activeC, options);
    const len = this.curvePoints.length;
    if (len >= 3) {
      const p0 = this.curvePoints[len - 3];
      const p1 = this.curvePoints[len - 2];
      const p2 = this.curvePoints[len - 1];
      const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const segWidth = (p1.width + p2.width) / 2;
      this.drawSegment(activeC, mid1, p1, mid2, segWidth, options);
    } else if (len === 2) {
      const p0 = this.curvePoints[0];
      const p1 = this.curvePoints[1];
      activeC.strokeStyle = options.color;
      activeC.lineWidth = (p0.width + p1.width) / 2;
      activeC.lineCap = 'round';
      activeC.lineJoin = 'round';
      activeC.beginPath();
      activeC.moveTo(p0.x, p0.y);
      activeC.lineTo(p1.x, p1.y);
      activeC.stroke();
    }
    activeC.restore();

    // 1:1 位图无损提交到 mainCanvas (Bit-for-bit Commit)
    const mainC = ctx.mainCtx;
    mainC.save();
    mainC.setTransform(1, 0, 0, 1, 0, 0);
    mainC.drawImage(ctx.activeCtx.canvas, 0, 0);
    mainC.restore();

    // 清空临时层
    ctx.activeCtx.save();
    ctx.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.activeCtx.clearRect(0, 0, ctx.activeCtx.canvas.width, ctx.activeCtx.canvas.height);
    ctx.activeCtx.restore();

    const saved: SavedStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      points: [...this.points],
      options: { ...options },
      timestamp: Date.now()
    };

    this.points = [];
    this.curvePoints = [];

    return saved;
  }

  public clear(): void {
    this.points = [];
    this.curvePoints = [];
  }

  /**
   * 重绘历史笔迹
   */
  public redrawAll(strokes: SavedStroke[], ctx: RenderContext): void {
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      const c = ctx.mainCtx;
      c.save();
      this.applyCompositeMode(c, stroke.options);

      const curvePts = this.buildCurvePoints(stroke.points, stroke.options);
      if (curvePts.length < 2) {
        const p = curvePts[0] || stroke.points[0];
        drawNibStamp(c, p.x, p.y, stroke.options.size, stroke.options);
      } else {
        this.renderFullStroke(c, curvePts, stroke.options);
      }
      c.restore();
    }
  }

  /**
   * 动态计算有效线宽
   */
  public computeEffectiveWidth(
    pt: StrokePoint,
    prevPt: StrokePoint | null,
    strokeAngle: number,
    options: PenOptions
  ): number {
    const base = options.size;

    // 1. 瞬时速度
    let velocity = 0;
    if (prevPt) {
      const dist = Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
      const dt = Math.max(1, pt.time - prevPt.time);
      velocity = dist / dt;
    }
    this.lastVelocity = this.lastVelocity * 0.7 + velocity * 0.3;

    // 2. 硬件压感与非对称滤波
    let p = pt.pressure;
    if (p <= 0 || options.simulatePressure) {
      p = Math.max(0.15, Math.min(0.9, 1.1 - Math.min(1.0, this.lastVelocity / 2.2)));
    }

    const isPressing = p > this.lastFilteredPressure;
    const rect = options.rectification ?? 1.0;
    const alpha = isPressing ? 0.85 : (0.45 + (1 - rect) * 0.35);
    this.lastFilteredPressure = this.lastFilteredPressure * (1 - alpha) + p * alpha;
    const smoothP = this.lastFilteredPressure;

    const pressureMod = evaluatePressureCurve(smoothP, options);

    // 3. 速度变细系数
    const velocityThinning = Math.max(0.5, 1.0 - Math.min(1.0, this.lastVelocity / 3.0) * 0.45);

    // 4. 扁平笔尖切向投影
    const flatnessMod = computeFlatnessMultiplier(strokeAngle, options.nibAngle, options.flatness);

    // 5. 笔型特化计算
    let finalWidth = base * pressureMod * velocityThinning * flatnessMod;

    switch (options.penType) {
      case 'fountain':
        finalWidth = Math.max(0.8, finalWidth * 1.15);
        break;
      case 'ballpoint':
        finalWidth = Math.max(1.0, base * (0.8 + 0.4 * smoothP));
        break;
      case 'brush':
        finalWidth = Math.max(1.2, base * (0.2 + 2.8 * Math.pow(smoothP, 1.3)) * flatnessMod);
        break;
      case 'highlighter':
        finalWidth = base * 4.2;
        break;
    }

    return Math.max(0.7, finalWidth);
  }

  public buildCurvePoints(points: StrokePoint[], options: PenOptions): CurvePoint[] {
    const result: CurvePoint[] = [];
    let lastW = options.size;
    let lastV = 0;
    let smoothP = 0.4;

    // 1. 等距重采样降噪 (可选)
    let pts: StrokePoint[];
    if (options.resampleStep && options.resampleStep > 0.5) {
      const stepThresh = options.resampleStep;
      pts = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const last = pts[pts.length - 1];
        const d = Math.hypot(points[i].x - last.x, points[i].y - last.y);
        if (d >= stepThresh || i === points.length - 1) {
          pts.push({ ...points[i] });
        }
      }
    } else {
      pts = points.map(p => ({ ...p }));
    }

    // 2. 直线导轨张力 (可选)
    if (options.railTension && options.railTension > 0 && pts.length >= 4) {
      const rail = options.railTension;
      for (let i = 2; i < pts.length - 2; i++) {
        const pA = pts[i - 2];
        const pB = pts[i + 2];
        const chordAng = Math.atan2(pB.y - pA.y, pB.x - pA.x);
        const curAng = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
        let angDiff = Math.abs(curAng - chordAng);
        if (angDiff > Math.PI) angDiff = 2 * Math.PI - angDiff;
        if (angDiff < 0.45) {
          const t = (pts[i].x - pA.x) * (pB.x - pA.x) + (pts[i].y - pA.y) * (pB.y - pA.y);
          const lenSq = Math.hypot(pB.x - pA.x, pB.y - pA.y) ** 2 || 1;
          const u = Math.max(0, Math.min(1, t / lenSq));
          const projX = pA.x + u * (pB.x - pA.x);
          const projY = pA.y + u * (pB.y - pA.y);
          pts[i].x += (projX - pts[i].x) * rail * 0.52;
          pts[i].y += (projY - pts[i].y) * rail * 0.52;
        }
      }
    }

    // 3. 拉普拉斯张力几何纠偏
    pts = applyLaplacianRectification(pts, options.rectification ?? 1.0);

    // 4. 方向角与线宽序列构建
    let headVx = 0, headVy = 1;
    const hasHeading = Boolean(options.headingFilter && options.headingFilter > 0);
    const hf = options.headingFilter || 0.82;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const prev = i > 0 ? pts[i - 1] : null;

      let v = 0;
      let angle = 0;
      if (prev) {
        const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        const dt = Math.max(1, pt.time - prev.time);
        v = d / dt;
        if (hasHeading) {
          const dx = pt.x - prev.x;
          const dy = pt.y - prev.y;
          headVx = headVx * hf + dx * (1 - hf);
          headVy = headVy * hf + dy * (1 - hf);
          angle = Math.atan2(headVy, headVx);
        } else {
          angle = Math.atan2(pt.y - prev.y, pt.x - prev.x);
        }
      }
      lastV = lastV * 0.7 + v * 0.3;

      let p = pt.pressure;
      if (p <= 0 || options.simulatePressure) {
        p = Math.max(0.15, Math.min(0.9, 1.1 - Math.min(1.0, lastV / 2.2)));
      }

      const isPressing = p > smoothP;
      const alpha = isPressing ? 0.85 : (0.45 + (1 - (options.rectification ?? 1.0)) * 0.35);
      smoothP = smoothP * (1 - alpha) + p * alpha;

      const pressureMod = evaluatePressureCurve(smoothP, options);
      const velocityThinning = Math.max(0.5, 1.0 - Math.min(1.0, lastV / 3.0) * 0.45);
      const flatnessMod = computeFlatnessMultiplier(angle, options.nibAngle, options.flatness);

      let w = options.size * pressureMod * velocityThinning * flatnessMod;

      switch (options.penType) {
        case 'fountain':
          w = Math.max(0.8, w * 1.15);
          break;
        case 'ballpoint':
          w = Math.max(1.0, options.size * (0.8 + 0.4 * smoothP));
          break;
        case 'brush':
          w = Math.max(1.2, options.size * (0.2 + 2.8 * Math.pow(smoothP, 1.3)) * flatnessMod);
          break;
        case 'highlighter':
          w = options.size * 4.2;
          break;
      }

      if (i === pts.length - 1 && options.tipSharpness > 0) {
        w = Math.max(0.8, w * (1 - options.tipSharpness * 0.75));
      }

      const visc = options.widthViscosity ?? 0;
      const baseAlpha = options.stabilization === 0 ? 0.65 : Math.max(0.2, 1 - options.smoothing * 0.7);
      const smoothAlpha = visc > 0 ? Math.max(0.10, baseAlpha * (1 - visc * 0.75)) : baseAlpha;
      lastW = lastW * (1 - smoothAlpha) + w * smoothAlpha;

      result.push({
        x: pt.x,
        y: pt.y,
        width: lastW,
        time: pt.time,
        pressure: pt.pressure
      });
    }

    return result;
  }

  private drawSegment(
    c: CanvasRenderingContext2D,
    from: { x: number; y: number },
    ctrl: { x: number; y: number },
    to: { x: number; y: number },
    width: number,
    options: PenOptions
  ): void {
    c.strokeStyle = options.color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    c.stroke();
  }

  private renderFullStroke(c: CanvasRenderingContext2D, curvePoints: CurvePoint[], options: PenOptions): void {
    if (curvePoints.length < 2) return;

    for (let i = 1; i < curvePoints.length; i++) {
      const p0 = curvePoints[i - 1];
      const p1 = curvePoints[i];

      if (i === 1) {
        c.strokeStyle = options.color;
        c.lineWidth = (p0.width + p1.width) / 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(p0.x, p0.y);
        c.lineTo(p1.x, p1.y);
        c.stroke();
      } else {
        const prevMid = {
          x: (curvePoints[i - 2].x + p0.x) / 2,
          y: (curvePoints[i - 2].y + p0.y) / 2
        };
        const curMid = {
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2
        };
        this.drawSegment(c, prevMid, p0, curMid, p0.width, options);
      }
    }

    const last = curvePoints[curvePoints.length - 1];
    const prev = curvePoints[curvePoints.length - 2];
    const lastMid = { x: (prev.x + last.x) / 2, y: (prev.y + last.y) / 2 };
    c.strokeStyle = options.color;
    c.lineWidth = last.width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(lastMid.x, lastMid.y);
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  private applyCompositeMode(c: CanvasRenderingContext2D, options: PenOptions): void {
    if (options.penType === 'highlighter') {
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.45;
    } else {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1.0;
    }
  }
}
