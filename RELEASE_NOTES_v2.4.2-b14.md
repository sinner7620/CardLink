# CardLink v2.4.2-b14

## Morphicons 官网图标与五控件对齐

- 复习工具条改用 Morphicons 官网可选的 Lucide `ChevronLeft`、`ChevronRight`、`Info`、`LogOut` IconNode。
- 四枚图标由项目内已有的 `lucide` 数据直接生成 SVG，统一使用 24×24 网格、20 pt 画布和 2 pt 圆角描边；删除旧 SF Symbols 文件、构建复制和 SVG text loader。
- 序号由 15 pt 提升到 18 pt，使用 20 pt 行高、600 字重和等宽数字，与四枚 20 pt 图标共享同一垂直中心。
- 不增加图标形变动画；因此不创建无意义的 Morphicons 动画引擎，点击、悬停、首尾禁用仍由原生按钮负责。

## 生成答案卡片

- 修复确认“生成答案卡片”后提示“所选卡片无效，请重新选择”。原生确认弹窗会关闭卡片菜单并改变选择状态，弹窗前保存的 `NodeNote`/`MbBookNote` JSB 代理可能失效。
- 查找阶段保存稳定的原题 `noteId`；创建阶段按该 ID 从数据库重新读取原题，重新构造 `NodeNote` 和父节点链，再调用官方 `cloneNotesToTopic`。
- 答案卡仍创建在绑定的答案脑图；仍复用唯一同分支，不刷新答案索引。

## 验证限制

- 自动化检查覆盖 Lucide IconNode 渲染、统一网格/尺寸、18 pt 序号，以及生成前按 noteId 重新取得原题和父节点。
- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均已通过；构建仍报告项目既有的 `.sfIconGlyph:svg` CSS 选择器警告，不影响安装包生成。
- 安装包保持正式渠道身份：版本 `2.4.2-b14`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；包内不再包含 `review-symbols` 资源目录。
- 项目产物与 iCloud 交付副本均为 588,387 bytes，SHA-256 均为 `ECDBAEB1C5BEB4893848F47D2D38190EFD1DB15C4578DCCAA7D2840F82AF9FC0`。
- 最终视觉对齐和答案脑图实际复制仍需目标 iPad 真机确认。
