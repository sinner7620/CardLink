# markdown.ts — Markdown 渲染
## 职责
renderMarkdown：MD → HTML（插件内使用）；传入媒体解析器时，将 `marginnote4app://markdownimg/<格式>/<资源哈希>` 图片解析为带媒体 ID 的内嵌图片。

hasUnsupportedMarginNoteUrl：区分受支持的 Markdown 图片语法与其他 MarginNote 应用内 URL，供卡片评论过滤使用。
