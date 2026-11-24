# updater.ts — 插件更新

交互更新弹窗和提示均显示 CardLink。GitHub 检查失败回退 Gitee，GitHub 附件失败回退同版本 Gitee 附件；调试下载源需调试模式与对应开关同时开启。

## 更新确认弹窗

- 优先在插件面板内弹窗，复用设置页「答案预览手写批注」提醒同一套 `<dialog class="answerMatchingDialog">` 样式：标题「CardLink <渠道> v<版本>」，正文为当前版本、来源与更新说明，按钮为「取消」「手动安装」「直接安装」。不再加载自建网页。
- **来源窗口在入口捕获**：`checkForUpdates(interactive, owner)` 在开始时固定 owner（场景面板经桥命令 `checkUpdates` 传入 `context.addon`，原生菜单传入自身 addon，定时检查在注册时捕获）。等待联网、判断面板可用性、显示面板、投递提示、超时清理都用这个 owner，不在 await 之后回读全局 `self`，否则已就绪的场景面板会被当成「没有面板」而误退回原生弹窗。
- **推送只当快路径**：`webController.webReady` 为 false（面板网页未加载完）时 `evaluateJavaScript` 会失败，原生只把提示挂到 `pendingUpdatePrompt`，面板在启动完成与每次重新显示时主动拉取；面板网页就绪时再额外推一条 `window.__cardLinkUpdatePrompt(payload)` 以即时显示。场景面板经 `__MNAM_SCENE_WORKBENCH_GLOBAL__.notify(owner, "updatePrompt", payload)` 转发到同一钩子。
- **提示身份**：每条提示带 `promptId`，随推送、拉取结果、关闭信号与 `updateChoice` 选择回传。带身份的选择只能结束同一条提示，旧弹窗、旧计时器或另一个窗口的旧请求不能确认、替换或关闭新提示；不带身份的旧面板选择沿用原行为。超时关闭只投递 `{ promptId, close: true }`，不推 `null`。
- 是否退回原生弹窗只看有没有面板承载：存在 owner 的 `webController` 或场景面板可用就等待面板，不再因为一次推送失败就换样式；两者都没有才用 marginnote 原生弹窗。面板存在但确实无法显示（`__MNAM_WEB_PANEL_GLOBAL__.isVisible` 报告隐藏、场景面板收起）时先有界等待 30 秒，仍不可显示才清掉待处理提示并改用原生弹窗，避免空等 180 秒。
- `SceneWorkbench.notify` 对空数据补 `{}`，但显式 `null` 原样投递；面板侧 `normalizeUpdatePrompt` 只把带版本的载荷视为要显示的提示，关闭信号、`null` 与缺少版本的载荷都按关闭处理（且只关闭同一 `promptId`），避免超时后出现空壳弹窗。
- 用户在面板里的选择通过桥命令 `updateChoice`（`{ choice, promptId }`）回到原生（`resolveUpdateChoice`）；提示等待 180 秒，超时按「稍后」处理、清空待处理提示并投递关闭信号。运行时日志记录 `prompt.pending`（含 `panel`/`shown`/`scene`/`ready`/`visible`/`reachable`）、`prompt.deferred`、`prompt.choice`、`prompt.timeout`、`prompt.fallback`。

更新说明来自更新源的 Release `body`。载荷里同时保留两套表示：`notes` 是纯文本摘要（去掉 HTML、标题井号、加粗标记、表格分隔行，保留列表与链接文字，**超过 900 字截断并加省略号**，无说明时为「暂无更新说明」），`notesMarkdown` 是 Release 原 Markdown（只做换行归一与空正文判断，**不按长度截断**，900 字上限只作用于纯文本 `notes`）。调试通道的说明由站点按构建信息生成，因此通常只有构建包名、发布时间、Git 提交与 SHA-256 几行。

官网调试源发来的默认构建说明在面板中显示为 Markdown 表格，包含文件名、大小、UTC 发布时间、Git 提交和 SHA-256。其他正文按源格式渲染，系统弹窗继续使用纯文本。

Classic 面板与 MN5 场景面板共用同一个更新确认弹窗，说明区优先渲染 `notesMarkdown`，由专用组件 `web/src/components/UpdatePromptMarkdown.jsx` 处理，而不是复用 AI 回答的 `Response`：只用 react-markdown 10 + remark-gfm 4 渲染基础 GFM（标题、段落、加粗/斜体、项目与编号列表、行内码与代码块、引用、表格、链接），**不经过 AI 数学预处理**，也不带 `card:`/`stat:` 引用按钮语义。正文在弹窗内滚动，表格包 `.mdTableScroll` 横向滚动、代码块自身滚动，按钮位置不变。

