# card-html.ts — 答案卡 HTML
## 职责
答题卡/答案 HTML 渲染：摘录图、手写 canvas（渲染脚本注入）、LinkNote 与 MN4 链接笔记解析（safe-note）、双指缩放脚本（锚定策略与面板一致）、暗色适配。
## 边界
- 脚本运行在卡片 webview 自身文档，无法与面板共享模块
- 仅隐藏由空格或制表符分隔的纯 `#标签` TextNote 评论；Markdown 标题、多行正文及 HtmlNote 保留。safe-note 使用同一规则读取标签与文字内容。
## 验收
图片+手写叠加、纯手写、纯文本三形态正确。
