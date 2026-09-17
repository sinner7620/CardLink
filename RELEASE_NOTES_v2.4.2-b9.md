# CardLink v2.4.2-b9

## 修正

- 修复 2.4.2-b8 点击“复习模式”后立即无响应的问题。运行日志显示工具条在解析内联图标时访问了未导出的 `NSData` 模块值，本版彻底移除该 Base64 解码路径。
- 四个 SF Symbols PNG 现在作为独立资源随插件包发布；优先使用 AddonLib/MNUtils 的 `MNUtil.getImage(path, 2)`，MNUtils 不可用时使用相同的 MarginNote JSB 全局 API `NSData.dataWithContentsOfFile` 与 `UIImage.imageWithDataScale`。
- 图标读取增加隔离保护：MNUtils 缺失、文件损坏或单个图标加载失败不再阻断复习模式启动。
- 保留 b8 的复习工具条交互、首尾禁用状态、错题信息面板与同脑图/跨脑图定位分流。

## 验证与限制

- `pnpm check`、完整自动化测试（272/272）和 `pnpm build` 均通过。
- 已核验正式插件 ID、标题、b9 版本及四个包内图标资源；项目产物与 iCloud 交付副本 SHA-256 均为 `01076cb5c3b1e947e243647a647df01e3cc8417fc64bebf06bd5b3fa09557a6a`。
- MarginNote 原生工具条及设备侧聚焦行为仍需在安装 b9 后真机确认；自动化环境不能模拟 MarginNote 的 JSB/UIKit 宿主。
