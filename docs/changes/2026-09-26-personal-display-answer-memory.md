# 个性显示设置与多答案记忆

## 目的与行为

- 个性设置新增卡片绑定手写“始终显示 / 双击显示”，旧配置默认双击显示。交互 HTML 直接标记显示模式；始终显示不响应双击隐藏。更改设置后重新读取当前错题详情，原生答案窗口下次查找时应用。
- 个性设置新增错题本列表“始终显示 / 自动隐藏”，默认保留现有布局。自动隐藏模式拉出列表与搜索筛选时，详情同步以右侧中央为锚点等比缩小，与列表保持相邻；收起后恢复全宽。列表最多 340px 且不超过工作区一半。点击外部、Esc 或向左拖动收起；左缘拖出或点击入口展开。拖动无缓动延迟，松手按速度/位置落位；减少动态效果时关闭落位过渡。列表隐藏保留滚动和筛选状态，隐藏内容不可聚焦。触摸捕获交接不作为取消手势，避免从柄内 span 开始拖动时回缩。
- 原生答案窗口成功显示候选时立即持久化，因而关闭或查找其他题目前已保存最后所选答案。按来源学习集 + 原题 noteId 隔离，保存答案学习集、noteId、节点 id；重开优先恢复仍在匹配集合中的候选。候选不排序、不删除，序号仍对应原列表。删除/失配后回退首项；旧选择弹窗晚返回不覆盖新题或重开已关闭窗口。

## 影响范围与兼容

- 设置链路：`src/settings.ts`、`src/rails-core.ts`、`src/plugin.ts`、`web/src/main.jsx`、`web/src/lib/previewBridge.js`。
- 手写预览：`src/bound-handwriting.ts`、`src/card-preview.ts`。不改变卡片内笔迹、静态导出或 AI 手写发送策略。
- 列表浮层：`web/src/MistakeLayout.jsx`、`web/src/ui/mistake-drawer.css`，固定布局保留原 DOM 顺序和样式。
- 候选持久化：`src/answer-preference.ts`、`src/plugin.ts`。增加本机键 `cardlink.answer-choice.v1.<来源学习集>.<原题>`，不修改脑图绑定、卡片内容或错题记录；网页详情、AI 和导出的候选顺序不受影响。
- 更新设置、错题浏览、卡片预览与答案查找文档。新增 `tests/personal-preferences.test.ts`，移除旧原生窗口测试中与“保留其他候选”冲突的隐藏候选断言。
- 本轮仅实现与验证，未主动修改版本、复制安装包或远端发布。工作区原有及并行修改保留；构建时读取到的版本从 2.4.4-b24 变为 2.4.4-b25，本轮未修改 `package.json`。

## 已执行验证

- `pnpm check` 通过。
- 105 项相关测试通过：personal-preferences、card-preview、subcard-matching、bridge-schema、plugin-events、web-render-smoke、ai-input-behavior、web-bridge。覆盖设置缺省/持久化、静态内容不变、候选重排/失效/隔离/关闭重开及异步旧弹窗返回。触摸捕获修正后复跑 Web 渲染冒烟 11 项通过。
- `pnpm build` 通过。保留既有 `.sfIconGlyph:svg` CSS 警告，未扩大本轮修复范围。
- Playwright 实际页面检查通过：600px 窄窗与 1280px 桌面布局；详情全宽；鼠标与 Chromium 触摸模拟直接跟随；外部点击、Esc、纵向手势排除；减少动态效果；分类弹层选择不误收起；真实 iframe 内双击模式切换与始终显示模式不隐藏。截图和复测脚本在 `output/playwright/personal-*`、`output/playwright/check-personal-*.js`。
- 构建页面最终用独立静态服务器检查，避免 Vite 对构建 JS 的缓存导致旧代码参与复测。
- 动效参考 [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) 与 [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/) 的直接操作、连续反馈和可访问性原则；这不是 Apple 平台认证结论。

## 同任务跟进：列表与详情同步缩放

- 修改 `MistakeLayout.jsx` 与 `mistake-drawer.css`：单一 `--drawer-progress` 驱动列表平移与详情等比缩放；同一 RAF 写入进度、同一 CSS 缓动落位。详情保留完整 iframe 和文档，拖动不改布局宽高，避免反复排版。移除详情上的暗色遮罩底色。
- 快速第一步跨出窄拖动入口时立即捕获原事件目标，既不丢失拖动，又保留列表按钮点击；按下时冻结正在进行的落位动画，反向拖动从可见位置继续。触摸取消回到原状态，窗口尺寸变化重算比例并取消旧手势，初次布局/窗口变化先建立相邻姿态再启用过渡。
- Web 构建通过；渲染冒烟与卡片预览测试 21 项通过。Playwright 检查 1280/600/375px 的 20%、45%、75%、100% 拖动进度，列表右缘与详情左缘相接、详情右缘保持固定。快速反向、真实 Chromium 触摸事件模拟、取消及减少动态效果通过。
- 开/关各 30 帧采样：边缘误差最大约 0.000031px；动画中 iframe 视口尺寸不变，跨拖动/反向/窗口缩放后 iframe 节点和 document 均保留，load 次数为 0。证据：`output/playwright/check-drawer-scale.js`、`check-drawer-settling.js`、`drawer-scaled-*.png`。这些是浏览器行为检查，不是 MarginNote 真机帧率保证。

## 未验证限制

未进行 MarginNote 真机验收：iPad WebView 的触摸手感、系统边缘手势竞争、真实绑定手写资源读取、原生答案选择窗口与重启后的本机持久化仍需设备确认。桌面测试与模拟触摸不替代这些验证。
