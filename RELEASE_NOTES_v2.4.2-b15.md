# CardLink v2.4.2-b15

## 答案卡片定向创建修复

- 修复同一学习集内题目脑图与答案脑图共享 notebook ID 时，新卡可能停留在题目脑图或学习集根层的问题。
- 生成答案不再克隆原题，也不再依赖确认弹窗前保存的原生题目对象；改用官方 `createNoteWithTitleTopicid` 在绑定答案学习集创建一张同名空卡。
- 具体答案脑图绑定存在时，直接按保存的 `rootNodeId` 获取答案根节点，并优先通过 AddonLib/MNUtils 的 `MNNote.addAsChildNote` 将新卡挂入目标脑图；AddonLib 不存在时对宿主 `MbBookNote.addChild` 做能力探测后降级。
- 父节点只在绑定答案范围内复用唯一同分支；没有对应父节点时，在答案学习集创建同名直接父节点并先挂到答案根，再挂答案卡。
- 每次挂载都重新读取 `parentNote`，最终还会按绑定脑图范围校验新卡。任一步未落入答案脑图即回滚本次新建卡片并显示明确错误，不再误报“所选卡片无效”。
- 不刷新答案索引；成功后直接打开新答案卡片编辑器。

## 验证限制

- `pnpm check`、`pnpm test`（272/272）和 `pnpm build` 均通过；构建仅保留既有 `.sfIconGlyph:svg` CSS 选择器警告。
- 自动化覆盖官方创建 API、答案根强制落点、MNNote 优先挂载、宿主能力降级、最终范围校验、失败回滚及无索引刷新。
- 包内身份已核对：版本 `2.4.2-b15`、ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`，正式渠道保持 `stable`。
- 项目产物与交付副本均为 588,905 bytes，SHA-256 均为 `5C902354AF515C622C8B272A724A661FF93B563D25F14CEE6ED3952C3662C5D7`。
- 同一学习集子脑图的真实挂载仍需目标 MarginNote 4/iPad 验证。
