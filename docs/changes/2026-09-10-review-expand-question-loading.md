# 2026-09-10 — 待复习批量展开原题卡住修复

## 变更目的

修复待复习页展开全部题目时，个别原题请求失败或页面状态在请求过程中变化，导致部分卡片长期停留在“正在读取完整原题”的问题；同时降低批量展开对原生桥与答案索引的压力。

## 实现行为

- 新增轻量 `mistakeQuestion` 桥命令，只读取并渲染原题 HTML；批量展开不再为每题执行答案匹配及答案 HTML 生成。
- 原题与完整详情分别使用有界、双并发请求协调器；相同题目与版本的在途请求继续去重。
- 请求复用缓存仍保持 6 项/8 MB 上限，但当前处于展开状态的原题全部保留；不再因展开超过 6 道而把先完成的原题从页面状态中淘汰。
- 收起单题或收起全部会释放对应的页面原题内容；尚未回包且已收起的内容不会重新写回页面状态。
- 已经发出的原题请求不再因筛选、折叠或列表刷新而被作废，回包仍会写入有界页面缓存。
- 单题请求失败后释放并发槽位，卡片显示失败态与“重试”按钮，后续题目继续读取。
- 保留“查看答案”的完整 `mistakeDetail` 路径，原有答案候选与缩放行为不变。

## 受影响文件或模块

- `src/mistake-manager.ts`：轻量原题读取函数。
- `src/rails-core.ts`：桥命令分发。
- `web/src/main.jsx`：原题请求状态机、失败态与重试。
- `web/src/lib/previewBridge.js`：浏览器预览命令实现。
- `web/src/ui/review.css`：失败态样式。
- `tests/bridge-schema.test.ts`、`tests/web-bridge.test.ts`、`tests/review-detail-cache.test.ts`：桥协议、轻量路径和队列失败回归。
- `docs/pages/review.md`、`docs/modules/web/review-detail-cache.md`：行为文档。
- `package.json`、`RELEASE_NOTES_v2.4.1b1.md`：版本与发布说明。

## 兼容性与数据影响

- `mnChannel` 继续为 `stable`，插件 ID 与标题不变。
- 不修改错题记录、复习计划、答案绑定或缓存持久化格式。
- 新桥命令只在当前 Web 与原生代码内部配套使用；已有 `mistakeDetail` 协议保持兼容。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，220/220。
- `pnpm build`：通过，生成 `dist/CardLink-v2.4.1b1.mnaddon`。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b1.mnaddon`。
- 包内清单已核对：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b1`。
- 构建原件与交付副本均为 519,198 字节，SHA-256 一致：`7EF8C96650174FC571C2C2845A874D3A66B73A7B3B1B3AC23A1E61A12139A411`。

## 未验证限制

- 尚需在 MarginNote 4 真机上用包含大量复杂题卡、图片和手写内容的真实待复习队列复验批量展开体验。
- 构建仍可能报告既有的 `.sfIconGlyph:svg` CSS 选择器警告；该警告不影响产物生成。
