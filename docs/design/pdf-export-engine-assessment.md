# 错题 PDF 导出核查与优化方案

日期：2026-11-09。状态：b57 已实现下述短期路径；原始分析保留，当前实现与限制见末尾。

## 核查范围

当前工作区 package.json 是 2.4.7-b50，且有大量已有改动。另直接只读检查了本地 dist/CardLink-v2.4.7-b24.mnaddon（ZIP 内 mnaddon.json 确认版本及正式 ID），核对 WebBridgeCommands.js、AnswerMatcherCore.js、web-dist/app.js 和 pdf-export-runtime.js。下面把产物确认与当前源码定位结合使用，不把 b50 源码冒充 b24 源码。未连接设备、未使用 MN Bridge，未复现真机卡顿或测量峰值内存。

## 结论与证据

| 用户提出的问题 | 判定 | 证据和限定 |
| --- | --- | --- |
| 长答案节点重复截图成本高 | 属实，b24 产物与当前实现均存在 | runtime 的 renderNodeToPdf 对 tiles 循环，始终传入同一个 node；buildMistakePdfHtml 仍生成 pdf-answer-flow / pdf-compact-flow。固定题数模式已有 pdf-page，不能说所有模式全是单一长节点。 |
| 42% 表明渲染卡死 | 只能确认进度盲区，不能确认具体死因 | beginPdfFileGeneration 固定设 42，直到 pdfDataReady 才改为 68；区间覆盖截图、JPEG 编码、jsPDF 序列化和 Base64 转换。长耗时、资源等待、内存压力都可能表现相同。 |
| 一次准备全部内容 | 核心问题属实，但已有让路和资源暂存 | selectedDetails 每四题让路并检查取消，仍累计完整 details；随后组装完整 HTML。媒体已按 ID 去重复用暂存脚本，但脚本最终将图片装入整份文档，未形成有界渲染窗口。 |
| 完全没有任务机制 | 不属实 | b24 已提前返回 taskId，有 preparing/rendering/saving 状态、轮询、互斥与取消。应扩展现有协议。 |
| 进度全是假百分比 | 部分属实 | 准备按 prepared/total、传输按块数推进；渲染区间没有逐页推进。 |
| 答案没有去重 | 不属实 | b24 核心包已对匹配结果去重并记录 raw/unique；当前 distinctAnswers 按 noteId（回退 id）去重，并排除原题。仍需核实具体错误匹配案例，不能据此一律只取一个答案。 |
| jsPDF 逐页追加即可恒定内存 | 不属实 | 已经逐页 addImage；jsPDF 仍保留内容，output 最终构造完整文件。源码依赖是 jsPDF 3.0.3。 |
| PDF 输出有大对象复制 | 属实 | output(arraybuffer) → 整份 Base64 → chunks 数组 → join → binary string → NSData。分块桥接不等于流式文件输出。 |
| 导出时筛选仍能修改 | 属实 | 设置控件没有统一禁用；请求携带的 recordIds/选项已经固定，后续 UI 修改通常不会改变已发请求，但会让题数、预览和设置显示偏离任务。 |
| 已有取消就能立即停掉截图 | 不成立 | 原生取消释放 WebView/请求；渲染循环无逐页取消检查。同步克隆/编码期间不能承诺立即中断；释放对象也不能证明宿主进程立即回收全部内存。 |

当前定位：src/mistake-export.ts（selectedDetails、pdfAssetStager、buildMistakePdfHtml）、src/mistake-manager.ts（答案解析）、src/domain.ts（distinctAnswers）、web/pdf-export-runtime.js、rails-native/WebBridgeCommands.js、web/src/main.jsx（MistakeExport）。

html2canvas 1.4.1 的 DocumentCloner 从 element.ownerDocument.documentElement 克隆，再解析目标子树。x/y/height 仅限制输出区域；onclone 在克隆后执行，不能消除前面的克隆成本。因此只改调用参数为 pageElement、却将全部页面留在同一文档，仍不够。必须让截图所属 document 只包含当前页及必要样式/资源。

## 推荐架构

