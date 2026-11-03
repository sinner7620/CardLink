# 842 每日测试手写区移植

来源：用户指定的「842 每日测试」网站手写区工作区。
原仓库 HEAD：aa8a182dd38c224731d6b21e497f7483c04a8b51（2026-10-26 读取）。

复制 ink-surface、ink-input、ink-geometry、ink-settings、ink-toolbar、goodnotes-adapter 与 daily.css 中的手写区规则。网站源目录保持不变。

适配：引擎导入复用 CardLink 固定的 GoodNotes-Ink 源码；设置键改为插件命名空间；画布增加原题底图、完整窗口高度和纸张延伸支持；批注数据与旧 InkCanvas 记录的转换在 record.js。原有 Pointer/Touch 路由、手势、局部擦除和绘制/重放逻辑沿用网站。

连续书写恢复：在原站路由基础上，新的 pointerdown/touchstart 会收尾同一身份的残留触点；匹配到已经关联 Pointer 的旧 Touch 时，新的落笔不会复用旧笔画。Touch-first 的尚未配对触点仍可正常与 Pointer 合并，保留高频采样。此差异覆盖 WebView 漏报结束后复用触点身份的情况；原网站目录没有修改。

GoodNotes-Ink MIT 许可见 ../vendor/goodnotes-ink/LICENSE；旧轮廓渲染依赖 perfect-freehand 1.2.3（MIT），许可证随安装包 THIRD_PARTY_NOTICES.txt 保留。

窗口界面由 ../plugin-ink.css 独立负责，复用插件语义色。插件调用 fullWindow 时使用实际视口绘制高度，并设置 extendToViewport:false，防止调整原生窗口改变作答纸长度；网站默认行为保留。窗口控件位于 ../plugin-ink-window-controls.js，通过经典 JSB UIView.frame 桥接调整窗口，与纸张缩放分离。
