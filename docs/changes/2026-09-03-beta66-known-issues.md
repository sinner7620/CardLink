# beta.66：交接问题根因修复

依据：iCloud 中《错题详情UI重构-后续优化交接.md》和 `todo/todo.md`。
在 beta 工作树实施，保留本轮之前的未提交修改；没有修改 stable 分支。

## 已实现

- 刷新只按卡片现存托管标签收编/同步记录，不再遍历旧元数据回写标签，不再调用整库 `savedb`。
- 删除 beta.12 同名题目自动反向恢复链及其专用辅助函数，避免把标题相同当作身份相同。
- 无托管标签、纯答案范围的旧记录先归档再移出主列表；单条/批量复习也不会借旧记录补回已移除标签。纯答案范围沿用现有绑定模型，兼任合法题目来源的脑图不被一刀切删除。
- 评论列表或其中任何条目不可读时不推断“无标签”，保留记录。原卡缺失时也保留，避免同步间隙丢失历史。
- 悬浮条由 `detail-dock.js` 统一管理 Pointer/Touch 手势，几何算法独立为 `detail-dock-geometry.ts`。按容器与控件真实尺寸限位；ResizeObserver 响应展开、横竖切换、多答案选择器和窗口尺寸变化。拖拽取消清理状态，拖后 click 被拦截，下拉框不启动拖拽。
- 停靠过渡 140ms，折叠/展开先进行工具图标形变；竖向用纯图标减少宽度，增加半透明背景。
- 详情题目、答案、删除、折叠/展开改用真正的 Morphicons 引擎与 Lucide IconNode；定位/收藏沿用现有 Morphicons。删除确认持续红色，定位和折叠增加短暂强调态，SVG 统一 18px。
- 标签取消整条背景，标签 chip 复用列表样式，末尾加号编辑。日期在右上角仅显示文字；等级和天数两侧等宽，简写为 x天/已到期/已结束。
- 点击天数进入待复习对应状态分组并滚动、聚焦到该题；筛选默认折叠；设置全局开关使用电源图标。
- 清除 mistakes/controls 中旧操作条、状态胶囊、标签栏、日期及过时标题按钮规则，归属集中到 `ui/detail.css`，未新增 `!important`。
- 原生面板布局增加几何相等判断：卡片选择触发相同尺寸布局时不再重复赋 frame、重置根滚动；真实尺寸变化仍执行原有布局流程。
- 诊断桥请求增加超时清理，避免丢失的诊断响应永久占用 busy。

## 性能项：仅部分处理，不能标记真机修复完成

- 日志导出继续复用 MarginNote `saveFile → saveFileWithUti`。本次增加防重复调用、生成/写文件/系统保存调用的计时和失败提示，没有另造一套保存器。0.25 秒延后调用原已存在，只能让桥先应答，不能证明系统保存接口自身不卡顿。
- 启动包解析前先用两帧绘制轻量加载文字，启动脚本错误有反馈；新增 `boot.appRendered` 时序。保留现有首页 25 条、同快照分页续传，不恢复全量巨型桥响应。
- 此环境没有 MarginNote/iPad 宿主，不能验证系统文件保存器、JSB 冷启动、选择卡片时宿主的临时 bounds 变化。日志导出缓慢和真机冷启动耗时仍需实机确认，不能宣称全部解决。

## 数据兼容与恢复

主库 key/recordId 不变。清理前的完整记录存入独立键
`mn4-answer-matcher.mistakes.detached-archive.v1`，包含归档时间及复测历史。
先写入并回读核验，失败则不移除；归档不参与自动恢复。
当前无归档恢复 UI，必要时由维护者读取该键人工核对恢复，不应直接合并回主库。
不删除 MarginNote 卡片或其标签。原始交接和 todo 文档未覆盖。

## 主要文件

`src/mistake-manager.ts`、`src/mistake-store.ts`、`src/note-navigation.ts`、
`rails-native/WebPanelController.js`、`web/src/main.jsx`、`web/src/detail-dock*`、
`web/src/ui/{detail,mistakes,controls}.css`、`web/src/lib/mnBridge.js`、
`web/boot.js`、`build.mjs`、`package.json`、README 与相关测试。

## 验证

- `pnpm check` 通过、163 项 Node 测试全部通过、源码构建通过；安装包验证版本、启动脚本和无 `!important`。
- Playwright CLI 使用本地源码预览核对 900×640、460×620；截图位于 `output/playwright/beta66-detail.png`、`beta66-narrow.png`。
- 浏览器验证四边拖动、窄屏多答案操作条不越界，窄屏胶囊两侧均为 56px；点击已到期聚焦到 `questions:q1`。
- 浏览器验证采用 Playwright 技能，未以静态截图代替交互检查；真机触摸和旧 WebView Touch fallback 仍需实测。
- 安装包已复制至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.66.mnaddon`，SHA-256 与构建产物一致。
