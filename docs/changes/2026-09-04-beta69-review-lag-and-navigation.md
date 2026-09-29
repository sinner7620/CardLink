# beta.69：待复习卡顿、悬浮球与定位刷新

## 目的

修复悬浮球单击崩溃面、待复习答案操作牵动整列，以及定位原题产生整页加载和不必要错题传输的问题。按照用户要求，保留当前题目的全部答案候选一次生成方式。

## 根因与实现

### 悬浮球

beta.64 为悬浮球单击独立增加了一套 UIKit 自绘快捷菜单。该菜单重复实现了设置页和主面板已有能力，也是单击路径与稳定工具栏入口之间唯一的大块差异。本版完整删除菜单的创建、遮罩、标签、按钮回调和导出，不继续修补；单击直接调用 `WebPanelController` 已有的 `showPanel`/`hidePanel`，长按仍调用原窗口复位逻辑。

### 定位与全量刷新

- `action(..., false)` 不再设置全局 `busy`，定位只显示自身 Morphicons 状态。
- 错题快照增加由 `recordId + updatedAt` 生成的轻量修订号。面板恢复时只请求修订号，变化后才获取 dashboard。
- 同时到达的全量加载请求串行合并，避免多个 `transferId` 相互覆盖。
- 关闭按钮位置同步只更新答案窗口，不再发送错误的“数据已变化”通知。

### 待复习预览

- 新增共享详情缓存：相同题目/版本请求合并，桥请求最多两个并发，LRU 上限为 6 题或 8 MB。
- 原题与答案复用同一缓存；保留一次生成当前题目全部候选答案的协议。
- 答案索引和缩放状态移入 `ReviewAnswer`，缩放不再改变 `DueReviewList` 的状态。
- `CardPreview` 使用 `React.memo`；离屏题目使用 `content-visibility`，减少长列表布局与绘制。
- 原生详情日志增加 `lookupMs`、`answerHtmlMs`、`questionHtmlMs`，后续真机可以精确区分瓶颈。

## 影响文件

- `src/mnutils-entrance.ts`、`src/plugin.ts`、`src/main.ts`、`src/rails-core.ts`
- `src/mistake-manager.ts`
- `web/src/main.jsx`、`web/src/CardPreview.jsx`、`web/src/ui/controls.css`
- `web/src/lib/reviewDetailCache.js`、`web/src/lib/reviewDetailCache.d.ts`
- 相关测试、版本号、README 与发布说明

## 兼容与数据影响

- 不迁移、不删除错题数据；修订号不写入存储。
- 不改变答案匹配与候选生成规则。
- 自绘快捷菜单被移除；其中的侧边按钮开关、关闭按钮位置仍由插件设置页现有控件提供。

## 验证

- `pnpm check`
- `pnpm test`：175/175
- Playwright 桌面预览：待复习答案展开、110% 缩放、定位后预览持续存在，定位期间无整页加载提示。
- `pnpm build`
- 安装包已复制到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.69.mnaddon`；源文件与副本 SHA-256 均为 `A8C024F23D2D39D0982CFA22C7FF47DDD6921DE0DDC0ED2F505D28EB6BB7DAA0`。

## 未验证限制

- 悬浮球和 UIKit 生命周期只能在 MarginNote 真机验证；本轮没有对应 `.ips` 崩溃堆栈。
- 真实大图、手写与千题数据的耗时需要用本版新增的分段日志继续采样。
