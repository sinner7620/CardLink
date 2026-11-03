import {
  InkCanvasOptions,
  PenOptions,
  PenType,
  RenderContext,
  SavedStroke,
  StrokePoint,
  ExportSVGOptions
} from './types';
import { GOODNOTES_GOLDEN_BASELINE_CONFIG } from './constants';
import { GoodNotesEngine } from './engine';
import { exportStrokesToSVG } from './export/svg';
import { serializeStrokes, deserializeStrokes } from './export/json';

/**
 * InkCanvas
 * 高级开箱即用手写板组件
 */
export class InkCanvas {
  private container: HTMLElement;
  private mainCanvas: HTMLCanvasElement;
  private activeCanvas: HTMLCanvasElement;
  private mainCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;

  private engine: GoodNotesEngine;
  private penOptions: PenOptions;
  private palmRejection: boolean;
  private mode: import('./types').AnnotationMode;
  private dpr: number;

  private isDrawing = false;
  private strokes: SavedStroke[] = [];
  private redoStack: SavedStroke[] = [];

  private options: InkCanvasOptions;
  private resizeObserver?: ResizeObserver;
  private abortController = new AbortController();

  constructor(options: InkCanvasOptions) {
    this.options = options;

    if (typeof options.container === 'string') {
      const el = document.querySelector(options.container);
      if (!el) {
        throw new Error(`[goodnotes-ink] Container not found: "${options.container}"`);
      }
      this.container = el as HTMLElement;
    } else {
      this.container = options.container;
    }

    this.penOptions = {
      ...GOODNOTES_GOLDEN_BASELINE_CONFIG,
      ...options.penOptions
    };

    this.palmRejection = options.palmRejection ?? true;
    this.mode = options.mode ?? 'annotate';
    this.dpr = options.dpr ?? (window.devicePixelRatio || 1);
    this.engine = new GoodNotesEngine();

    // 1. 初始化 DOM 容器样式
    this.setupContainer();

    // 2. 创建双层 Canvas
    this.mainCanvas = document.createElement('canvas');
    this.activeCanvas = document.createElement('canvas');

    this.setupCanvasElement(this.mainCanvas, 1);
    this.setupCanvasElement(this.activeCanvas, 2);

    this.container.appendChild(this.mainCanvas);
    this.container.appendChild(this.activeCanvas);

    // 3. 获取上下文 (active 启用 desynchronized 极低延迟)
    this.mainCtx = this.mainCanvas.getContext('2d')!;
    this.activeCtx = this.activeCanvas.getContext('2d', { desynchronized: true })!;

    // 4. 设置画布分辨率与缩放
    this.resize();

    // 5. 绑定触控与指针事件
    this.bindEvents();

    // 6. 监听窗口与容器尺寸变化
    this.bindResizeObserver();

    // 7. 应用初始批注/浏览模式
    this.applyMode();
  }

  private setupContainer(): void {
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.style.touchAction = 'none';
    this.container.style.userSelect = 'none';
    (this.container.style as any).webkitUserSelect = 'none';
  }

  private setupCanvasElement(cvs: HTMLCanvasElement, zIndex: number): void {
    cvs.style.position = 'absolute';
    cvs.style.top = '0';
    cvs.style.left = '0';
    cvs.style.width = '100%';
    cvs.style.height = '100%';
    cvs.style.zIndex = String(zIndex);
    cvs.style.touchAction = 'none';
  }

  private bindEvents(): void {
    const cvs = this.activeCanvas;
    const signal = this.abortController.signal;

    cvs.addEventListener('pointerdown', (e) => this.handlePointerDown(e), { signal, passive: false });
    cvs.addEventListener('pointermove', (e) => this.handlePointerMove(e), { signal, passive: false });
    cvs.addEventListener('pointerup', (e) => this.handlePointerUp(e), { signal, passive: false });
    cvs.addEventListener('pointercancel', (e) => this.handlePointerUp(e), { signal, passive: false });
  }