安全边界（外部内容）：

- `skipHtml`：原始 HTML 节点直接丢弃，既不产生元素也不显示为转义文本；不使用 `dangerouslySetInnerHTML`，不引入 `rehype-raw`。
- 链接只接受能用 `new URL` 解析、协议为 http:/https: 且有主机名的绝对地址；协议相对（`//host`）、普通相对路径、`mailto:`、`tel:`、`card:`、`stat:`、`javascript:`、`data:` 与无效值一律只显示文字——不生成 `href`，也没有 `role`/`tabIndex` 等伪按钮语义。安全外链用 `target="_blank" rel="noopener noreferrer nofollow"`（项目没有可复用的 Web 侧外链宿主通道，未新增宿主命令，也未让更新 WebView 同帧导航；设备上的实际打开行为待验证）。
- 图片不产生 `<img>`：只显示 alt 文字（缺省用地址），因此不会发起任何资源请求。

旧原生版本或原生系统弹窗只带 `notes` 时，面板回退为纯文本说明；两者都为空才显示「暂无更新说明」。原生 `popup` 兜底始终只用纯文本 `notes`，不看 Markdown。

## 安装方式

检查更新与直链安装均提供「直接安装」「手动安装」，另可取消。直接安装调用 update-installer：校验正式身份、递增版本和必要文件，解压后备份旧目录并替换，失败尝试恢复；成功提示完整退出并重启 MarginNote。手动安装沿用 saveFile(path, "public.data") 打开系统保存面板，用户保存后自行导入，不替换插件目录。两种方式沿用绑定备份。

安装成功只表示磁盘文件替换完成，不等于运行代码更新。查看更新状态分别读取编译运行版本和磁盘清单。在线检查使用两者中较新版本去重；已安装但未重启时提示重启，不重复下载同一或更旧版本。手动保存不依赖安装目录可读。

## 自动安装

设置 debugAutoInstallUpdatesEnabled 默认 false，仅在 debugModeEnabled 同时开启时生效。退出调试模式时清除；重新开启调试模式不恢复旧开关。调试下载源与自动安装相互独立：前者决定来源，后者决定后台检查发现新版时是否下载并直接安装。

开关只保存设置，不触发检查、下载或安装，也不重置节流；后续自动检查沿用激活和回到前台的延迟检查与 12 小时节流，不新增常驻轮询。后台检查默认只提醒，开启自动安装后不弹模态确认框；下载结束时再次检查调试模式、开关和磁盘版本，已关闭或已安装则跳过替换。已发出的网络请求不会撤回。检查成功写入节流，后续下载或安装失败不会清除该时间；可使用「检查插件更新」手动重试，仍由用户选择直接或手动安装。

更新任务互斥；桥接检查更新使用 5 分钟有界超时，开关操作使用普通请求超时，以容纳用户选择和双源下载。自动安装失败在调试开关仍开启时提示，安装恢复结果及恢复失败时的备份位置保留在提示中。

## 面板可见性与有界回退

`requestUpdateChoice` 先 `showPluginPanel(owner)` 把来源窗口的面板带到前台，再判断提示是否可达：没有 `webController` 也没有场景会话时才立即改用原生弹窗；面板存在但 `__MNAM_WEB_PANEL_GLOBAL__.isVisible` 报告隐藏（隐藏的经典面板、收起的场景面板）或网页尚未就绪时，仍先把提示挂起并按面板承载等待——面板启动或重新显示时会拉取 `pendingUpdatePrompt`。为了避免"以为送出去了、其实用户看不到"而空等满 180 秒，不可达时最多等 30 秒（`UPDATE_PROMPT_UNREACHABLE_SECONDS`）；到点仍不可达就清空待处理提示、投递带 `promptId` 的关闭信号并改用原生弹窗，因此面板稍后就绪也不会重复弹一次。宿主没有提供 `isVisible` 时不据此回退，避免误判成"没有面板"。`prompt.pending` 记录 `panel/shown/scene/ready/visible/reachable`，另记 `prompt.deferred` 与 `prompt.fallback`。
## 验证边界

相关行为测试覆盖两种安装、取消、源回退、下载校验、节流、开关持久化/退出清除、下载中关闭、失败恢复、重复安装抑制和运行/磁盘版本区分，以及场景/经典面板按来源 owner 投递（联网期间全局 `self` 指向别的窗口）、面板网页未就绪时由面板拉取、真正无面板时回退、过期计时器与新提示身份隔离、超时关闭信号。mock 不证明宿主权限、保存面板、压缩包解压或重启加载。当前仍直接替换运行目录，重启前新建网页面板可能读取新版资源，未保证当前会话资源隔离。
