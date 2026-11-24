/**
 * UI 验收脚本（浏览器内执行）：逐页签断言"关键元素存在、可见、未被遮挡"。
 * 遮挡判定：元素中心点 elementFromPoint 必须落在元素自身或其后代上——
 * 这是 b4-b9 系列事故（闪退/样式丢失/工具栏被导航栏遮挡）的机械化回归防线。
 * 用法：preview 服务下，由验收流程注入浏览器 evaluate 执行，返回 PASS/FAIL 明细。
 */
export async function runUiAcceptance(viewport) {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail: String(detail).slice(0, 160) });

  const notOccluded = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, why: "zero-size" };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { ok: top ? el === top || el.contains(top) || top.contains(el) : false, why: top ? `covered-by:${top.tagName}.${String(top.className).slice(0, 40)}` : "no-element" };
  };
  const visible = (el) => el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const q = (sel) => document.querySelector(sel);

  // 0. 无启动失败(检查 #root 内实际渲染的错误卡元素,排除 error-handler 脚本源码)
  const bootErrorCard = [...document.querySelectorAll("#root strong")].some((s) => s.textContent.includes("预览页启动失败"));
  check("无启动错误卡", !bootErrorCard, bootErrorCard ? "预览页启动失败" : "ok");

  // 1. 先检查默认导航，再通过调试设置开启 AI 分析。
  const findNav = (label) => [...document.querySelectorAll("nav.topNav button")]
    .find((button) => button.textContent.trimStart().startsWith(label));
  const findSetting = (label) => [...document.querySelectorAll(".settingsGroups button")]
    .find((button) => button.textContent.trimStart().startsWith(label));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  const hasAI = Boolean(findNav("AI 分析"));
  check("默认隐藏 AI 分析页签", !hasAI, hasAI ? "已开启" : "已隐藏");
  if (!hasAI) {
    findNav("设置")?.click();
    await settle();
    [...document.querySelectorAll(".settingsCapsule button")]
      .find((button) => button.textContent.includes("关于插件"))?.click();
    await settle();
    if (!findSetting("启用 AI 分析")) {
      const version = findSetting("当前版本");
      for (let tap = 0; tap < 5; tap++) version?.click();
      await settle();
    }
    findSetting("启用 AI 分析")?.click();
    await settle();
  }
  const navBtns = [...document.querySelectorAll("nav.topNav button")];
  check("顶部导航存在 5 个页签", navBtns.length === 5, `实际 ${navBtns.length}`);
  for (const b of navBtns) {
    const oc = notOccluded(b);
    check(`导航「${b.textContent}」可见未遮挡`, visible(b) && oc.ok, oc.why || "ok");
  }

  // 2. 当前为 AI 分析页签
  const aiBtn = navBtns.find((b) => b.textContent === "AI 分析");
  if (aiBtn) aiBtn.click();
  // React 状态更新是异步的:等两帧再查询(同步查询会拿到旧 DOM)
  await new Promise((r) => setTimeout(r, 120));

  // 3. AI 工具栏操作入口:存在、可见、未被遮挡（会话切换 / 新会话 / 导出 / 同步 / 诊断 / 设置）
  const toolbarBtns = [...document.querySelectorAll('[data-slot="agent-toolbar"] button')];
  check("AI 工具栏操作入口", toolbarBtns.length >= 3, `实际 ${toolbarBtns.length}`);
  for (const b of toolbarBtns) {
    const oc = notOccluded(b);
    check(`工具栏「${b.textContent}」可见未遮挡`, visible(b) && oc.ok, oc.why || "ok");
  }

  // 4. 会话自动创建 + 激活（页面结构来自 vercel/chatbot：会话列表在 Sidebar 内）
  const sessionItem = q('[data-sidebar="menu-button"][data-active="true"]');
  check("自动创建会话并激活", Boolean(sessionItem), sessionItem ? sessionItem.textContent.slice(0, 40) : "无激活会话");

  // 5. 输入框可用、发送按钮存在且可点（AI Elements 提交按钮是图标按钮，用 aria-label/type 定位）
  const ta = q('[data-slot="agent-composer"] textarea');
  check("对话输入框存在可输入", Boolean(ta) && !ta.disabled, ta ? `disabled=${ta.disabled}` : "missing");
  const sendBtn = q('[data-slot="agent-composer"] button[aria-label="发送"]') || q('[data-slot="agent-composer"] button[type="submit"]');
  check("发送按钮存在", Boolean(sendBtn), sendBtn ? `disabled=${sendBtn.disabled}` : "missing");
  if (sendBtn) {
    const oc = notOccluded(sendBtn);
    check("发送按钮未被右下角热区遮挡", oc.ok, oc.why || "ok");
  }

  // 5b. §10.1 审核档位入口（页面结构来自 chatbot：档位在输入区工具栏的菜单里）
  const levelEntry = q('[data-slot="review-level"]');
  check("审核档位入口存在", Boolean(levelEntry), levelEntry ? levelEntry.textContent.slice(0, 20) : "缺失");

  // 6. 发送 → 回答带证据引用（预览 mock ~2.4s）
  if (ta && sendBtn) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "验收测试问题");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    (sendBtn.closest("form") || sendBtn).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  window.__acceptanceResults = results
  return { results, pendingSend: Boolean(ta && sendBtn) };
}

