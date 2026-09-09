# 2026-09-03 beta.63 — CSS 四代体系收敛：token 摊平、死声明清除、单定义合并

## 目的

处理 UI 评审结论：app.css 已达 122.5 KB，mn-blue-legacy / study-* / preview-ui-* / rd-* 四代样式体系并存，token 层层别名映射（`--preview-ui-ink: var(--rd-ink)`、`--rd-accent: var(--mn-accent)`），同一组件被前代定义、重构层覆盖、priority 层再修。要求"删除以前的样式，仅保留当前的样式，同时保证当前页面不变"。

## 安全方法（先于任何改动搭建）

- `scripts/css-baseline.mjs`（新增，常驻工具）：对完整 UI 预览页按 6 个状态（总览 / 错题列表 / 错题详情+标签弹层 / 待复习含复测历史时间轴 / 设置 / 导出页）× 3 个视口（900/700/460px，覆盖 600 与 800px 断点）逐元素 dump `getComputedStyle`（约 70 个视觉属性 + 全部自定义属性 + 有内容的 ::before/::after 伪元素），改前采集 18 状态 3216 条记录作为基线。
- 每轮改动后重建并逐项比对；另抽取 2 个状态做截图字节级比对（同机同 Chrome 渲染确定性成立时像素完全一致）。
- 基线自测：采集结果与自身比对必须零差异。

## 改动一：token 别名链摊平（`scripts/flatten-ui-css.mjs` 新增）

- 消除 16 个全局单值别名，104 处 `var()` 引用重写到终点 token，别名定义删除：
  - `--mn-blue-legacy / -deep / -bright`、`--preview-ui-primary`、`--preview-accent` → `--mn-accent`
  - `--preview-accent-soft` → `--mn-gray-fill`；`--preview-ui-danger` → `--mn-level-0`
  - `--preview-ui-ink/muted/line/line-strong/surface/accent/button-active/selected/selected-strong` → `--rd-*` 同名 token
- 保留原则：字面值不同的旧 token（如 `--study-ink: #0f172a`，与新代 `--rd-ink: #1d1d1f` 值不同）一律保留原名，不猜值；带作用域重定义的名字不消除；JS 运行时注入名（`--mn-accent`、`--mn-gray-fill`、`--mn-level-0/1/2`、`--mn-topbar-height`、`--progress`）永不消除。
- 删除 8 个零引用孤立 token：`--z-dropdown`、`--z-native-sheet`、`--z-native-popover`、`--z-glass-max`、`--study-soft`、`--preview-accent-ring`、`--rd-accent-tint-strong`、`--rd-text`（已确认 CSS/TS/JSX/rails-native 全域无引用）。
- controls.css 的 6 个 `:root` 块与 tokens.css 的 :root 各自收敛为单块。

## 改动二：死声明与多块合并（同文件、同层、同 at-rule 上下文内）

- 同选择器多 occurrence 组 132 组：被后面同属性声明覆盖的死声明就地删除（同 selector 文本 ⇒ 匹配集合相同 ⇒ 后值恒胜，删除无条件级联安全），共 8 条；priority 层对同 selector+属性在 base 层的声明清除 28 条。
- 同选择器多块条件合并 20 组：仅当两块之间不存在"同优先级且声明任一相同属性"的中间规则时才合并到最后块位置，避免翻转。
- **关键教训**：最初实现"合并到最后位置"曾产生 2049 处真实渲染差异——多选择器规则（如 `.mistakeList, .detailPane`）夹在中间时，前面块的声明被搬动后会跳过它并翻转胜者。修正为"只原地删除死声明，绝不移动"，此后全程零差异。

## 测试断言更新（tests/web-bridge.test.ts）

- `--preview-ui-line` 断言更新为规范名 `var(--rd-line)`（意图不变：详情页签复用共享次级按钮样式）。
- `.shell > main` 的 overflow 断言改为声明顺序无关（`\{[^}]*overflow:\s*hidden`，意图不变：根页面固定）。
- 导出顺序断言（web-bridge.test.ts:139-144）维持 beta.62 语义。

## 受影响文件

- `web/src/ui/*.css`（8 个所有权模块，6735 → 6578 行）
- `tests/web-bridge.test.ts`（2 条断言随 token 规范名/顺序无关化更新）
- `scripts/flatten-ui-css.mjs`、`scripts/css-baseline.mjs`（新增工具）
- `package.json`（`2.3.3-beta.63`）、`README.md`、`RELEASE_NOTES_v2.3.3-beta.63.md`、`交接文档.md`

## 验证

- 基线比对：18 状态 × 3 视口全元素计算样式 + 伪元素 + 自定义属性**零差异**；2 状态截图字节级完全一致。
- `pnpm check` 通过；`pnpm test` 158/158；`pnpm build` 产物 `dist/mn4-answer-matcher-v2.3.3-beta.63.mnaddon`。
- 产物 `web-dist/app.css` 122.5 KB → 116.2 KB（-5.2%；minify 后别名引用与死声明的缩减被保留）。

## 剩余结构与后续约定

- 点名的 6 个组件（.topNav button strong / .pageHeading / .overviewCards / .detailHeader h2 / .reviewHistory / .exportLayout）收敛后仍各有 3–7 个规则块：它们是**存活的级联件**（media 变体、priority 层修正、跨文件分组选择器），删除需要"重写最终胜值"而非删除，须逐个走基线比对流程，本轮未强行合并。
- 全部 DOM 类名与 CSS 选择器交叉核验：**零死选择器**（preview-level-1/2 为模板字符串动态生成，存活）。
- 约定：新样式一律写入所有权模块内该组件的唯一块，不再向文件尾部追加覆盖规则；批量改动用 `node scripts/flatten-ui-css.mjs` 收敛、`node scripts/css-baseline.mjs capture|diff` 验证。
- 未真机验证：预览层与真机 UIWebView 同源同 CSS，但最终以真机目测复核为准。
