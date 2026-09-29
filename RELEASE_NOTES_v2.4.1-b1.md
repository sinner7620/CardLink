# CardLink v2.4.1-b1

## 更新说明

- 修复原卡片删除后无法取消错题的问题，支持单条和批量取消。
- 批量取消时，已删除原卡片的记录不再阻塞同学习集其他错题；现存卡片标签清除失败时仍保留对应记录。

## 兼容性与限制

- 无存储结构迁移，沿用现有错题记录格式。
- 使用 `stable` 渠道、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。
- 尚未完成 MarginNote 真机验证，需复验删除原卡后的取消操作及面板计数刷新。

## 验证与交付

- 类型检查、237 项测试及构建通过；构建有既有 `.sfIconGlyph:svg` 选择器警告。
- 安装包已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b1.mnaddon`，包内版本和正式插件身份已核验。
- 安装包与 dist 原包 SHA-256 一致：`FF0CA30BFB45C502AC1C8DBFAEBFA8C74A715520098C2B9839F9FE5C7BF5E293`。
