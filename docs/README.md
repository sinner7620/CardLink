# CardLink 项目文档

插件介绍与安装方法见 [项目首页](../README.md)。开发约定以 [AGENTS.md](../AGENTS.md) 为准。

## 维护入口

| 文档 | 用途 |
| --- | --- |
| [开发流程](workflow.md) | 验证、版本交付、main 同步与仓库整理 |
| [功能验收](acceptance.md) | 按本次改动选择检查项 |
| [边界与设计决策](boundaries.md) | 数据口径、隐私及历史设计背景 |
| [模块参考](modules/) | 插件核心、Web 界面和原生桥接 |
| [设计令牌](design/tokens.md) | CSS 与原生侧的颜色和层级入口 |
| [交互与动效](design/interaction.md) | 手势、动画与减弱动态约定 |
| [版本说明](release-notes/) | 用户更新内容，发布流程从此读取 |

## 功能文档

- [面板与导航](pages/panel-home.md)
- [错题本](pages/browse.md)
- [总览](pages/overview.md)
- [待复习](pages/review.md)
- [设置](pages/settings.md)
- [导出](pages/export.md)
- [答案窗口](pages/answer-card.md)
- [工具栏](pages/toolbar.md)

模块和设计参考中保留了部分旧版本背景，具体实现以当前源码为准；旧验收结论不代表当前版本已通过真机检查。已清理的历史文档可通过 `git log --all -- docs` 查阅。

开发任务记录保存在本机 `docs/changes/`，不随 Git 仓库同步。
