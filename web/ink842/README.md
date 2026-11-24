# 842 每日测试手写区移植

来源：用户指定的「842 每日测试」网站手写区工作区。
原仓库 HEAD：aa8a182dd38c224731d6b21e497f7483c04a8b51（2026-10-26 读取）。

复制 ink-surface、ink-input、ink-geometry、ink-settings、ink-toolbar、goodnotes-adapter 与 daily.css 中的手写区规则。网站源目录保持不变。

适配：引擎导入复用 CardLink 固定的 GoodNotes-Ink 源码；设置键改为插件命名空间；画布增加原题底图、完整窗口高度和纸张延伸支持；批注数据与旧 InkCanvas 记录的转换在 record.js。原有 Pointer/Touch 路由、手势、局部擦除和绘制/重放逻辑沿用网站。

连续书写恢复：新的 pointerdown/touchstart 会收尾同一身份的残留触点。新 Pencil Pointer 从带压感的移动开始时，尚未配对的原生 Touch 可与它配对。对于已配对的 Touch，原 Pointer 取消或丢失捕获后可以续笔，缺少上一笔结束事件时则另起一笔。

GoodNotes-Ink MIT 许可见 ../vendor/goodnotes-ink/LICENSE；旧轮廓渲染依赖 perfect-freehand 1.2.3（MIT），许可证随安装包 THIRD_PARTY_NOTICES.txt 保留。

窗口界面由 ../plugin-ink.css 独立负责，复用插件语义色。插件调用 fullWindow 时使用实际视口绘制高度，并设置 extendToViewport:false，防止调整原生窗口改变作答纸长度；网站默认行为保留。窗口控件位于 ../plugin-ink-window-controls.js，通过经典 JSB UIView.frame 桥接调整窗口，与纸张缩放分离。

对照本机 842practice 网站源码提交 `6c089d37368ca37270cf7cc7cc45c6405d350b31`，同步套索、形状整理、纸张选项、按路径擦除和渲染缓存。CardLink 答案窗口使用可变换的真实 HTML 底稿，在收起时才生成保存图片。双层画布的笔迹渲染来自 842practice，答案窗口的平移惯性和边界由 CardLink 配置。复习作答使用原题图片底稿。输入路由包含 CardLink 的触点重用恢复逻辑。
