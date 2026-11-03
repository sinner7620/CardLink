import { PenOptions } from '../types';

/**
 * Dual-bounded non-linear pressure transfer function
 * 心理物理学双端有界非线性压感传递函数
 *
 * 遵循韦伯-费希纳定律 (Weber-Fechner Law) 与史蒂文斯幂律 (Stevens' Power Law)
 * - Floor: 轻写起步保底线宽 (防止发丝打滑)
 * - Ceiling: 重压软饱和渐进封顶 (防止墨迹肥厚失控)
 * - Dynamic Zone: 微力区间快速过渡
 */
export function evaluatePressureCurve(p: number, options: Partial<PenOptions>): number {
  const clampedP = Math.max(0, Math.min(1, p));
  const model = options.pressureModel || 'logarithmic';
  const floor = options.pressureFloor ?? 0.20;
  const ceiling = options.pressureCeiling ?? 1.00;
  const gain = Math.max(0.2, options.pressureGain ?? 1.80);

  let g = 0; // normalized response in [0, 1]

  switch (model) {
    case 'logarithmic': {
      // 对数压缩模型：微力区间响应快，深压平滑贴顶
      const beta = 8.0 * gain;
      g = Math.log(1 + beta * clampedP) / Math.log(1 + beta);
      break;
    }
    case 'sigmoid': {
      // S型 Logistic 曲线：以 0.28 典型运笔压力为中心
      const p0 = 0.28;
      const k = 9.0 * gain;
      const s = (x: number) => 1 / (1 + Math.exp(-k * (x - p0)));
      const s0 = s(0);
      const s1 = s(1);
      g = (s(clampedP) - s0) / (s1 - s0);
      break;
    }
    case 'power': {
      // 幂律软饱和
      const gamma = Math.max(0.15, 0.40 / gain);
      g = Math.pow(clampedP, gamma);
      break;
    }
    case 'tanh': {
      // 双曲正切弹性模型
      const alpha = 3.0 * gain;
      g = Math.tanh(alpha * clampedP) / Math.tanh(alpha);
      break;
    }
    case 'piecewise': {
      // 分段双斜率膝点模型
      const knee = 0.32;
      const kneeG = 0.72;
      if (clampedP <= knee) {
        g = (clampedP / knee) * kneeG;
      } else {
        g = kneeG + (1 - kneeG) * ((clampedP - knee) / (1 - knee));
      }
      break;
    }
    default:
      g = clampedP;
  }

  // 映射到目标粗细比例
  const targetRatio = floor + (ceiling - floor) * g;

  // 结合用户的压力敏感度微调
  const sens = options.pressureSensitivity ?? 0.66;
  return 1.0 + (targetRatio - 1.0) * (sens * 2.0);
}
