# updater.ts — 插件更新
## 职责
checkForUpdates：GitHub → Gitee 回退；下载体积校验（<64KB 判坏包）；节流仅成功后写入；任务互斥；下载后调起系统保存。
## 验收
坏包/双源回退/节流有行为测试。