沿用既有 taskId 和轮询入口，扩展为：受理快照 → 分批准备并暂存 → 有界测量并保存分页计划 → 单页渲染和追加 → 序列化/传输/校验 → 打开保存面板 → 释放任务资源。

### 1. 任务与不可变快照

- 受理时复制 recordIds（保持顺序）、筛选摘要、导出选项和文件名；状态和进度始终显示快照值。
- 开始即锁定筛选、排序、包含内容、答案位置、版式和文件名；停止按钮独立保留。失败、取消、生成完成后解锁；重新进入页面从 taskId 恢复快照。
- 将模块级 exportCancelled/preparationProgress 迁移到任务上下文，避免旧任务回调或新任务重置影响彼此。
- 所有异步消息带 taskId、阶段和序号，旧任务回调不得覆盖当前任务；取消必须结算等待中的 Promise。
- 配置快照不等于宿主数据库事务快照。准备时冻结每题的答案 ID、内容及资源引用到任务目录；准备后不重新实时匹配。准备期间源卡发生变化的处理需明示，不能声称宿主提供原子快照。

### 2. 分批准备与资源生命周期

- 候选 ID 列表可以保留；完整正文和解码图片不可全量驻留。按题串行读取、小批落盘，保留轻量 manifest 与游标，消费完成后释放本批字符串。
- 暂存结构保存 recordId、question/answer block、答案 ID 列表、媒体引用、尺寸、布局语义、缺失原因；避免为得到结构化内容新增全学习集扫描。
- 复用现有按 noteId 去重逻辑。资源共享不删除不同题目中合法重复出现的答案；不同答案卡也不能按题号/标题合并。
- 如增加缓存，限定任务生命周期和容量；键包含学习集/卡片身份、内容版本或冻结快照、手写/评论选项及影响 HTML 的题目上下文。先缓存稳定资源，避免复用带题目标题的错误 HTML。
- 当前图片使用全批最大宽度统一缩放。分页改造必须保留这一契约：准备阶段收集轻量尺寸统计，锁定缩放基准后再测量；不得随批次变化导致重排或比例不一致。
- 任务目录统一管理资源脚本、页面计划和临时产物；成功、失败、取消都走 finally 清理，保存面板仍使用的文件延后回收。

### 3. 有界分页

- 测量文档只装载当前题/当前内容块及有限续页数据。分页计划落盘，内存保留当前页和至多一页前瞻；不能先建立全部页面 DOM 再逐页截图。
- 先完成测量得到准确总页数，再按计划逐页重建渲染；准备/测量阶段显示实际完成题数，不伪装成已知页数进度。
- 固定页面宽度、边距、字体和资源尺寸；测量与正式渲染使用相同 CSS、缩放与字体就绪条件。
- 段落按可分割行边界续页，标题与后续首段保持相邻；公式、图片及底图+手写叠加作为不可拆单元。超高图片整体等比缩放；超高可拆文本按行续页，不能靠 CSS break-inside 保证截图分页。
- 对超过页高的不可拆单元明确缩放下限，不能在达到下限后静默截断；记录具体题号并报告无法排版。
- 支持自动、一/二/三题布局、答案紧随/集中、仅题/仅答案及手写/评论。固定题数的超长内容转续页并标明延续，保持编号和答案归属。
- 对单个极大答案进一步按内容块读取/测量，避免把“全书长 DOM”换成“单题无限长 DOM”。

### 4. 单页截图和写入

- 截图专用 document 只含当前页，等待该页图片解码、字体、公式（如有异步排版）和手写绘制完成；不要只等待全局图片事件。
- html2canvas 并发固定为 1。每页开始、资源完成、截图返回、追加前后均检查取消；页间主动让出事件循环。单次同步截图/编码不可抢占，说明取消延迟受当前调用影响。
- 移除当前内容 canvas → slice canvas → 整页 canvas 的重复路径；直接按页生成，或将单页图按正确宽高比放入 A4 内容区。不得把不足一页的截图拉伸铺满 A4。
- 以 scale=2、JPEG 0.88–0.92 作为实验起点，不直接定为质量承诺；用小字号、细线、公式与手写对照决定。现状是 scale=2.5–3、JPEG 0.97。减少 scale 对像素内存的收益近似按平方计算，不能将其等同总内存降幅。
- finally 释放 canvas、当前页节点、事件监听和资源引用；正式导出不保留预览页串。分页计划/输出计数校验失败时不打开保存面板。

