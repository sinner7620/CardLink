# WebBridgeCommands.js — 面板命令层与 PDF 管线
## 职责
面板命令 dispatch（closePanel/pdfTaskStatus/pdfTaskCancel 先行，其余进 rails-core）；exportMistakes/previewMistakeExport 的 renderPdf 拦截 → 隐藏 WebView 逐页截图 → JPEG 写入 A4 PDF → 分块回传。PDF 页边距 56pt，任务支持查询与取消。
## 边界
- 导出任务式受理（立即应答 taskId），预览保持原同步行为
- 初始准备按题数设超时；分页/页面完成事件重置 120s 无进展看门狗，传输也按块重置超时
## 验收
大范围导出不超时；取消任务丢弃产物；页边距一致。
## v2.4.7-b1 任务协议
PDF 正式导出在读取题卡前返回 `taskAccepted/taskId`，状态为 preparing → rendering → saving → generated/error/cancelled。generated 表示本地 PDF 已生成且调用了系统保存面板，`saved=false` 不代表用户取消，也不宣称目标位置保存完成。准备过程互斥；取消后旧准备退出前不启动新任务。状态与取消核对传入 ID，过期 ID 不会操作新任务。

预览沿用等待结果的请求，返回快速预览的 previewCount/truncated/missing；有活动导出时拒绝启动预览。图片在准备时保存为 UTF-8 资源脚本，原生复制到本次渲染页目录，以相对脚本回填原始 data URI；图片不经二进制字符串重编码。原生暂存去除逐卡预览脚本后的 HTML；绘制器按页尺寸分段生成画布，优先避开内容块及文字行，溢出的固定题数组也继续分页。写入器嵌入每页 JPEG 原始字节，最终 PDF 仍在内存组装。快速预览最多三题。


## v2.4.7-b11 就绪与图片修复

34% 表示原生已请求隐藏 WebView 检查就绪，尚未进入绘制。只保留 web/pdf-export-runtime.js 一份就绪实现，核心 HTML 和原生不再各注入一份；定时器驱动布局采样，字体最多等待 3 秒、图片 5 秒、布局 6 秒，不依赖 requestAnimationFrame，也不反复把手写 canvas 编成 PNG 做指纹。

图片及手写资源脚本与 html2canvas、JPEG PDF 写入器、导出运行时均复制到本次任务的 `pdf-runtime/<taskId>/`，释放 WebView 后删除该临时任务目录。任一图片未加载或损坏会报告错误并停止，不生成全是失败占位的文件；快速预览缺少页面图时使用 PDF URL，不回退到已失去资源目录的 HTML。

`pdfExportStage` 日志记录 html.staged（资产数和 HTML 长度）、ready.begin、raster.begin、render.error；runtime 的 __MN_PDF_EXPORT_STATE__ 提供当前就绪/绘制阶段及错误，便于区分资源等待与后续画布问题，不包含图片内容。

缓存清理请求由core接收ids与allowRetained；默认仅接受缓存类别，用户明确确认后allowRetained=true可将默认保留的本地文件完整移入回收站。PDF任务活动期间仍拦截清理。

缓存扫描/清理返回受理任务（taskId、operation、status、progress），localCacheTaskStatus读取running/done/error状态；done.result包含groups、removed、failed、skipped、scanIncomplete与failures分类原因；removed表示移入回收站数量，groups含recycle只读分类与recyclePath完整路径，回收站占用仍计入本地总量。任务由core以NSTimer分批运行。清理期间core拒绝新的PDF预览/导出；原生入口原有PDF活动任务拦截保留。

## OCR 数据库（v2.4.7-b28）

`ocrDb*` 沿用现有命令透传至 `rails-core`，由 `ocr-service` 处理；不调用 MN Bridge。接口与数据边界见 [OCR 数据库](../../design/ocr-mistake-library.md)。旧 AI 分析/准备启动及定期调度在原生端拒绝执行；凭据配置保留供 OCR 使用。通用清理始终跳过 `ocr-db/`（含事务日志），不将活动库当作缓存删除。

`ocrDbRenderPreview` 接收 `{ text }` 并返回 `{ html }`，供未保存题干离线预览。插件核心解析 Markdown 和 LaTeX，转义原始 HTML，链接仅显示文字，图片显示占位。此命令不读取或写入 OCR 数据库。

工作台通过 `ocrDbRefreshSources` 按错题记录核对原卡；`ocrDbNext` 在自动模式下仅领取当前授权范围的任务，`ocrDbReleaseCapture` 只释放匹配的截图租约。OCR 设置使用 `ocrGetSettings` / `ocrSaveSettings`，密钥使用 `ocrReadCredential` / `ocrSetCredential` / `ocrClearCredential`。普通设置响应只含掩码，显式读取仅限配置中的两项 OCR 凭据。完整行为见 [错题 OCR 数据库](../../design/ocr-mistake-library.md)。
