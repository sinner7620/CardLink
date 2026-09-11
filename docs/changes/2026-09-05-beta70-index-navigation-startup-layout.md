# beta.70：真实索引、定位状态机、快速恢复与错题本通栏布局

## 问题根因

- 历史错题记录长期使用缓存的 `sourceNotebookId`，原卡跨学习集移动后，索引身份与真实数据库归属分叉。
- 定位把同步开关读值当成成功条件，且跨学习集连续派发 MN4/MN3 链接；宿主延迟处理时会出现“已经跳转却提示失败”或请求排队。
- 预览缩放比例会从 iframe 手势同步到 React，再由 React 把相同比例写回 iframe，重复调整滚动锚点导致抖动。
- 面板恢复仍重新聚合工作台数据；首个 dashboard 回来前只能显示启动状态。
- 错题本列表和详情各自带外框，筛选与批量栏又占据独立层级，形成多余容器。

## 实现

- 刷新时从 `MN.db.getNoteById(...).notebookId` 读取真实学习集并重建 recordId；迁移碰撞由 `mergeIndexedRecords` 合并收藏、历史与较新的复习计划。
- 跨学习集只发送官方 MN4 note URL。焦点、可见焦点或脑图选中项命中目标才算成功；失败后按“官方 focus → UIStatus → selectNotes”逐级降级。
- 定位按钮 await 原生结果，450ms 后展示等待提示；失败不播放成功动画。
- `mountCardPreview.setScale` 对相同比例幂等，布局尺寸不变时不重复写 DOM 几何。
- Web 保存 25 条首屏快照用于即时恢复，后台仍拉取原生真值；原生工作台按修订号与设置签名复用聚合结果。
- `MistakeBrowser` 改为共享底面和竖线分栏；工具条放入列表滚动区并 sticky，筛选与批量控件成为同一毛玻璃容器的后续行。
- 详情操作条采用逐级文字折叠和统一玻璃背景；标签、加号和选择项统一主蓝，三行标签触发纵向状态胶囊。

## 清理

- 定位主链不再调用 `noteReferenceUrlCandidates`，移除双协议派发。
- 标签胶囊不再复用 `mistakes.css` 中的 legacy 蓝色组合规则，详情样式由 `detail.css` 持有。
- 新实现未增加 `!important`，继续使用现有 cascade layer。

## 验证

- `pnpm check`
- `pnpm test`
- `pnpm build`
- 新增真实学习集迁移保留历史测试、缩放幂等测试；更新定位状态机与停靠边距断言。
- 构建产物与 iCloud 副本均为 487620 字节，SHA-256：`94C6F30CE8E57D7607AE703880CF1386E54E4A13570BB95F498AF36BEE88E766`。
- 已复制到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.70.mnaddon`。
