# v2.3.3-beta.94：错题并发分页与答案悬浮条

日期：2026-09-06。基线：beta.93（正式渠道，版本号 2.3.3-beta.94）。范围：按 v92 故障方案修复错题加载停在首批 25 条，并统一查找答案窗口顶部控件形态。

## 变更目的

- 消除仪表盘和错题列表并发初始化时共享单个分页快照所产生的 `transferId` 覆盖，使各页面能够独立续页。
- 将答案窗口分散的关闭、刷新和候选答案控件组合为同插件工具条风格的悬浮条，同时保持设置中的左右位置开关有效。
- 保留旧版多答案的 MarginNote 原生弹窗选择体验，并避免唯一精确答案仍显示伪候选。

## 已实现行为

- `mistake-manager` 使用 `Map<string, WorkbenchTransfer>` 保存并发分页传输，通过唯一 `transferId` 读取对应快照。
- 每次开始或继续传输时清理超过 60 秒未使用的快照；新建前按最近使用时间淘汰，活跃传输上限为 4。
- 新增并发行为测试：连续创建两个传输后，两个 ID 均能独立继续获取分页；该测试会直接覆盖旧单例被后一次初始化覆盖的故障路径。
- 答案窗口新增统一半透明圆角悬浮容器，三个 32pt 控件在 42pt 高度内共用中线；有候选时宽 112pt，无候选时宽 77pt。
- 左侧设置下顺序为关闭、刷新、候选；右侧设置下整体贴右并镜像为候选、刷新、关闭。
- 少于两个有效候选时隐藏候选控件并收缩整条；存在多个候选时显示当前候选序号，点击调用既有 MarginNote 原生选择弹窗。

## 影响文件或模块

- `src/mistake-manager.ts`
- `src/window-controls.ts`
- `src/answer-card-view.ts`
- `tests/mistake-performance.test.ts`
- `tests/mistake-write-behavior.test.ts`
- `tests/domain.test.ts`
- `tests/plugin-events.test.ts`
- `package.json`
- `RELEASE_NOTES_v2.3.3-beta.94.md`

## 兼容性与数据影响

错题记录格式、持久化键、答案绑定、用户设置及 Web/原生桥接命令均未改变，无需数据迁移。分页快照仅存在于当前插件运行内存，过期或被淘汰后由调用端重新初始化即可。正式插件 ID 和 `mnChannel: "stable"` 保持不变。

## 验证

- `pnpm check`：通过。
- `pnpm test`：182/182 通过。
- `pnpm build`：通过，产物为 `E:\project\MN\dist\mn4-answer-matcher-v2.3.3-beta.94.mnaddon`。
- 产物大小：499,083 字节。
- 已复制至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.94.mnaddon`。
- 源包与交付副本 SHA-256 均为 `2F5F3831109FAF7854D25A5898107F9277287894E0D13B3882426120FA78AA0E`，校验一致。

## 未验证限制

- 尚未使用约 880 条错题的真实 iPad 数据执行冷启动、连续续页与双页面并发压力复验。
- 悬浮条的实际触控区域、阴影与中线观感、开关左右换边，以及原生候选弹窗需在 MarginNote iPad 真机确认。
- 构建输出仍有既存 `.sfIconGlyph:svg` Lightning CSS 伪类警告；该样式不在本轮范围内且未阻止产物生成。