### 5. 输出内存：分开交付

第一阶段保留 jsPDF，优先消除整书 DOM、全量解码图片及多余画布。必须明确：输出总量仍影响内存，不能宣称任意规模稳定。

第二阶段处理输出链路：验证实际 MN4 JSB 文件追加能力后，采用可确认顺序的块写入协议，逐块解码写入临时文件，ACK 后释放块；移除 chunks.join 和整份 binary string。Web 端从 ArrayBuffer 分段编码，避免同时保留整份 Base64。需实测缓冲区、桥接编码、文件追加和错误回收，不能凭 Foundation 类名推断可用。

该方案仍不能消除 jsPDF 自身的整份序列化。真正限制总内存需要文件型 PDF writer 或已证实可用的原生生成/合并链路。只有测得第一阶段输出峰值仍不达标时，才推进该替换；不将 addImage 或 Blob 描述成流式写盘。

### 6. 进度、诊断和校验

- 状态字段：stage、preparedRecords/totalRecords、plannedRecords、renderedPages/totalPages、transferredBytes/totalBytes、currentRecordId/currentPage、lastCompletedAt、error。
- 展示阶段与实际分子/分母。整体百分比可使用明确的阶段权重，但它是工作量估算，不是耗时预测。分页总数未知时显示题数；序列化没有可观测内部进度时显示阶段名称而非自动涨百分比。
- 每页记录 DOM 数量、图片数/像素规模、资源等待、布局、截图、编码、追加耗时及累计输出量；42% 下钻为具体停滞阶段。桌面记录与真机内存数据分别报告。
- 看门狗依据页面/块完成信号判断无进展，保留明确阶段上限；不能靠无限延长总超时掩盖问题。心跳本身不代表工作完成。
- 图片或手写失败提供题号/资源定位，禁止静默输出空白答案。可恢复的资源加载失败有限重试，确保同一页不会重复追加；渲染器致命错误结束任务并清理。
- 校验传输长度、实际字节数、非零页数与计划一致、PDF 基本结构及桌面解析器可打开性；检查签名或文件大小本身不等于完整性验证。
- 明确区分“PDF 已生成”“已打开系统保存面板”和“用户已保存”；没有宿主完成回调就不声称已保存。

## 原生 PDF 分支

Apple 官方 createPDF 文档确认 iOS/iPadOS 14+ API，可异步返回网页内容 PDF Data。但这不证明 MN4 暴露 WKWebView、WKPDFConfiguration、对应 selector/回调，以及 PDF 合并/文件写入能力。当前代码用 UIWebView 包装，不能按类名猜测其实现。

最小原型必须在插件自身执行，通过插件日志及用户设备反馈核查：类/方法可达性 → 单页返回有效 NSData → 两页 A4 的尺寸与合并 → 中文/公式/透明图片/手写叠加 → 文件落盘和保存 → 取消和资源释放。不要依赖 MN Bridge 或 MN5 REST 路由。未通过这些门槛前不改生产路径。

createPDF 返回 Data 本身也不是文件流；长网页不能假定自动得到理想 A4 分页，合并也可能重新累计内存。可搜索文本仅适用于保留文本语义的内容，图片题干与 canvas 手写不会自动变成可搜索文字。

## 开发顺序与验收

1. P0：扩展现有任务观测和快照；构建有界准备/测量、独立页渲染，联合交付逐页进度和取消。任务生命周期不能推迟到渲染改造之后才补。
2. P1：按实际峰值优化画布、编码、传输；再决定是否引入文件型 writer。答案缓存只针对测得的重复开销，匹配语义错误依据案例单独修复。
3. P2：原生 PDF 最小原型通过 MN4 设备验证后，另行决定后端替换。

测试矩阵包括 1/10/100/300 题（合成压力规模，非产品上限）、高分辨率图片、长答案、重复答案节点与合法多答案、跨页公式/段落/手写、四种版式、两种答案位置、缺失资源及仅答案导出。

