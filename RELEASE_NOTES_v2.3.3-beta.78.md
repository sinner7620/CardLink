# v2.3.3-beta.78

基线：beta.77。本版把全部手写图标形变动画迁移到 Morphicons 官方引擎，并将该规范固化进 AGENTS.md。

## 背景

此前图标形变动画是两套并存：dock/定位/收藏三处用官方 `createMorph`（弹簧物理几何插值）；勾选、开关、箭头类约 10 处用自写的 `MorphIcon` 双 path 交叉淡化（CSS `opacity/scale/rotate` 过渡，固定时长贝塞尔，不可打断）。本次统一为官方引擎。

## 实现

- `MorphIcon` 重写为 `createMorph` 驱动：单 path 由引擎按激活态在 from/to 图标数据间做几何插值，勾选/多选类用 `bouncy`、其余用 `snappy`，创建时一律 `{ reducedMotion: "user" }`；预设仅用官方 smooth/snappy/bouncy，未自定义弹簧参数。
- 删除自写动画 CSS：`.morphIconFrom/.morphIconTo` 交叉淡化、`.morphIconFilled path` 过冲贝塞尔过渡（controls.css 两处）。
- 删除 `morphPaths` 中无引用的死图标数据（multiSelect/check/checkbox/checkboxChecked/selectAll/deselectAll/question/answer）。
- 删除未被引用的引擎打包副本死文件 `web/src/morphicons-vendor.js`（约 30KB）。
- **AGENTS.md 新增"Mandatory animation spec (Morphicons)"**：所有 SVG 图标形变动画必须用官方 `morphicons/dom` 的 `createMorph`；禁止双 path 交叉淡化、CSS opacity/transform 模拟 morph；预设仅限官方三个；必须 `reducedMotion: "user"`；图标以数据（d 字符串 / Lucide IconNode）消费；非 morph 运动（转圈、高亮、布局过渡）保持普通 CSS 并尊重 `prefers-reduced-motion`；新增图标/状态动画一律走 createMorph 组件，评审拒绝手写 morph。

## 影响文件

`web/src/main.jsx`（MorphIcon 重写 + morphPaths 清理）、`web/src/ui/controls.css`（删自写动画 CSS）、`web/src/morphicons-vendor.js`（删除）、`AGENTS.md`、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。视觉差异：勾选/开关/箭头形变从"交叉淡化"变为真几何 morph（中途帧为插值形状），可打断、落定为 canonical 路径。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.78.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 证据：多选按钮激活/静止的 path 均由引擎输出（激活态 2049 字符插值 d、3 子路径）；开关、折叠按钮切换前后 path 变化；折叠按钮中途帧为插值坐标（rest `M6 9l6 6 6-6` → mid `M6.18 8.66…`/`M15.97 6.66…` → done `M6 15l6-6 6 6`），证明弹簧几何插值而非交叉淡化。

## 未验证限制

- 勾选/开关形变的真机观感（几何 morph 与原交叉淡化的手感差异）待复验；如某处不适应引擎形态（如 eyeOff 的多子路径配对观感），反馈后单独调整图标对。
