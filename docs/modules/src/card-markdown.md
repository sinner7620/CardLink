# card-markdown.md — 卡片转 Markdown
## 职责
卡片 HTML → Markdown（MD 导出）：手写转 SVG data URI、图片扩展名按文件头识别、实体解码。
## 验收
嵌套列表结构保留；扩展名按魔数而非 MIME。
MathML 含 application/x-tex 注释时，先把整个 math 节点替换为原始 TeX（内联 `$`、块级 `$$`），再执行通用 HTML 转换，避免展示树与注释重复。缺少注释的 MathML 保持原有文本降级，未新增完整 MathML→TeX 转译器。

导出可向 cardHtmlToMarkdown 传入第三个 imageWidth 回调，把已知像素宽度的图片转换为保留等比宽度的 HTML img；普通调用保持原 Markdown 图片语法。错题导出的资产提取同样支持这些 img，并将 src 改为 assets 相对路径，不改变原素材像素。
