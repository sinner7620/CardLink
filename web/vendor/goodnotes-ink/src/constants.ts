import { PenOptions } from './types';

/**
 * GoodNotes Fountain Pen Golden Baseline Configuration
 * 实测最接近真实 GoodNotes 钢笔手感的黄金基准配置
 */
export const GOODNOTES_GOLDEN_BASELINE_CONFIG: PenOptions = {
  color: '#1c1917',
  size: 3.5,
  smoothing: 0.60,
  penType: 'fountain',
  simulatePressure: false,

  // 4-Dimensional Core Handwriting Feel
  tipSharpness: 0.66,
  pressureSensitivity: 0.66,
  flatness: 0.66,
  nibAngle: -Math.PI * 0.22, // -40 deg

  // Damping & Rectification
  stabilization: 1.20, // 0-200 扩展范围中的 120 舒适档位
  rectification: 1.00, // 100% 满档拉普拉斯曲线张力纠偏
  wobbleFilter: 0.60,

  // Psychophysics Non-linear Pressure Curve (Weber-Fechner Law)
  pressureModel: 'logarithmic',
  pressureFloor: 0.20, // 20% 保底线宽，轻写清脆有骨
  pressureCeiling: 1.00, // 100% 重压软饱和封顶
  pressureGain: 1.80,

  // Straight line de-tamp (disabled by default so ordinary handwriting is completely unhindered)
  headingFilter: 0,
  resampleStep: 0,
  railTension: 0,
  widthViscosity: 0,
  lateralDrag: 0
};

/**
 * Ballpoint Pen Preset (圆珠笔预设)
 */
export const BALLPOINT_CONFIG: PenOptions = {
  ...GOODNOTES_GOLDEN_BASELINE_CONFIG,
  penType: 'ballpoint',
  flatness: 0.0,
  size: 2.5,
  tipSharpness: 0.2,
  pressureSensitivity: 0.4
};

/**
 * Brush Pen Preset (秀丽笔/书法毛笔预设)
 */
export const BRUSH_CONFIG: PenOptions = {
  ...GOODNOTES_GOLDEN_BASELINE_CONFIG,
  penType: 'brush',
  flatness: 0.75,
  size: 4.5,
  tipSharpness: 0.85,
  pressureSensitivity: 0.85,
  pressureModel: 'tanh'
};

/**
 * Highlighter Preset (荧光笔预设)
 */
export const HIGHLIGHTER_CONFIG: PenOptions = {
  ...GOODNOTES_GOLDEN_BASELINE_CONFIG,
  penType: 'highlighter',
  flatness: 0.90,
  size: 16.0,
  color: '#fef08a',
  tipSharpness: 0.0,
  pressureSensitivity: 0.0,
  stabilization: 0.50
};

/**
 * Default SDK Options
 */
export const DEFAULT_PEN_OPTIONS: PenOptions = {
  ...GOODNOTES_GOLDEN_BASELINE_CONFIG
};