  private getRenderContext(): RenderContext {
    const rect = this.container.getBoundingClientRect();
    return {
      mainCtx: this.mainCtx,
      activeCtx: this.activeCtx,
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      dpr: this.dpr
    };
  }

  private extractPoint(e: PointerEvent): StrokePoint {
    const rect = this.activeCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * this.activeCanvas.clientWidth / rect.width,
      y: (e.clientY - rect.top) * this.activeCanvas.clientHeight / rect.height,
      pressure: e.pressure,
      time: e.timeStamp || Date.now(),
      tiltX: e.tiltX,
      tiltY: e.tiltY
    };
  }

  private handlePointerDown(e: PointerEvent): void {
    // 掌误抑制：如果开启了仅响应手写笔，且当前事件来自手指触控，则忽略
    if (this.palmRejection && e.pointerType === 'touch') {
      return;
    }

    e.preventDefault();
    this.isDrawing = true;

    try {
      this.activeCanvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const pt = this.extractPoint(e);
    const ctx = this.getRenderContext();

    this.engine.onPointerDown(pt, this.penOptions, ctx);
    this.options.onStrokeStart?.(pt);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;
    e.preventDefault();

    // 提取高刷细分事件 (ProMotion 120Hz/240Hz)
    let points: StrokePoint[] = [];
    if (typeof (e as any).getCoalescedEvents === 'function') {
      const coalesced = (e as any).getCoalescedEvents() as PointerEvent[];
      if (coalesced && coalesced.length > 0) {
        points = coalesced.map(ev => this.extractPoint(ev));
      }
    }

    if (points.length === 0) {
      points = [this.extractPoint(e)];
    }

    const ctx = this.getRenderContext();
    this.engine.onPointerMove(points, this.penOptions, ctx);
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isDrawing) return;
    e.preventDefault();
    this.isDrawing = false;

    try {
      if (this.activeCanvas.hasPointerCapture(e.pointerId)) {
        this.activeCanvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}

    const pt = this.extractPoint(e);
    const ctx = this.getRenderContext();

    const savedStroke = this.engine.onPointerUp(pt, this.penOptions, ctx);
    if (savedStroke) {
      this.strokes.push(savedStroke);
      this.redoStack = []; // 发生新绘制，清空重做栈
      this.options.onStrokeEnd?.(savedStroke);
      this.options.onChange?.(this.strokes);
    }
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', () => this.resize(), { signal: this.abortController.signal });
    }
  }

  /**
   * 调整画布大小，重绘历史笔画
   */
  public resize(width?: number, height?: number): void {
    this.dpr = this.options.dpr ?? (window.devicePixelRatio || 1);
    const rect = this.container.getBoundingClientRect();
    const w = Math.floor(width ?? this.container.clientWidth ?? 800);
    const h = Math.floor(height ?? this.container.clientHeight ?? 600);

    if (w <= 0 || h <= 0) return;

    for (const cvs of [this.mainCanvas, this.activeCanvas]) {
      cvs.width = w * this.dpr;
      cvs.height = h * this.dpr;
      cvs.style.width = `${w}px`;
      cvs.style.height = `${h}px`;
    }

    this.mainCtx.scale(this.dpr, this.dpr);
    this.activeCtx.scale(this.dpr, this.dpr);

    this.redraw();
  }

  /**
   * 全量重绘画布历史笔迹
   */
  public redraw(): void {
    const rect = this.container.getBoundingClientRect();
    this.mainCtx.save();
    this.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    this.mainCtx.restore();

    this.activeCtx.save();
    this.activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    this.activeCtx.restore();

    const ctx = this.getRenderContext();
    this.engine.redrawAll(this.strokes, ctx);
  }

  // ================= Public APIs ================= //

  /**
   * 撤销上一步
   */
  public undo(): boolean {
    if (this.strokes.length === 0) return false;
    const stroke = this.strokes.pop()!;
    this.redoStack.push(stroke);
    this.redraw();
    this.options.onChange?.(this.strokes);
    return true;
  }

  /**
   * 重做
   */
  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const stroke = this.redoStack.pop()!;
    this.strokes.push(stroke);
    this.redraw();
    this.options.onChange?.(this.strokes);
    return true;
  }

  public canUndo(): boolean {
    return this.strokes.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 清空画布
   */
  public clear(): void {
    this.strokes = [];
    this.redoStack = [];
    this.engine.clear();
    this.redraw();
    this.options.onChange?.(this.strokes);
  }

  /**
   * 设置画笔参数
   */
  public setPenOptions(options: Partial<PenOptions>): void {
    this.penOptions = { ...this.penOptions, ...options };
  }

  public getPenOptions(): PenOptions {
    return { ...this.penOptions };
  }

  public setPenType(type: PenType): void {
    this.penOptions.penType = type;
  }

  public setSize(size: number): void {
    this.penOptions.size = Math.max(0.5, size);
  }

  public setColor(color: string): void {
    this.penOptions.color = color;
  }

  public setPalmRejection(enabled: boolean): void {
    this.palmRejection = enabled;
  }

  /**
   * 切换批注与浏览模式:
   * - 'annotate': 批注书写模式 (激活手写层，拦截手写/触控)
   * - 'browse': 带批注浏览模式 (笔迹可见，穿透手势，可滚动、点击、选词)
   * - 'clean': 不带批注浏览模式 (笔迹隐藏，纯净阅读文档)
   */
  public setMode(mode: import('./types').AnnotationMode): void {
    this.mode = mode;
    this.applyMode();
    this.options.onModeChange?.(mode);
  }

  public getMode(): import('./types').AnnotationMode {
    return this.mode;
  }

  private applyMode(): void {
    switch (this.mode) {
      case 'annotate':
        this.mainCanvas.style.display = 'block';
        this.mainCanvas.style.pointerEvents = 'none';
        this.activeCanvas.style.display = 'block';
        this.activeCanvas.style.pointerEvents = 'auto';
        this.container.style.touchAction = 'none';
        break;
      case 'browse':
        this.mainCanvas.style.display = 'block';
        this.mainCanvas.style.pointerEvents = 'none';
        this.activeCanvas.style.display = 'block';
        this.activeCanvas.style.pointerEvents = 'none';
        this.container.style.touchAction = 'auto';
        break;
      case 'clean':
        this.mainCanvas.style.display = 'none';
        this.mainCanvas.style.pointerEvents = 'none';
        this.activeCanvas.style.display = 'none';
        this.activeCanvas.style.pointerEvents = 'none';
        this.container.style.touchAction = 'auto';
        break;
    }
  }

  public getStrokes(): SavedStroke[] {
    return [...this.strokes];
  }

  public loadStrokes(strokes: SavedStroke[]): void {
    this.strokes = [...strokes];
    this.redoStack = [];
    this.redraw();
    this.options.onChange?.(this.strokes);
  }

  /**
   * 导出为 SVG 矢量字符串
   */
  public exportSVG(options?: ExportSVGOptions): string {
    const rect = this.container.getBoundingClientRect();
    return exportStrokesToSVG(this.strokes, {
      width: options?.width ?? rect.width,
      height: options?.height ?? rect.height,
      ...options
    });
  }

  /**
   * 导出为 JSON 数据格式
   */
  public exportJSON(): string {
    return serializeStrokes(this.strokes);
  }

  /**
   * 导入 JSON 数据
   */
  public importJSON(jsonStr: string): void {
    const strokes = deserializeStrokes(jsonStr);
    this.loadStrokes(strokes);
  }

  /**
   * 导出为图片 DataURL
   */
  public toDataURL(type = 'image/png', quality = 0.95): string {
    return this.mainCanvas.toDataURL(type, quality);
  }

  /**
   * 销毁实例，解绑事件与 DOM
   */
  public destroy(): void {
    this.abortController.abort();
    this.resizeObserver?.disconnect();
    this.mainCanvas.remove();
    this.activeCanvas.remove();
    this.strokes = [];
    this.redoStack = [];
  }
}

/**
 * Factory helper function
 */
export function createInkCanvas(options: InkCanvasOptions): InkCanvas {
  return new InkCanvas(options);
}
