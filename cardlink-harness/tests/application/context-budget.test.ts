import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { computeContextPlan, recentRetentionTokens, DEFAULT_BUDGET_POLICY } from "../../src/application/context-budget.ts";
import { HeuristicTokenEstimator, applyCalibration, estimateContextInput } from "../../src/application/token-estimator.ts";
import { ModelCapabilitiesRegistry } from "../../src/application/model-capabilities-registry.ts";
import { InMemoryModelCapabilitiesStore } from "../../src/application/ports/model-capabilities-store.ts";
import { defaultCapabilities } from "../../src/domain/model-capabilities.ts";

const K = 1024;

function caps(contextWindowTokens: number, maxOutputTokens: number) {
  return { ...defaultCapabilities("test", "m"), contextWindowTokens, maxOutputTokens };
}

function planFor(windowTokens: number, requestedOutput: number, estimatedInput = 0) {
  return computeContextPlan({
    capabilities: caps(windowTokens, Math.min(windowTokens, 64 * K)),
    requestedOutputTokens: requestedOutput,
    estimatedInputTokens: estimatedInput,
  });
}

describe("v2.5 §5.2：上下文预算（B_input = C − O − R）", () => {
  test("B1: 32K 窗口 + 16K 请求输出 → B_input = 32768 − 16384 − 4096", () => {
    const { plan, error } = planFor(32 * K, 16 * K);
    assert.equal(error, undefined);
    assert.equal(plan.outputBudgetTokens, 16 * K);
    assert.equal(plan.reservedTokens, 4096);
    assert.equal(plan.inputBudgetTokens, 32 * K - 16 * K - 4096);
  });

  test("B2: 64K / 128K / 256K 窗口按同一公式分配，输出受 16K 请求约束", () => {
    for (const window of [64 * K, 128 * K, 256 * K]) {
      const { plan } = planFor(window, 16 * K);
      assert.equal(plan.outputBudgetTokens, 16 * K);
      assert.equal(plan.inputBudgetTokens, window - 16 * K - 4096);
    }
    assert.equal(planFor(64 * K, 16 * K).plan.inputBudgetTokens, 45056);
    assert.equal(planFor(128 * K, 16 * K).plan.inputBudgetTokens, 110592);
    assert.equal(planFor(256 * K, 16 * K).plan.inputBudgetTokens, 241664);
  });

  test("B3: 请求输出超过服务商上限时按上限收敛", () => {
    const { plan } = computeContextPlan({
      capabilities: caps(64 * K, 8 * K),
      requestedOutputTokens: 32 * K,
      estimatedInputTokens: 0,
    });
    assert.equal(plan.outputBudgetTokens, 8 * K);
  });

  test("B4: 小窗口按比例缩小安全余量，输出为窗口让路", () => {
    const { plan } = planFor(8192, 8192);
    assert.equal(plan.reservedTokens, 1024);
    assert.ok(plan.outputBudgetTokens < 8192);
    assert.ok(plan.inputBudgetTokens >= DEFAULT_BUDGET_POLICY.minInputBudgetTokens);
  });

  test("B5: 窗口过小无法容纳最小输入 → 显式 context_budget_insufficient", () => {
    const { error } = planFor(2048, 8192);
    assert.equal(error, "context_budget_insufficient");
  });

  test("B6: 85% 触发阈值与近期保留 min(20k, 40%)", () => {
    const budget = 100_000;
    const below = computeContextPlan({
      capabilities: caps(200_000, 16 * K),
      requestedOutputTokens: 16 * K,
      estimatedInputTokens: Math.floor((200_000 - 16 * K - 4096) * 0.84),
    });
    assert.equal(below.plan.requiresCompaction, false);
    const above = computeContextPlan({
      capabilities: caps(200_000, 16 * K),
      requestedOutputTokens: 16 * K,
      estimatedInputTokens: Math.floor((200_000 - 16 * K - 4096) * 0.86),
    });
    assert.equal(above.plan.requiresCompaction, true);
    assert.equal(recentRetentionTokens(budget), 20000);
    assert.equal(recentRetentionTokens(30_000), 12000);
  });
});

