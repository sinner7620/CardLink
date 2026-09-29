# 修复已删除原卡片无法取消错题

## 目的与行为

原卡片删除后，取消错题仍要求清除原卡标签，导致记录无法移除。单条和批量取消现在先查询原卡：数据库正常返回空值时直接删除错题记录，不进入学习集标签写入事务。批量操作将这些记录排除在标签写入分组外，避免阻塞同学习集正常卡片；同组现存卡片写入失败也不阻止缺失卡片记录的清理。

现存卡片仍须通过标签清除回读校验；数据库查询抛异常不视为卡片已删除。批量 changed/records 包含成功清理的缺失原卡记录，missing 仍仅统计不存在的错题记录 ID。仅用户主动取消触发此清理，自动同步行为不变。

## 影响范围与兼容性

- `src/mistake-manager.ts`：单条及批量取消入口。
- `tests/mistake-write-behavior.test.ts`：新增四项行为回归，覆盖删除原卡、混合批量、写入失败及读取异常。
- `docs/modules/src/mistake-manager.md`：补充取消契约。

无存储结构迁移或接口字段变动。取消沿用现有记录删除及持久化路径。用户追加要求打包 241b1，按预发布命名规则将 `package.json` 更新为 `2.4.1-beta.1`，新增对应发布说明；保持正式插件身份和 stable 渠道，不进行远端发布。

## 验证

- `pnpm check` 通过。
- `pnpm exec tsx --experimental-test-module-mocks --test tests/mistake-write-behavior.test.ts`：17 项通过。
- 任务文件 `git diff --check` 通过。
- 尚未进行 MarginNote 真机验证；需在设备上删除原卡后分别验证单条取消、混合批量取消和面板计数刷新。运行时正常返回空值沿用项目现有的原卡不可用判断，不能据此区分删除与原生数据库临时返回空值。

## 首次 2.4.1-beta.1 安装包交付（已被下述命名修正替代）

- 最终版本输入的 `pnpm check`、`pnpm test`（237/237）和 `pnpm build` 均通过。
- 构建仍有既有 `.sfIconGlyph:svg` CSS 选择器警告，未在本任务扩展修复。
- 已读取安装包内 `mnaddon.json`，确认版本 `2.4.1-beta.1`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`；配置渠道为 `stable`。
- 原包：`E:\project\MN\dist\CardLink-v2.4.1-beta.1.mnaddon`。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-beta.1.mnaddon`，576,418 bytes。
- 两份文件 SHA-256 相同：`521A4FF00FD7247F88116F06910072476973D8D106CB730E0188C3E0436299CA`。
- 未进行真机验证或远端发布。

## 命名修正与最终交付：2.4.1-b1

用户明确预发布格式为 `x.x.x-bx`。已同步更新 `AGENTS.md`、`docs/workflow.md` 的预发布规则为 `X.Y.Z-bN`，正式版本仍为 `X.Y.Z`；更新 package 版本并将本轮发布说明重命名为 `RELEASE_NOTES_v2.4.1-b1.md`。无业务代码或数据格式变化。

- 针对最终版本重新执行 `pnpm check`、`pnpm test`（237/237）和 `pnpm build`，全部通过；既有 CSS 选择器警告仍存在。
- 已核验安装包 manifest 版本 `2.4.1-b1`、正式 ID 和 `CardLink` 标题，渠道仍为 stable。
- 最终原包：`E:\project\MN\dist\CardLink-v2.4.1-b1.mnaddon`。
- 最终交付：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1-b1.mnaddon`，576,403 bytes；同步文件夹中本轮旧命名的 beta.1 包已移除。
- 原包与交付副本 SHA-256 均为 `FF0CA30BFB45C502AC1C8DBFAEBFA8C74A715520098C2B9839F9FE5C7BF5E293`。
- 规则、发布说明和版本字段已做一致性及差异检查。未进行真机验证或远端发布。
