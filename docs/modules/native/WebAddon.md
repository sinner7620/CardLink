# WebAddon.js — JSB 插件类
## 职责
JSB.defineClass 插件类：生命周期（sceneWillConnect/notebookWillOpen/Close/前后台/断连）、queryAddonCommandStatus（面板可见性 → 图标选中态）、toggleWebPanel。
## 关键行为
- 面板可见性三条变化路径 + toggle 均调用 refreshAddonCommands（图标高亮同步）
- 标签恢复仅手动；启动/前台不自动扫描
## 验收
面板关闭后图标立即取消高亮（有源码断言测试）。