describe("v2.5 §5.2：token 估算（中文/英文/JSON，保守 + 校准）", () => {
  const estimator = new HeuristicTokenEstimator();

  test("E1: 中文按字计（保守），英文按 3 字符/token 向上取整", () => {
    assert.equal(estimator.estimate("你好世界"), 4);
    assert.equal(estimator.estimate("hello world"), 4);
    assert.ok(estimator.estimate("这是一个包含中文与 English 的句子") >= 12);
    // LaTeX 公式：反斜杠/大括号等结构字符按拉丁字符计入，非零且随长度增长。
    const formula = String.raw`\frac{\partial L}{\partial \theta} = \sum_{i=1}^{n} \nabla_\theta \ell(x_i)`;
    assert.ok(estimator.estimate(formula) >= Math.ceil(formula.replace(/\s/g, "").length / 3));
  });

  test("E2: 空白不计、结构字符计入", () => {
    assert.equal(estimator.estimate("   \n\t "), 0);
    assert.ok(estimator.estimate('{"recordId":"abc:def","limit":20}') >= 8);
  });

  test("E3: 上下文估算包含指令、工具与消息结构开销", () => {
    const one = estimateContextInput({ instruction: "系统", messages: [], tools: [] }, estimator);
    const many = estimateContextInput(
      {
        instruction: "系统",
        messages: [{ type: "user", text: "你好" }, { type: "user", text: "再见" }],
        tools: [{ name: "queryMistakes", description: "查询错题", parameters: { type: "object" } }],
      },
      estimator,
    );
    assert.ok(many > one + 8);
  });

  test("E4: 校准系数向上取整应用，非法系数原样返回", () => {
    assert.equal(applyCalibration(100, 1.23), 123);
    assert.equal(applyCalibration(100, undefined), 100);
    assert.equal(applyCalibration(100, 0), 100);
  });
});

describe("v2.5 §5.2：能力登记（用户 > 已验证 > 保守默认）", () => {
  test("R1: 未知模型走保守默认 32K/8K，来源 default", () => {
    const registry = new ModelCapabilitiesRegistry();
    const resolved = registry.resolve("p1", "unknown-model");
    assert.equal(resolved.capabilities.contextWindowTokens, 32 * 1024);
    assert.equal(resolved.capabilities.maxOutputTokens, 8 * 1024);
    assert.equal(resolved.capabilities.source, "default");
  });

  test("R2: 已验证预置按精确模型 id 命中", () => {
    const registry = new ModelCapabilitiesRegistry();
    const resolved = registry.resolve("deepseek-main", "deepseek-chat");
    assert.equal(resolved.capabilities.contextWindowTokens, 65536);
    assert.equal(resolved.capabilities.source, "verified");
  });

  test("R3: 用户覆盖优先于预置；非法覆盖被拒绝", () => {
    const store = new InMemoryModelCapabilitiesStore();
    const registry = new ModelCapabilitiesRegistry(store);
    registry.setUserOverride({
      providerId: "p1",
      modelId: "deepseek-chat",
      contextWindowTokens: 32768,
      maxOutputTokens: 4096,
      supportsToolCalls: true,
      supportsUsage: true,
    });
    const resolved = registry.resolve("p1", "deepseek-chat");
    assert.equal(resolved.capabilities.source, "user");
    assert.equal(resolved.capabilities.contextWindowTokens, 32768);
    assert.throws(() => registry.setUserOverride({ providerId: "p1", modelId: "m", contextWindowTokens: 100, maxOutputTokens: 10 }));
  });

  test("R4: 用量观测校准（EMA 0.3，限幅 0.5–2.0）", () => {
    const store = new InMemoryModelCapabilitiesStore();
    const registry = new ModelCapabilitiesRegistry(store);
    assert.equal(registry.observeUsage("p1", "m1", 100, 200), 2);
    assert.equal(registry.observeUsage("p1", "m1", 100, 100), 1.7);
    // 单次异常值被限幅到 2.0，再做 EMA：1.7×0.7 + 2×0.3 = 1.79
    assert.equal(registry.observeUsage("p1", "m1", 100, 10_000), 1.79);
    assert.equal(registry.resolve("p1", "m1").calibrationRatio, 1.79);
  });
});