export async function finishUiAcceptance(viewport, results) {
  if (!results) results = window.__acceptanceResults || [];
  // 发送后异步回答验证
  const aiAnswer = [...document.querySelectorAll('[data-slot="message"]')].pop();
  results.push({ name: `${viewport}: AI 回答渲染`, pass: Boolean(aiAnswer && aiAnswer.textContent.includes("预览模式回答")), detail: aiAnswer ? aiAnswer.textContent.slice(0, 60) : "无回答" });
  results.push({ name: `${viewport}: 证据引用标签渲染`, pass: Boolean(document.querySelector('[data-slot="sources"]')), detail: "evidence ref" });
  const toolEntry = document.querySelector('[data-slot="tool"]');
  results.push({ name: `${viewport}: 工具调用记录渲染`, pass: Boolean(toolEntry), detail: toolEntry ? toolEntry.textContent.slice(0, 40) : "无工具卡片" });

  // AI 分析设置页：返回入口未被导航遮挡（b16）
  const settingsBtn = [...document.querySelectorAll("nav.topNav button")].find((b) => b.textContent.startsWith("设置"));
  if (settingsBtn) {
    settingsBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    const aboutBtn = [...document.querySelectorAll(".settingsCapsule button")].find((b) => b.textContent.includes("关于插件"));
    aboutBtn?.click();
    await new Promise((r) => setTimeout(r, 150));
    const aiEntry = [...document.querySelectorAll(".settingsGroup button, .settingsGroups button")].find((b) => b.textContent.includes("AI 分析设置"));
    results.push({ name: `${viewport}: 设置内可进入 AI 分析设置`, pass: Boolean(aiEntry), detail: aiEntry ? "ok" : "入口缺失" });
    if (aiEntry) {
      aiEntry.click();
      await new Promise((r) => setTimeout(r, 250));
      const back = document.querySelector(".agentBackButton");
      const r = back?.getBoundingClientRect();
      const hit = r ? document.elementFromPoint(r.left + Math.min(r.width / 2, 24), r.top + r.height / 2) : null;
      const ok = Boolean(back) && r.top >= 40 && (back === hit || back.contains(hit));
      results.push({ name: `${viewport}: AI 设置返回入口可见可点`, pass: ok, detail: back ? `y=${Math.round(r.top)}` : "缺失" });

      // v2.3 一键配置：服务商 chips + Key 输入 + 主操作按钮
      const chips = [...document.querySelectorAll(".agentPresetChip")];
      const activeChip = chips.filter((chip) => chip.getAttribute("aria-checked") === "true");
      results.push({
        name: `${viewport}: 一键配置服务商预置`,
        pass: chips.length >= 6 && activeChip.length === 1,
        detail: `${chips.length} 个，选中 ${activeChip.map((c) => c.textContent).join("/")}`,
      });
      const keyInput = document.querySelector(".agentSettings input[type='password']");
      results.push({ name: `${viewport}: API Key 输入框存在`, pass: Boolean(keyInput), detail: keyInput ? "ok" : "缺失" });
      const connectBtn = [...document.querySelectorAll(".agentSettings [data-slot='button']")].find((b) => b.textContent.includes("保存并获取模型"));
      const connectBox = connectBtn?.getBoundingClientRect();
      const connectHit = connectBox ? document.elementFromPoint(connectBox.left + connectBox.width / 2, connectBox.top + connectBox.height / 2) : null;
      // 空 Key 时按钮处于 disabled（pointer-events:none），命中测试会落到父元素；这里只在可点击时要求命中自身。
      const connectClickable = Boolean(connectBtn) && (connectBtn.disabled || connectBtn === connectHit || connectBtn.contains(connectHit));
      results.push({
        name: `${viewport}: 「保存并获取模型」可见未遮挡`,
        pass: connectClickable,
        detail: connectBtn ? `disabled=${connectBtn.disabled} h=${Math.round(connectBox?.height ?? 0)}` : "缺失",
      });
      const settingsScroller = document.querySelector(".agentSettings");
      results.push({
        name: `${viewport}: AI 设置页可滚动`,
        pass: Boolean(settingsScroller) && getComputedStyle(settingsScroller).overflowY === "auto",
        detail: settingsScroller ? `overflow=${getComputedStyle(settingsScroller).overflowY}` : "缺失",
      });
    }
  }

  // 其余页签逐个检查
  const tabs = ["总览", "错题本", "待复习", "设置"];
  const navBtns2 = [...document.querySelectorAll("nav.topNav button")];
  for (const name of tabs) {
    const btn = navBtns2.find((b) => b.textContent.startsWith(name));
    if (!btn) { results.push({ name: `${viewport}: ${name} 页签`, pass: false, detail: "按钮缺失" }); continue; }
    btn.click();
    if (name === "总览") {
      await new Promise((r) => setTimeout(r, 200));
      const report = document.querySelector('[data-slot="ai-report-card"]');
      const sendless = document.querySelector('[data-slot="report-metric"]');
      results.push({
        name: `${viewport}: 总览 AI 数据报告卡渲染`,
        pass: Boolean(report),
        detail: report ? `${document.querySelectorAll('[data-slot="report-metric"]').length} 项指标` : "缺失",
      });
      void sendless;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return results;
}


// 浏览器验收流程通过 window 调用（module import 在 evaluate 中不可用）。
if (typeof window !== "undefined") {
  window.__uiAcceptance = { runUiAcceptance, finishUiAcceptance };
}
