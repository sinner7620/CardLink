# v2.3.3-beta.78：图标形变动画全面迁移 Morphicons 官方引擎

日期：2026-09-06。基线：beta.77（正式渠道，版本号 2.3.3-beta.78）。范围：上轮审计发现的两套动画并存问题——勾选/开关/箭头类约 10 处自写 CSS 交叉淡化全部迁移官方 `createMorph`，规范固化进 AGENTS.md，并清理死代码。

## 根因与实现

自写 `MorphIcon` 用双 path 叠加 + CSS `opacity/scale/rotate` 过渡模拟 morph（固定时长贝塞尔、不可打断、无几何过渡）。重写为 `createMorph` 引擎驱动：单 path 按激活态在 from/to 数据间弹簧几何插值，勾选类 `bouncy`、其余 `snappy`，`reducedMotion: "user"`；预设仅官方三档，无自定义弹簧参数。删除 `.morphIconFrom/.morphIconTo` 及 filled 过冲贝塞尔 CSS、morphPaths 死图标数据 8 项、未被引用的引擎打包副本 `morphicons-vendor.js`。

AGENTS.md 新增强制动画规范：图标形变必须 `morphicons/dom` 的 `createMorph`，禁手写交叉淡化/贝塞尔模拟；预设仅 smooth/snappy/bouncy；必须 reducedMotion "user"；图标按数据消费；非 morph 运动保持 CSS 且尊重 prefers-reduced-motion；评审拒绝手写 morph。

## 影响文件

`web/src/main.jsx`、`web/src/ui/controls.css`、`web/src/morphicons-vendor.js`（删）、`AGENTS.md`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.78.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。勾选/开关/箭头的动画手感由交叉淡化变为几何 morph，属预期变化。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.78.mnaddon`（SHA-256 `61DD9952B122C1F629AF26239818D3F51D5F94C53C4780C272BF5A3AD587F850`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.78.mnaddon`，副本与原包哈希一致。
- Playwright 证据：多选按钮激活态 path 为 2049 字符插值结果；折叠按钮 rest `M6 9l6 6 6-6` → 中途帧 `M6.18 8.66…`/`M15.97 6.66…` → done `M6 15l6-6 6 6`，确认为弹簧几何插值。

## 未验证限制

- 几何 morph 的真机手感（相对交叉淡化）待复验；eyeOff 多子路径配对观感如有问题反馈后单独调图标对。
