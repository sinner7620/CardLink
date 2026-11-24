# web/src/ui — 页面样式所有权

## 职责

- `tokens.css`：设计令牌兼容别名和跨上下文层级锚点，必须最先导入。
- `controls.css`：跨页面控件及确需共享的组合选择器。
- `shell.css`：根页面、顶栏、导航、加载和错误状态。
- `overview.css`：总览、统计、进度和来源分布。
- `mistakes.css`：错题筛选、列表和批量操作。
- `detail.css`：详情标题/标签/等级布局与悬浮操作条。
- `review.css`：复习队列、题目/答案预览、结果和历史。
- `export.css`：导出配置、预览和提交状态。
- `settings.css`：设置、迁移确认和联通测试。
- 最后加载`detail.css`；不恢复历史`a11y.css`覆盖层。

## 边界

新增页面规则进入对应所有权文件并优先带页面根作用域；禁止重新建立 `panel.css`、`panel-preview.css` 一类跨代覆盖层。共享规则只有被多个页面真实复用时才进入 `controls.css`。

## 阶段一至四结果

旧两层样式已退出源码入口并删除。阶段二上下半程已在所有权模块内部清除无现役 DOM、完全重复声明和同选择器/同上下文中被后值覆盖的声明，并用 `mn-ui-base / mn-ui-priority` 两个显式 cascade layer 替代历史声明级 `!important`；源码和生产 CSS 均保持 0 处 `!important`。后续新增退役选择器时同步维护并执行 `scripts/dedupe-ui-css.mjs`，不得重新引入声明级强制覆盖。阶段四已删除 DOM 补丁层和预览归档，面板 DOM 只允许 React 管理，不再通过全局 MutationObserver、`insertAdjacentHTML` 或跨文件追加覆盖实现控件。


## OCR 管理页按钮尺寸（b38）

`ocr-database.css` 在 `.ocrReference` 内统一普通文字操作、返回、筛选、页签和弹窗关闭为 34px 高；普通按钮统一 12px 字号和两侧 12px 内边距，旧 btn-sm 标记不再降低尺寸。弹窗操作区宽屏同组按钮均至少 100px 宽，窄屏按两列等宽排列，单按钮靠右；题目点击行统一 60px 高，避免首行和分隔线导致差异。密钥图标按钮固定 38×38px、输入框内清空 28×28px、开关 46×28px；表单选择器与单行输入统一 38px。不同用途的控件保留各自尺寸，不把开关或整行入口当作普通操作按钮。

## Harness AI 界面

Harness 的三个 AI 界面不进入上方历史所有权文件，而是自成一套「shadcn 工具类 + 少量布局 CSS」的体系：

- `harness-tw.css`：Tailwind v4 入口，只引 theme/utilities（不引 preflight，避免重置整站控件），并在 `mn-ui-base` 层补一段**作用域限于 `.harness-ui`** 的最小 preflight（border 归零并给 `--border` 默认色、button/input 去 UA 外观、标题与列表去默认外边距），解决插件页面无 preflight 时 shadcn 组件出现双层黑边的问题。令牌定义在 `.harness-ui` 上，`@theme inline` 映射成 `--color-*`。
- `agent-panel.css` / `agent-settings.css`：只写布局、滚动、窄屏重排与自有小组件（会话项、建议胶囊、报告指标、状态色），**不再**声明组件级字号/边框/内边距，避免与 Tailwind 工具类形成双轨覆盖（b16 的 `--accent`/字体覆盖事故根因）。
- 组件外观一律交给 `web/src/components/ui/*`（shadcn registry 复制）与 `web/src/components/ai/*`（AI Elements 裁剪版）；新增视觉规则优先写成工具类。

层序固定为 `theme, components, mn-ui-base, utilities, mn-ui-priority`：插件基线（`mn-ui-base`）低于工具类，`mn-ui-priority` 仍是插件显式优先覆盖层。`.harness-ui` 之外的插件页面不受 Harness 样式与重置影响。

### AI 分析组件用法

- `harness-tw.css` 将全局 4 px 间距单位接入工具类，使用 assistant-ui 默认模板的中性配色与圆角。模板动画由 `tw-animate-css` 和 `tw-shimmer` 提供。开发入口直接加载此样式，安装包入口加载单独编译的 `harness-ui.css`。页面和浮层共用语义色，分析中断使用 `warning`。
- **Do** 用 `Button` 执行发送、续答、侧栏切换等操作，用下拉单选组切换审核档位，用折叠面板展示按需查看的工具记录，用 `Alert` 承载异常或中断原因。
- **Don't** 用会话图标充当无操作的按钮，或在消息区和输入区重复展示同一中断原因。续答按钮与原因相邻，无正文时也应可操作。
- 上下文栏显示估算输入和输入预算，另显示可用的本轮用量与压缩次数。低频说明放在对应交互内，审核说明放在审核档位菜单和确认弹窗。
