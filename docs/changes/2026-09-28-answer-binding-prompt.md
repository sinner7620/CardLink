# 查找答案的未绑定提示与来源选择

## 目的与实现

用户反馈查找答案仍显示旧的“尚未绑定答案脑图”弹窗，并存在两个取消按钮。原因是 popup 的 buttons 显式包含“取消”，同时 canCancel=true 又创建系统取消。

- `src/plugin.ts`：标题改为“尚未绑定答案”，buttons 只保留“立即绑定”；确认索引相应改为 0。
- 确认后调用共享来源选择器，提供“绑定答案脑图”和“绑定子卡片”，两层均由系统提供唯一取消入口。
- 为 chooseCurrentAnswerBinding、bindCurrentSubcards 增加可选原题上下文；从错题查找触发时使用解析后的原题学习集与题目节点，设置页不传参数时保持当前选中题目的行为。
- `tests/answer-binding-prompt.test.ts`：直接执行源函数，验证两层取消、来源选项、脑图分支上下文、子卡分支实际保存对象。
- 更新 `docs/modules/src/answer-lookup.md`、package.json、b47 发行说明。无存储迁移。

## 验证

- `pnpm check` 通过。
- 新增弹窗行为 4 项、子卡匹配 5 项通过；扩展运行 plugin-events 的 30 项中 29 项通过。
- plugin-events 既有“MN Utils 可用时使用 MNButton 创建带插件图标的第二入口”静态断言失败：测试要求 self.mainPath，当前实现已使用 owner.mainPath。本次未改该入口，也未为本次弹窗修改无关断言。日志：output/b47-plugin-tests.log。
- 已核对安装的 marginnote popup 实现：canCancel 自动插入系统取消，返回 -1；首个业务按钮返回 0。
- `pnpm build` 通过，保留既有 `.sfIconGlyph:svg` CSS 告警；包内 b47 版本、stable 渠道、正式 ID 和标题核对通过。已复制 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b47.mnaddon`。涉及的已跟踪文件 diff 检查通过。
- MarginNote 原生弹窗布局与交互未做真机验证。未提交 Git 或发布远端。