行为验收：内容顺序/题号/合法答案不丢不重；测量和输出页数一致；同一题在不同批次大小下版式一致；截图 document 始终只有当前页；资源/DOM/画布驻留不随总页数累积（jsPDF 输出缓冲单独统计）；各阶段取消后无新保存面板、无旧任务回写，新任务可启动。

性能验收：记录同设备同样本的总耗时、逐页耗时及峰值内存；分别报告渲染工作集与完整输出峰值。性能目标由基线实测确定，不在无设备数据时承诺“根治”或任意题量。首轮重点验证末页截图成本不再随整书 DOM 规模增加。

实现后复用并扩展 tests/mistake-export.test.ts、tests/export-reliability.test.ts、tests/pdf-readiness.test.ts，增加真实浏览器分页/内容完整性检查和 PDF 解析验证；随后 pnpm check。交付安装包时按项目规则运行相关行为测试与 pnpm build、使用新版本并复制安装包。此轮仅分析与方案，不构建、不发版。

## 外部资料与限制

- [html2canvas 1.4.1 入口源码](https://github.com/niklasvh/html2canvas/blob/v1.4.1/src/index.ts) 与 [DocumentCloner](https://github.com/niklasvh/html2canvas/blob/v1.4.1/src/dom/document-cloner.ts)：已核对克隆根、解析顺序和 onclone 时机。
- jsPDF 3.0.3 本地依赖 dist/jspdf.es.js：已核对 buildDocument 和 output(arraybuffer)，结论对应项目安装版本。
- [Apple createPDF](https://developer.apple.com/documentation/webkit/wkwebview/createpdf(configuration:completionhandler:))：通过官方 Markdown 内容确认版本、Data 返回与回调语义。
- [MarginNote 经典 JSB 文档](https://mn-docs.museday.top/reference/global/jsb/) 与 [桥接边界](https://mn-docs.museday.top/reference/black-box/)：已查看，但未获得足以证明 MN4 createPDF 可达的版本匹配契约。
- [开发文档索引](https://dev.marginnote.com.cn/llms.txt) 与 [简介](https://dev.marginnote.com.cn/zh/introduction.md)：浏览工具获取失败后通过 PowerShell HTTPS 成功读取；简介明确 MN5 场景插件与 MN3/MN4 经典插件的区分，不作为 MN4 新 API 的支持证明。
- [MN Utils 作者帖](https://bbs.marginnote.com.cn/t/topic/49699) 指向 [更新文档](https://mnaddon.craft.me/utils) 和 [API 文档](https://mnaddon.craft.me/mnapi)；前者访问失败，后者仅返回 JavaScript 壳，未取得原生 PDF 契约。此处是不确定性，不是“不支持”的结论。


## b57 实施结果

在当时工作区 b56 上完成：逐题暂存和轻量清单、全任务图片倍率、两轮有界分页、隔离 document 单页截图、公式 HTML 化、本地字体、逐页进度、冻结/恢复配置、准备上下文取消、截图后取消检查、临时目录清理、按块 Base64 编码及原生逐块解码。沿用原有答案身份去重，没有增加全文匹配扫描或跨任务答案 HTML 缓存。

分页计划不存全部页面 HTML：第一轮只计数，第二轮重建并校验页数一致；活动 DOM 包含当前题及其续页，截图时尾部脱离 document。单题极大正文仍是上界，未实现跨块读取单题原始 HTML。输出端仍需 jsPDF 的完整 ArrayBuffer、原生二进制串和 NSData；文件追加 API 尚未得到版本匹配依据，未接入未验证的原生 PDF/文件流能力。

桌面验证覆盖中文、公式、底图叠加手写、长答案、多版式、丢失资源、截图中取消和迟到传输。100 题真实 html2canvas/jsPDF 输出 67 页、28160638 字节；300 题压力检查使用真实准备/布局和截图替身，输出 193 页，不作为截图质量或真机内存证据。两者截图 document 最大节点数均为 148。11 页样本经 pypdf 解析，页面均为 A4，Poppler 渲染抽查首/中/末页。尚无 MN4 真机峰值内存、耗时、离屏 iframe/字体加载与系统保存面板验收。
