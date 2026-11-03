/**
 * goodnotes-ink - TypeScript Type Definitions
 * Probably the open-source JS handwriting canvas closest to GoodNotes fountain pen feel.
 */

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
  tiltX?: number;
  tiltY?: number;
}

export type PenType = 'fountain' | 'ballpoint' | 'brush' | 'highlighter';

export type PressureCurveModel = 'logarithmic' | 'sigmoid' | 'power' | 'tanh' | 'piecewise';

export interface PenOptions {
  color: string;
  size: number;
  smoothing: number;
  penType: PenType;
  simulatePressure: boolean;

  // GoodNotes Core Handwriting Feel Parameters
  tipSharpness: number;        // 0.0 - 1.0 (出锋锐度, e.g. 0.66)
  pressureSensitivity: number; // 0.0 - 1.0 (压力敏感度, e.g. 0.66)
  flatness: number;            // 0.0 - 1.0 (扁平切角比例, e.g. 0.66)
  nibAngle: number;            // radians, default -40 deg (-Math.PI * 0.22)

  // Stabilization & Rectification
  stabilization: number;       // 0.0 - 2.0 (阻尼平滑系数, e.g. 1.20)
  rectification: number;       // 0.0 - 1.0 (拉普拉斯几何纠偏张力, e.g. 1.00)
  wobbleFilter: number;        // 0.0 - 1.0 (玻璃微抖抑制门限, e.g. 0.60)

  // Non-linear Pressure Transfer Model (Psychophysics)
  pressureModel: PressureCurveModel; // 'logarithmic' | 'sigmoid' | 'power' | 'tanh' | 'piecewise'
  pressureFloor: number;       // 0.05 - 0.80 (轻写起笔保底粗细比例, e.g. 0.20)
  pressureCeiling: number;     // 0.80 - 2.00 (重压软饱和封顶倍率, e.g. 1.00)
  pressureGain: number;        // 0.50 - 3.00 (对数曲率陡度/增益, e.g. 1.80)

  // Straight Stroke Anti-Wobble & De-Tamping (Opt-in)
  headingFilter?: number;      // 0.0 - 1.0 (笔向向量惯性滤波, e.g. 0.85)
  resampleStep?: number;       // 0.5 - 5.0 px (等距降噪重采样步长, e.g. 2.2)
  railTension?: number;        // 0.0 - 1.0 (导轨趋势张力引力, e.g. 0.70)
  widthViscosity?: number;     // 0.0 - 1.0 (粗细粘滞阻尼, e.g. 0.75)
  lateralDrag?: number;        // 0.0 - 1.0 (侧向摩擦阻尼, e.g. 0.65)
}

export interface CurvePoint {
  x: number;
  y: number;
  width: number;
  time: number;
  pressure: number;
}

export interface SavedStroke {
  id?: string;
  points: StrokePoint[];
  options: PenOptions;
  timestamp: number;
}

export interface RenderContext {
  mainCtx: CanvasRenderingContext2D;
  activeCtx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
}

export type AnnotationMode = 'annotate' | 'browse' | 'clean';

export interface InkCanvasOptions {
  container: HTMLElement | string;
  width?: number;
  height?: number;
  dpr?: number;
  palmRejection?: boolean;
  penOptions?: Partial<PenOptions>;
  mode?: AnnotationMode;
  onStrokeStart?: (point: StrokePoint) => void;
  onStrokeEnd?: (stroke: SavedStroke) => void;
  onChange?: (strokes: SavedStroke[]) => void;
  onModeChange?: (mode: AnnotationMode) => void;
}

export interface ExportSVGOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  margin?: number;
}
