# 做题／复习提示文案修改清单（CardLink b68）

基于当前 2.4.6-b68 源码，整理于 2026-10-31。右侧“改成”可直接填写新文案；不需要的提示填 **删除提示**，保留原文可填 **保留**。

`${...}` 表示运行时变量，建议保留占位，仅修改中文。相同文案合并为一行，源码位置列保留各处引用。`\n` 表示换行。

修改本清单不会自动改变插件；它是给你编辑和确认文字的稿件。提示删除与拦截逻辑分开：填“删除提示”仅表示不显示该句，不默认取消保存检查或操作拦截。

范围包含做题／复习入口、三种书写方式、切题、分类点选、反馈、错因、历史作答、结束报告，以及这些路径可返回的插件错误。界面标签单独放在第四部分。已移除的插件内画布模式不列入正常流程。

MarginNote 自己绘制的按钮、窗口提示及服务器返回的任意 `error.message` 无法在插件源码中穷举；下文列出插件可修改的文案及外层拼接。系统原话仍可能附在错误提示后面。题名、分类名称、模板自定义错因等运行时数据只列生成格式，不逐一展开具体值。部分底层错误只写日志，不保证每条都独立弹出。

## 常见长提示怎样拼接

| 场景 | 实际形式 | 改成 |
| --- | --- | --- |
| 模板未配置 | 【不可用原因】。请导入带 CardLink 配置的场景模板后重试 |  |
| 检测失败 | 【模板配置／手写会话能力】检测失败：【错误详情】 |  |
| 做题开始失败 | 无法开始做题：【原因】 |  |
| 切题失败 | 切换题目失败：【底层原因】 |  |
| 原生判定失败 | 原生作答判定保存失败：【错误详情】，请重试反馈 |  |
| 等级保存失败 | 复习结果保存失败：【错误详情】 |  |
| 标记失败 | 标记错题失败：【错误详情】 |  |
| 历史继续失败 | 继续作答失败：【错误详情】 |  |

正常提示和错误提示已分开；第四部分仅为按钮、状态和说明文字，不代表都会弹出。内部调试日志已排除。


## 一、浮动操作提示

| 编号 | 触发场景 | 当前原文 | 改成 | 类型与源码位置 |
| --- | --- | --- | --- | --- |
| P001 | 点击分类中的当前题目 | 当前正在作答这道题 |  | 浮动提示<br>[src/review-mode.ts:366](E:/project/MN/src/review-mode.ts:366) |
| P002 | 定位队列题目时发现原卡已不存在 | 该题目卡片已不存在 |  | 浮动提示<br>[src/review-mode.ts:632](E:/project/MN/src/review-mode.ts:632) |
| P003 | 切题时未能将题目居中到焦点模式 | 无法将题目卡片居中显示在焦点模式中 |  | 浮动提示<br>[src/review-mode.ts:643](E:/project/MN/src/review-mode.ts:643) |
| P004 | 定位后遮挡答案失败 | 答案遮盖失败 |  | 浮动提示<br>[src/review-mode.ts:667](E:/project/MN/src/review-mode.ts:667) |
| P005 | 切换题目过程中抛出异常 | 切换题目失败：${current.navigationError} |  | 浮动提示<br>[src/review-mode.ts:707](E:/project/MN/src/review-mode.ts:707) |
| P006 | 批注模式启动且模板检查通过 | 模板配置已就绪，本轮使用原生作答判定；切题时请用批注窗口右上角“下一题／做完了”保存 |  | 浮动提示<br>[src/review-mode.ts:813](E:/project/MN/src/review-mode.ts:813) |
| P007 | 保存后的原生作答判定失败 | 原生作答判定保存失败：${String((error as Error)?.message \|\| error)}，请重试反馈 |  | 浮动提示<br>[src/review-mode.ts:903](E:/project/MN/src/review-mode.ts:903) |
| P008 | 上一题／指定题／下一题／退出等待批注保存 | 已记录${target}。若批注窗口仍打开，请点右上角“下一题／做完了”保存；若已关闭，请在反馈区恢复操作 |  | 浮动提示<br>[src/review-mode.ts:957](E:/project/MN/src/review-mode.ts:957) |
| P009 | 查询批注关闭回执发生异常 | 批注状态同步失败，操作已保留；窗口已关闭时可在等级区恢复：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:959](E:/project/MN/src/review-mode.ts:959) |
| P010 | 重试手写保存失败 | 手写会话仍未保存，已保留本题：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:987](E:/project/MN/src/review-mode.ts:987) |
| P011 | 手动恢复批注状态失败 | 无法恢复批注窗口状态：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1021](E:/project/MN/src/review-mode.ts:1021) |
| P012 | 在首题点击上一题 | 已经是第一题 |  | 浮动提示<br>[src/review-mode.ts:1065](E:/project/MN/src/review-mode.ts:1065) |
| P013 | 调用手写模式的批注历史入口 | 手写会话保存在宿主的专用笔迹层；此批注历史入口仅用于卡片批注 |  | 浮动提示<br>[src/review-mode.ts:1072](E:/project/MN/src/review-mode.ts:1072) |
| P014 | 读取或继续历史作答失败 | 历史作答读取失败：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1081](E:/project/MN/src/review-mode.ts:1081) |
| P015 | 手写会话未就绪时点击下一题 | 手写会话未就绪：${current.navigationError}。请通过序号重新选择当前题目重试 |  | 浮动提示<br>[src/review-mode.ts:1097](E:/project/MN/src/review-mode.ts:1097) |
| P016 | 结束手写会话未获确认 | 结束手写会话失败，已保留本轮：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1253](E:/project/MN/src/review-mode.ts:1253) |
| P017 | 预选反馈等级后尚未拿到关闭回执 | 等级已选择，待批注保存后提交。若窗口仍打开，请点右上角“下一题／做完了”；若已关闭，请点反馈区的恢复操作 |  | 浮动提示<br>[src/review-mode.ts:1304](E:/project/MN/src/review-mode.ts:1304) |
| P018 | 手写保存失败，等级尚未提交 | 笔迹保存失败，反馈未提交：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1306](E:/project/MN/src/review-mode.ts:1306) |
| P019 | 标记时发现当前题卡不存在 | 当前题卡已不存在 |  | 浮动提示<br>[src/review-mode.ts:1352](E:/project/MN/src/review-mode.ts:1352) |
| P020 | 批注尚未保存时选择做题等级 | 等级已选择；请在批注窗口右上角保存，保存后提交原生反馈 |  | 浮动提示<br>[src/review-mode.ts:1375](E:/project/MN/src/review-mode.ts:1375) |
| P021 | 标记错题发生异常 | 标记错题失败：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1379](E:/project/MN/src/review-mode.ts:1379) |
| P022 | 提交复习等级发生异常 | 复习结果保存失败：${String((error as Error)?.message \|\| error)} |  | 浮动提示<br>[src/review-mode.ts:1430](E:/project/MN/src/review-mode.ts:1430) |
| P023 | 脑图做题无法定位当前卡片 | 无法定位并聚焦当前题目卡片 |  | 浮动提示<br>[src/same-map-practice.ts:302](E:/project/MN/src/same-map-practice.ts:302) |
| P024 | 历史窗口继续选中批注失败 | 继续作答失败：${String(error?.message \|\| error)} |  | 浮动提示<br>[src/practice-history.ts:72](E:/project/MN/src/practice-history.ts:72) |
| P025 | 选择做题范围前未打开脑图 | 请先打开脑图 |  | 浮动提示<br>[src/mnutils-entrance.ts:431](E:/project/MN/src/mnutils-entrance.ts:431) |
| P026 | 选择做题范围时未配置题目颜色 | 请先在答案配置中筛选题目卡片颜色 |  | 浮动提示<br>[src/mnutils-entrance.ts:439](E:/project/MN/src/mnutils-entrance.ts:439) |
| P027 | 结束旧脑图做题流程 | 已结束做题 |  | 浮动提示<br>[src/mnutils-entrance.ts:1230](E:/project/MN/src/mnutils-entrance.ts:1230) |
| P028 | 开始做题但未选择任何题目 | 请先选择做题题目 |  | 浮动提示<br>[src/mnutils-entrance.ts:1237](E:/project/MN/src/mnutils-entrance.ts:1237) |
| P029 | 模式选择期间做题范围或学习集变化 | 做题范围已关闭或切换，请重新选择题目 |  | 浮动提示<br>[src/mnutils-entrance.ts:1244](E:/project/MN/src/mnutils-entrance.ts:1244) |
| P030 | 做题入口返回失败原因 | 无法开始做题：${reason} |  | 浮动提示<br>[src/mnutils-entrance.ts:1252](E:/project/MN/src/mnutils-entrance.ts:1252) |
| P031 | 做题成功开始 | 已开始做题 |  | 浮动提示<br>[src/mnutils-entrance.ts:1256](E:/project/MN/src/mnutils-entrance.ts:1256) |
| P032 | 做题入口捕获异常 | 无法开始做题：${message} |  | 浮动提示<br>[src/mnutils-entrance.ts:1260](E:/project/MN/src/mnutils-entrance.ts:1260) |
| P033 | 答案索引刷新后学习集已变化 | 索引已刷新，学习集已切换，请回到原题重新查找 |  | 浮动提示<br>[src/plugin.ts:1464](E:/project/MN/src/plugin.ts:1464) |
| P034 | 子卡片答案查找没有结果 | 当前题目没有匹配到直接子卡片答案：${questionTitle} |  | 浮动提示<br>[src/plugin.ts:1483](E:/project/MN/src/plugin.ts:1483) |
| P035 | 成功揭开当前题的子卡片答案 | 已显示当前题目的子卡片答案 |  | 浮动提示<br>[src/plugin.ts:1524](E:/project/MN/src/plugin.ts:1524) |
| P036 | 查找答案失败 | 答案匹配失败：${describeError(error)} |  | 浮动提示<br>[src/plugin.ts:1544](E:/project/MN/src/plugin.ts:1544) |
| P037 | 从队列查答案但当前题卡不存在 | 当前复习题卡已不存在 |  | 浮动提示<br>[src/plugin.ts:1559](E:/project/MN/src/plugin.ts:1559) |
| P038 | 标记入口没有选中题卡 | 请先选中题目卡片 |  | 浮动提示<br>[src/plugin.ts:1585](E:/project/MN/src/plugin.ts:1585) |
| P039 | 批量标记结束 | 批量标记完成：${summary.join("，")} |  | 浮动提示<br>[src/plugin.ts:1602](E:/project/MN/src/plugin.ts:1602) |
| P040 | 标记入口发生异常 | 错题摘录失败：${describeError(error)} |  | 浮动提示<br>[src/plugin.ts:1610](E:/project/MN/src/plugin.ts:1610) |
| P041 | 写入错题标签失败 | 标记错题失败：未能写入原题标签，请打开原题所在学习集后重试 |  | 浮动提示<br>[src/mistake-manager.ts:555](E:/project/MN/src/mistake-manager.ts:555) |
| P042 | 已有错题按复测确认成功 | 已确认为错题复测，记录与复习计划已更新 |  | 浮动提示<br>[src/mistake-manager.ts:561](E:/project/MN/src/mistake-manager.ts:561) |
| P043 | 首次标记为错题成功 | 已标记为错题，可在错题浏览窗口中查看 |  | 浮动提示<br>[src/mistake-manager.ts:561](E:/project/MN/src/mistake-manager.ts:561) |
| P044 | 批量复习部分题目写标签失败 | ${blocked} 道错题复习失败：未能写入原题标签，记录已保留原状态 |  | 浮动提示<br>[src/mistake-manager.ts:828](E:/project/MN/src/mistake-manager.ts:828) |

## 二、选择框、说明与结果弹窗

| 编号 | 触发场景 | 当前原文 | 改成 | 类型与源码位置 |
| --- | --- | --- | --- | --- |
| P045 | 会话工具条、反馈、分类或结果报告 | 仍在书写，等待保存 |  | 弹窗选项<br>[src/review-mode.ts:1001](E:/project/MN/src/review-mode.ts:1001) |
| P046 | 会话工具条、反馈、分类或结果报告 | 批注窗口已关闭，继续 |  | 弹窗选项<br>[src/review-mode.ts:1001](E:/project/MN/src/review-mode.ts:1001) |
| P047 | 会话工具条、反馈、分类或结果报告 | 恢复批注状态 |  | 弹窗标题<br>[src/review-mode.ts:1001](E:/project/MN/src/review-mode.ts:1001) |
| P048 | 会话工具条、反馈、分类或结果报告 | 仅在批注窗口已经关闭、操作仍未继续时确认恢复；仍在书写请先保存。 |  | 弹窗说明<br>[src/review-mode.ts:1001](E:/project/MN/src/review-mode.ts:1001) |
| P049 | 会话工具条、反馈、分类或结果报告 | 选择做题题目 |  | 弹窗标题<br>[src/review-mode.ts:1228](E:/project/MN/src/review-mode.ts:1228) |
| P050 | 会话工具条、反馈、分类或结果报告 | 选择复习题目 |  | 弹窗标题<br>[src/review-mode.ts:1228](E:/project/MN/src/review-mode.ts:1228) |
| P051 | 会话工具条、反馈、分类或结果报告 | 当前第 ${current.index + 1} 题，共 ${current.items.length} 题 |  | 弹窗说明<br>[src/review-mode.ts:1229](E:/project/MN/src/review-mode.ts:1229) |
| P052 | 会话工具条、反馈、分类或结果报告 | 本次做题结果 |  | 结果弹窗<br>[src/review-mode.ts:1264](E:/project/MN/src/review-mode.ts:1264) |
| P053 | 会话工具条、反馈、分类或结果报告 | 队列 ${current.items.length} 道 · 已完成 ${completedToday(current).filter(Boolean).length} 道\n用时约 ${elapsedMinutes} 分钟 |  | 结果弹窗<br>[src/review-mode.ts:1264](E:/project/MN/src/review-mode.ts:1264) |
| P054 | 会话工具条、反馈、分类或结果报告 | 完成 |  | 结果弹窗<br>[src/review-mode.ts:1264](E:/project/MN/src/review-mode.ts:1264)<br>[src/review-mode.ts:1270](E:/project/MN/src/review-mode.ts:1270) |
| P055 | 会话工具条、反馈、分类或结果报告 | 本次复习结果 |  | 结果弹窗<br>[src/review-mode.ts:1268](E:/project/MN/src/review-mode.ts:1268) |
| P056 | 会话工具条、反馈、分类或结果报告 | 智能复习 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n本日已复习 ${completedToday(current).filter(Boolean).length} 道；固定曲线进度保持不变。 |  | 结果弹窗<br>[src/review-mode.ts:1269](E:/project/MN/src/review-mode.ts:1269) |
| P057 | 会话工具条、反馈、分类或结果报告 | 队列 ${current.items.length} 道 · 已查看 ${visited} 道\n用时约 ${elapsedMinutes} 分钟\n不会 ${levels[0]} · 不熟 ${levels[1]} · 掌握 ${levels[2]} |  | 结果弹窗<br>[src/review-mode.ts:1269](E:/project/MN/src/review-mode.ts:1269) |
| P058 | 选择不会／不熟后的错因选择 | 跳过错因并保存 |  | 弹窗选项<br>[src/error-reasons.ts:14](E:/project/MN/src/error-reasons.ts:14) |
| P059 | 选择不会／不熟后的错因选择 | 本次错因 |  | 弹窗标题<br>[src/error-reasons.ts:14](E:/project/MN/src/error-reasons.ts:14) |
| P060 | 选择不会／不熟后的错因选择 | 选择一项主要错因；取消则不提交本次等级 |  | 弹窗说明<br>[src/error-reasons.ts:14](E:/project/MN/src/error-reasons.ts:14) |
| P061 | 做题入口、队列准备或模式选择 | 脑图内书写 |  | 弹窗选项<br>[src/mnutils-entrance.ts:1241](E:/project/MN/src/mnutils-entrance.ts:1241) |
| P062 | 做题入口、队列准备或模式选择 | 批注窗口书写 |  | 弹窗选项<br>[src/mnutils-entrance.ts:1241](E:/project/MN/src/mnutils-entrance.ts:1241) |
| P063 | 做题入口、队列准备或模式选择 | 手写会话 |  | 弹窗选项<br>[src/mnutils-entrance.ts:1241](E:/project/MN/src/mnutils-entrance.ts:1241) |
| P064 | 做题入口、队列准备或模式选择 | 做题方式 |  | 弹窗标题<br>[src/mnutils-entrance.ts:1241](E:/project/MN/src/mnutils-entrance.ts:1241) |
| P065 | 做题入口、队列准备或模式选择 | 批注书写需要模板配置；手写会话使用宿主焦点卡专用笔迹层 |  | 弹窗说明<br>[src/mnutils-entrance.ts:1241](E:/project/MN/src/mnutils-entrance.ts:1241)<br>[src/rails-core.ts:132](E:/project/MN/src/rails-core.ts:132) |
| P066 | 复习方式选择或工作台命令检查 | 脑图书写模式 |  | 弹窗选项<br>[src/rails-core.ts:132](E:/project/MN/src/rails-core.ts:132) |
| P067 | 复习方式选择或工作台命令检查 | 批注书写模式 |  | 弹窗选项<br>[src/rails-core.ts:132](E:/project/MN/src/rails-core.ts:132) |
| P068 | 复习方式选择或工作台命令检查 | 手写会话模式 |  | 弹窗选项<br>[src/rails-core.ts:132](E:/project/MN/src/rails-core.ts:132) |
| P069 | 复习方式选择或工作台命令检查 | 复习方式 |  | 弹窗标题<br>[src/rails-core.ts:132](E:/project/MN/src/rails-core.ts:132) |
| P070 | 当前题查答案或卡片标记入口 | 尚未绑定答案 |  | 结果弹窗<br>[src/plugin.ts:1444](E:/project/MN/src/plugin.ts:1444) |
| P071 | 当前题查答案或卡片标记入口 | 原题脑图「${mistakeContext.record.sourceNotebookTitle}」尚未绑定答案。 |  | 结果弹窗<br>[src/plugin.ts:1446](E:/project/MN/src/plugin.ts:1446) |
| P072 | 当前题查答案或卡片标记入口 | 当前脑图尚未绑定答案。 |  | 结果弹窗<br>[src/plugin.ts:1447](E:/project/MN/src/plugin.ts:1447) |
| P073 | 当前题查答案或卡片标记入口 | 立即绑定 |  | 结果弹窗<br>[src/plugin.ts:1448](E:/project/MN/src/plugin.ts:1448) |
| P074 | 当前题查答案或卡片标记入口 | 没有匹配到答案 |  | 结果弹窗、界面文字／状态<br>[src/plugin.ts:1496](E:/project/MN/src/plugin.ts:1496)<br>[web/src/main.jsx:1933](E:/project/MN/web/src/main.jsx:1933) |
| P075 | 当前题查答案或卡片标记入口 | ${notFoundMessage}\n索引更新时间：${updatedText} |  | 结果弹窗<br>[src/plugin.ts:1497](E:/project/MN/src/plugin.ts:1497) |
| P076 | 当前题查答案或卡片标记入口 | 刷新索引后重试 |  | 结果弹窗<br>[src/plugin.ts:1498](E:/project/MN/src/plugin.ts:1498) |
| P077 | 当前题查答案或卡片标记入口 | 生成答案卡片 |  | 结果弹窗<br>[src/plugin.ts:1498](E:/project/MN/src/plugin.ts:1498) |
| P078 | 单题或批量标记时选择等级 | ${LEVEL_DESCRIPTIONS[level]}${current === level ? "（当前）" : ""} |  | 弹窗说明／等级选择<br>[src/level-picker.ts:11](E:/project/MN/src/level-picker.ts:11) |
| P079 | 单题或批量标记时选择等级 | （当前） |  | 弹窗说明／等级选择<br>[src/level-picker.ts:11](E:/project/MN/src/level-picker.ts:11) |
| P080 | 单题或批量标记时选择等级 | 批量标记 ${count} 道错题 |  | 弹窗说明／等级选择<br>[src/level-picker.ts:16](E:/project/MN/src/level-picker.ts:16) |
| P081 | 单题或批量标记时选择等级 | 标记掌握状态 |  | 弹窗说明／等级选择<br>[src/level-picker.ts:16](E:/project/MN/src/level-picker.ts:16) |
| P082 | 单题或批量标记时选择等级 | 所选卡片将统一使用该掌握等级 |  | 弹窗说明／等级选择<br>[src/level-picker.ts:17](E:/project/MN/src/level-picker.ts:17) |
| P083 | 单题或批量标记时选择等级 | 请选择这道题目前的掌握状态 |  | 弹窗说明／等级选择<br>[src/level-picker.ts:17](E:/project/MN/src/level-picker.ts:17) |

## 三、批注／手写／保存等错误原因

| 编号 | 触发场景 | 当前原文 | 改成 | 类型与源码位置 |
| --- | --- | --- | --- | --- |
| P084 | 会话工具条、反馈、分类或结果报告 | 无法定位做题卡片 |  | 错误原因<br>[src/review-mode.ts:627](E:/project/MN/src/review-mode.ts:627) |
| P085 | 脑图做题定位、遮盖或切题 | 所选题目没有直接子卡片答案 |  | 界面文字／状态、不可用原因<br>[src/review-mode.ts:667](E:/project/MN/src/review-mode.ts:667)<br>[src/same-map-practice.ts:358](E:/project/MN/src/same-map-practice.ts:358) |
| P086 | 会话工具条、反馈、分类或结果报告 | 上一题手写会话尚未结束，未切题 |  | 错误原因<br>[src/review-mode.ts:698](E:/project/MN/src/review-mode.ts:698) |
| P087 | 会话工具条、反馈、分类或结果报告 | 该书写模式已移除，请重新选择书写方式 |  | 错误原因<br>[src/review-mode.ts:717](E:/project/MN/src/review-mode.ts:717) |
| P088 | 场景面板或桥接请求状态检查 | 请先关闭当前批注窗口 |  | 错误原因、界面文字／状态<br>[src/review-mode.ts:718](E:/project/MN/src/review-mode.ts:718)<br>[web/src/lib/sceneTransport.js:186](E:/project/MN/web/src/lib/sceneTransport.js:186) |
| P089 | 会话工具条、反馈、分类或结果报告 | 批注复习需要开启场景功能，并在支持的场景页面中使用 |  | 错误原因<br>[src/review-mode.ts:722](E:/project/MN/src/review-mode.ts:722) |
| P090 | 会话工具条、反馈、分类或结果报告 | 请等待本次复习保存完成 |  | 错误原因<br>[src/review-mode.ts:724](E:/project/MN/src/review-mode.ts:724) |
| P091 | 会话工具条、反馈、分类或结果报告 | 智能复习未开启 |  | 错误原因<br>[src/review-mode.ts:725](E:/project/MN/src/review-mode.ts:725) |
| P092 | 会话工具条、反馈、分类或结果报告 | 请从智能复习页进入复习模式 |  | 错误原因<br>[src/review-mode.ts:726](E:/project/MN/src/review-mode.ts:726) |
| P093 | 会话工具条、反馈、分类或结果报告 | 本次启动已取消 |  | 不可用原因<br>[src/review-mode.ts:739](E:/project/MN/src/review-mode.ts:739)<br>[src/review-mode.ts:749](E:/project/MN/src/review-mode.ts:749) |
| P094 | 会话工具条、反馈、分类或结果报告 | 请先启用 MN Utils 悬浮球，再开始做题或复习 |  | 错误原因<br>[src/review-mode.ts:806](E:/project/MN/src/review-mode.ts:806) |
| P095 | 会话工具条、反馈、分类或结果报告 | 所选题目已不存在，请重新选择 |  | 错误原因<br>[src/review-mode.ts:829](E:/project/MN/src/review-mode.ts:829) |
| P096 | 会话工具条、反馈、分类或结果报告 | 这条是普通旧批注；当前批注模式只继续原生练习批注，请在卡片上打开普通批注 |  | 错误原因<br>[src/review-mode.ts:841](E:/project/MN/src/review-mode.ts:841) |
| P097 | 会话工具条、反馈、分类或结果报告 | 未确认批注窗口已打开 |  | 错误原因<br>[src/review-mode.ts:866](E:/project/MN/src/review-mode.ts:866) |
| P098 | 会话工具条、反馈、分类或结果报告 | 手写笔迹保存和退出尚未确认 |  | 错误原因<br>[src/review-mode.ts:932](E:/project/MN/src/review-mode.ts:932) |
| P099 | 会话工具条、反馈、分类或结果报告 | 窗口状态同步未完成，请重试 |  | 错误原因<br>[src/review-mode.ts:1006](E:/project/MN/src/review-mode.ts:1006) |
| P100 | 会话工具条、反馈、分类或结果报告 | 题目已切换，请重新打开历史作答 |  | 错误原因<br>[src/review-mode.ts:1074](E:/project/MN/src/review-mode.ts:1074)<br>[src/review-mode.ts:1076](E:/project/MN/src/review-mode.ts:1076) |
| P101 | 会话工具条、反馈、分类或结果报告 | 批注状态尚未确认，请保存当前批注或确认窗口已关闭后重试 |  | 错误原因<br>[src/review-mode.ts:1077](E:/project/MN/src/review-mode.ts:1077) |
| P102 | 会话工具条、反馈、分类或结果报告 | 宿主未确认手写会话结束 |  | 错误原因<br>[src/review-mode.ts:1248](E:/project/MN/src/review-mode.ts:1248) |
| P103 | 会话工具条、反馈、分类或结果报告 | 宿主未确认作答判定已保存 |  | 错误原因<br>[src/review-mode.ts:1338](E:/project/MN/src/review-mode.ts:1338) |
| P104 | 脑图做题定位、遮盖或切题 | 当前 MarginNote 不支持原生图片遮盖 |  | 错误原因<br>[src/same-map-practice.ts:148](E:/project/MN/src/same-map-practice.ts:148) |
| P105 | 脑图做题定位、遮盖或切题 | 自定义遮盖图片解码失败 |  | 错误原因<br>[src/same-map-practice.ts:152](E:/project/MN/src/same-map-practice.ts:152) |
| P106 | 脑图做题定位、遮盖或切题 | 请先选择刷题范围 |  | 不可用原因<br>[src/same-map-practice.ts:331](E:/project/MN/src/same-map-practice.ts:331) |
| P107 | 相关异常转译为通用错误文案 | 请先打开题目脑图 |  | 不可用原因、共享错误映射<br>[src/same-map-practice.ts:333](E:/project/MN/src/same-map-practice.ts:333)<br>[src/error-messages.ts:16](E:/project/MN/src/error-messages.ts:16) |
| P108 | 脑图做题定位、遮盖或切题 | 无法定位并聚焦队列第一道题 |  | 不可用原因<br>[src/same-map-practice.ts:336](E:/project/MN/src/same-map-practice.ts:336) |
| P109 | 脑图做题定位、遮盖或切题 | 做题模式已结束 |  | 不可用原因<br>[src/same-map-practice.ts:338](E:/project/MN/src/same-map-practice.ts:338)<br>[src/same-map-practice.ts:352](E:/project/MN/src/same-map-practice.ts:352) |
| P110 | 脑图做题定位、遮盖或切题 | 学习集已切换，请重新开始做题 |  | 不可用原因<br>[src/same-map-practice.ts:340](E:/project/MN/src/same-map-practice.ts:340)<br>[src/same-map-practice.ts:354](E:/project/MN/src/same-map-practice.ts:354) |
| P111 | 脑图做题定位、遮盖或切题 | 无法自动选中题目卡片以定位遮盖 |  | 不可用原因<br>[src/same-map-practice.ts:348](E:/project/MN/src/same-map-practice.ts:348) |
| P112 | 脑图做题定位、遮盖或切题 | 无法定位当前脑图卡片的遮盖位置 |  | 不可用原因<br>[src/same-map-practice.ts:350](E:/project/MN/src/same-map-practice.ts:350) |
| P113 | 脑图做题定位、遮盖或切题 | 无法读取定位卡片的脑图位置 |  | 不可用原因<br>[src/same-map-practice.ts:362](E:/project/MN/src/same-map-practice.ts:362) |
| P114 | 脑图做题定位、遮盖或切题 | 无法建立脑图遮盖坐标 |  | 不可用原因<br>[src/same-map-practice.ts:364](E:/project/MN/src/same-map-practice.ts:364) |
| P115 | 脑图做题定位、遮盖或切题 | 自定义遮盖图片加载失败 |  | 不可用原因<br>[src/same-map-practice.ts:367](E:/project/MN/src/same-map-practice.ts:367) |
| P116 | 脑图做题定位、遮盖或切题 | 未能在答案卡片上放置遮盖 |  | 不可用原因<br>[src/same-map-practice.ts:376](E:/project/MN/src/same-map-practice.ts:376) |
| P117 | 脑图做题定位、遮盖或切题 | 放置答案遮盖失败 |  | 不可用原因<br>[src/same-map-practice.ts:380](E:/project/MN/src/same-map-practice.ts:380) |
| P118 | 读取／打开批注或提交原生判定 | 请求超时，结果尚未确认；请检查书写窗口，不要连续新建 |  | 错误原因<br>[web/annotation-client.js:29](E:/project/MN/web/annotation-client.js:29) |
| P119 | 读取／打开批注或提交原生判定 | MarginNote 未返回结果 |  | 错误原因<br>[web/annotation-client.js:35](E:/project/MN/web/annotation-client.js:35) |
| P120 | 读取／打开批注或提交原生判定 | 未取得批注版本，请刷新后重试 |  | 错误原因<br>[web/annotation-client.js:40](E:/project/MN/web/annotation-client.js:40) |
| P121 | 读取／打开批注或提交原生判定 | 当前宿主未提供作答判定接口 |  | 不可用原因<br>[web/annotation-client.js:51](E:/project/MN/web/annotation-client.js:51) |
| P122 | 读取／打开批注或提交原生判定 | 当前场景未配置原生作答判定 |  | 不可用原因<br>[web/annotation-client.js:56](E:/project/MN/web/annotation-client.js:56) |
| P123 | 读取／打开批注或提交原生判定 | 缺少本次作答身份，不能提交判定 |  | 错误原因<br>[web/annotation-client.js:60](E:/project/MN/web/annotation-client.js:60) |
| P124 | 读取／打开批注或提交原生判定 | 本次作答纸身份不匹配，未修改历史批注 |  | 错误原因<br>[web/annotation-client.js:64](E:/project/MN/web/annotation-client.js:64) |
| P125 | 读取／打开批注或提交原生判定 | 宿主未确认这份作答的官方反馈状态，未推进下一题 |  | 错误原因<br>[web/annotation-client.js:77](E:/project/MN/web/annotation-client.js:77) |
| P126 | 读取／打开批注或提交原生判定 | 未取得详情原题的题卡身份 |  | 错误原因<br>[web/annotation-client.js:93](E:/project/MN/web/annotation-client.js:93) |
| P127 | 读取／打开批注或提交原生判定 | 未取得复习题卡的来源学习集，无法打开连续批注 |  | 错误原因<br>[web/annotation-client.js:96](E:/project/MN/web/annotation-client.js:96) |
| P128 | 读取／打开批注或提交原生判定 | 未确认作答编辑器已打开，请检查当前卡片 |  | 错误原因<br>[web/annotation-client.js:143](E:/project/MN/web/annotation-client.js:143) |
| P129 | 读取／打开批注或提交原生判定 | 宿主仍打开了旧批注，请关闭窗口；未新增作答，请导出调试日志定位 |  | 错误原因<br>[web/annotation-client.js:145](E:/project/MN/web/annotation-client.js:145) |
| P130 | 手写会话准备、保存、退出或切题检查 | 手写会话的学习集已变化，请回到题目所属学习集 |  | 错误原因<br>[web/src/lib/writingSession.js:10](E:/project/MN/web/src/lib/writingSession.js:10) |
| P131 | 手写会话准备、保存、退出或切题检查 | 当前宿主未提供手写会话接口 |  | 不可用原因<br>[web/src/lib/writingSession.js:15](E:/project/MN/web/src/lib/writingSession.js:15) |
| P132 | 手写会话准备、保存、退出或切题检查 | 当前宿主尚未开放可用的焦点卡分层手写会话；请使用脑图或已配置模板的批注模式 |  | 不可用原因<br>[web/src/lib/writingSession.js:22](E:/project/MN/web/src/lib/writingSession.js:22) |
| P133 | 手写会话准备、保存、退出或切题检查 | 手写准备清单保存尚未确认，已保留原请求，未创建会话 |  | 错误原因<br>[web/src/lib/writingSession.js:40](E:/project/MN/web/src/lib/writingSession.js:40) |
| P134 | 手写会话准备、保存、退出或切题检查 | 手写层占用结果未确认，已保留原请求，请先检查当前手写层 |  | 错误原因<br>[web/src/lib/writingSession.js:47](E:/project/MN/web/src/lib/writingSession.js:47) |
| P135 | 手写会话准备、保存、退出或切题检查 | 手写会话未完成：${r.code} |  | 错误原因<br>[web/src/lib/writingSession.js:48](E:/project/MN/web/src/lib/writingSession.js:48) |
| P136 | 手写会话准备、保存、退出或切题检查 | 手写操作仍未确认，已保留原请求；再次操作只查询结果 |  | 错误原因<br>[web/src/lib/writingSession.js:54](E:/project/MN/web/src/lib/writingSession.js:54) |
| P137 | 手写会话准备、保存、退出或切题检查 | 请先保存退出当前手写尝试 |  | 错误原因<br>[web/src/lib/writingSession.js:58](E:/project/MN/web/src/lib/writingSession.js:58) |
| P138 | 手写会话准备、保存、退出或切题检查 | 宿主未确认手写会话结束记录 |  | 错误原因<br>[web/src/lib/writingSession.js:60](E:/project/MN/web/src/lib/writingSession.js:60) |
| P139 | 手写会话准备、保存、退出或切题检查 | 宿主会话记录仍未确认结束，请保留本轮并重试 |  | 错误原因<br>[web/src/lib/writingSession.js:62](E:/project/MN/web/src/lib/writingSession.js:62) |
| P140 | 手写会话准备、保存、退出或切题检查 | 宿主仍有未结束的手写会话，请先在原练习中结束或恢复 |  | 错误原因<br>[web/src/lib/writingSession.js:84](E:/project/MN/web/src/lib/writingSession.js:84) |
| P141 | 手写会话准备、保存、退出或切题检查 | 宿主未返回手写准备清单版本 |  | 错误原因<br>[web/src/lib/writingSession.js:86](E:/project/MN/web/src/lib/writingSession.js:86) |
| P142 | 手写会话准备、保存、退出或切题检查 | 宿主未确认手写准备清单 |  | 错误原因<br>[web/src/lib/writingSession.js:89](E:/project/MN/web/src/lib/writingSession.js:89) |
| P143 | 手写会话准备、保存、退出或切题检查 | 未读回本题的手写准备选择 |  | 错误原因<br>[web/src/lib/writingSession.js:91](E:/project/MN/web/src/lib/writingSession.js:91) |
| P144 | 手写会话准备、保存、退出或切题检查 | 未读回本次手写会话身份，请保留当前窗口并重试 |  | 错误原因<br>[web/src/lib/writingSession.js:94](E:/project/MN/web/src/lib/writingSession.js:94) |
| P145 | 手写会话准备、保存、退出或切题检查 | 宿主未返回本次手写尝试身份 |  | 错误原因<br>[web/src/lib/writingSession.js:100](E:/project/MN/web/src/lib/writingSession.js:100) |
| P146 | 手写会话准备、保存、退出或切题检查 | 焦点卡手写层尚未就绪，请保留当前窗口并重试 |  | 错误原因<br>[web/src/lib/writingSession.js:105](E:/project/MN/web/src/lib/writingSession.js:105) |
| P147 | 手写会话准备、保存、退出或切题检查 | 手写会话身份已变化，未切题 |  | 错误原因<br>[web/src/lib/writingSession.js:111](E:/project/MN/web/src/lib/writingSession.js:111) |
| P148 | 手写会话准备、保存、退出或切题检查 | 当前画布与本次专用手写层不匹配，未保存或切题 |  | 错误原因<br>[web/src/lib/writingSession.js:117](E:/project/MN/web/src/lib/writingSession.js:117) |
| P149 | 手写会话准备、保存、退出或切题检查 | 宿主未确认当前笔迹已保存并可切题，已保留本题 |  | 错误原因<br>[web/src/lib/writingSession.js:121](E:/project/MN/web/src/lib/writingSession.js:121) |
| P150 | 手写会话准备、保存、退出或切题检查 | 宿主未确认退出手写尝试，已保留本题 |  | 错误原因<br>[web/src/lib/writingSession.js:123](E:/project/MN/web/src/lib/writingSession.js:123) |
| P151 | 场景面板或桥接请求状态检查 | 关闭事件未被复习队列接收 |  | 错误原因<br>[web/src/lib/sceneTransport.js:57](E:/project/MN/web/src/lib/sceneTransport.js:57) |
| P152 | 场景面板或桥接请求状态检查 | 新接口要求软件 4.5.0 及以上 |  | 错误原因<br>[web/src/lib/sceneTransport.js:91](E:/project/MN/web/src/lib/sceneTransport.js:91) |
| P153 | 场景面板或桥接请求状态检查 | 已离开场景页面，新接口已停用 |  | 错误原因<br>[web/src/lib/sceneTransport.js:97](E:/project/MN/web/src/lib/sceneTransport.js:97) |
| P154 | 场景面板或桥接请求状态检查 | 场景状态尚未恢复，请稍后重试 |  | 错误原因<br>[web/src/lib/sceneTransport.js:102](E:/project/MN/web/src/lib/sceneTransport.js:102) |
| P155 | 场景面板或桥接请求状态检查 | 无法读取宿主手写会话运行指南 |  | 错误原因<br>[web/src/lib/sceneTransport.js:115](E:/project/MN/web/src/lib/sceneTransport.js:115) |
| P156 | 场景面板或桥接请求状态检查 | 宿主手写会话运行指南为空 |  | 错误原因<br>[web/src/lib/sceneTransport.js:117](E:/project/MN/web/src/lib/sceneTransport.js:117) |
| P157 | 场景面板或桥接请求状态检查 | 未知手写会话操作 |  | 错误原因<br>[web/src/lib/sceneTransport.js:124](E:/project/MN/web/src/lib/sceneTransport.js:124) |
| P158 | 场景面板或桥接请求状态检查 | 宿主未确认批注的下一题按钮，请关闭当前窗口后重试 |  | 错误原因<br>[web/src/lib/sceneTransport.js:198](E:/project/MN/web/src/lib/sceneTransport.js:198) |
| P159 | 场景面板或桥接请求状态检查 | 场景请求超时 |  | 错误原因<br>[web/src/lib/sceneTransport.js:220](E:/project/MN/web/src/lib/sceneTransport.js:220) |
| P160 | 场景面板或桥接请求状态检查 | 场景请求未被接收 |  | 错误原因<br>[web/src/lib/sceneTransport.js:224](E:/project/MN/web/src/lib/sceneTransport.js:224) |
| P161 | 场景面板或桥接请求状态检查 | 请先关闭当前复习批注窗口 |  | 错误原因<br>[web/src/lib/sceneTransport.js:238](E:/project/MN/web/src/lib/sceneTransport.js:238) |
| P162 | 场景面板或桥接请求状态检查 | 正在打开批注面板，请稍候 |  | 错误原因<br>[web/src/lib/sceneTransport.js:239](E:/project/MN/web/src/lib/sceneTransport.js:239) |
| P163 | 场景面板或桥接请求状态检查 | 场景面板已关闭，请检查批注窗口 |  | 错误原因<br>[rails-native/SceneWorkbench.js:31](E:/project/MN/rails-native/SceneWorkbench.js:31) |
| P164 | 场景面板或桥接请求状态检查 | 请在场景面板中开启批注复习 |  | 错误原因<br>[rails-native/SceneWorkbench.js:247](E:/project/MN/rails-native/SceneWorkbench.js:247) |
| P165 | 场景面板或桥接请求状态检查 | 正在处理批注请求，请稍候 |  | 错误原因<br>[rails-native/SceneWorkbench.js:248](E:/project/MN/rails-native/SceneWorkbench.js:248) |
| P166 | 场景面板或桥接请求状态检查 | 同步批注窗口状态超时，请重试 |  | 错误原因<br>[rails-native/SceneWorkbench.js:254](E:/project/MN/rails-native/SceneWorkbench.js:254) |
| P167 | 场景面板或桥接请求状态检查 | 打开批注超时，结果未确认，请检查批注窗口 |  | 错误原因<br>[rails-native/SceneWorkbench.js:254](E:/project/MN/rails-native/SceneWorkbench.js:254) |
| P168 | 复习方式选择或工作台命令检查 | 无效的复习算法 |  | 错误原因<br>[src/rails-core.ts:144](E:/project/MN/src/rails-core.ts:144) |
| P169 | 复习方式选择或工作台命令检查 | 请先退出当前复习，再切换算法 |  | 错误原因<br>[src/rails-core.ts:145](E:/project/MN/src/rails-core.ts:145) |
| P170 | 复习方式选择或工作台命令检查 | 请先在设置 → 关于插件开启“场景面板与整卡手写”，并在软件4.5.0及以上的场景面板内使用 |  | 错误原因<br>[src/rails-core.ts:309](E:/project/MN/src/rails-core.ts:309) |
| P171 | 复习方式选择或工作台命令检查 | 无效的反馈等级 |  | 错误原因<br>[src/rails-core.ts:338](E:/project/MN/src/rails-core.ts:338) |
| P172 | 当前题查答案或卡片标记入口 | 目标卡片已不存在 |  | 错误原因<br>[src/plugin.ts:1627](E:/project/MN/src/plugin.ts:1627) |
| P173 | 当前题查答案或卡片标记入口 | 请先打开卡片所在学习集 |  | 错误原因<br>[src/plugin.ts:1634](E:/project/MN/src/plugin.ts:1634) |
| P174 | 当前题查答案或卡片标记入口 | 菜单卡片不属于当前学习集，请重新打开卡片菜单 |  | 错误原因<br>[src/plugin.ts:1636](E:/project/MN/src/plugin.ts:1636) |
| P175 | 当前题查答案或卡片标记入口 | 答案脑图中的卡片不能标记为原题错题 |  | 错误原因<br>[src/plugin.ts:1642](E:/project/MN/src/plugin.ts:1642) |
| P176 | 当前题查答案或卡片标记入口 | 该卡片被识别为答案卡，请在原题上标记错题 |  | 错误原因<br>[src/plugin.ts:1649](E:/project/MN/src/plugin.ts:1649) |
| P177 | 当前题查答案或卡片标记入口 | 该卡片未能标记为错题 |  | 错误原因<br>[src/plugin.ts:1664](E:/project/MN/src/plugin.ts:1664) |
| P178 | 标记、复测或定位记录的校验／保存 | 当前使用智能复习，请在待复习页提交四档反馈；切回固定曲线后可修改原等级 |  | 错误原因<br>[src/mistake-manager.ts:69](E:/project/MN/src/mistake-manager.ts:69) |
| P179 | 标记、复测或定位记录的校验／保存 | 所选卡片没有 noteId，无法标记 |  | 错误原因<br>[src/mistake-manager.ts:508](E:/project/MN/src/mistake-manager.ts:508)<br>[src/mistake-manager.ts:594](E:/project/MN/src/mistake-manager.ts:594) |
| P180 | 标记、复测或定位记录的校验／保存 | 错题等级必须为不会、不熟或掌握 |  | 错误原因<br>[src/mistake-manager.ts:702](E:/project/MN/src/mistake-manager.ts:702)<br>[src/mistake-manager.ts:777](E:/project/MN/src/mistake-manager.ts:777) |
| P181 | 标记、复测或定位记录的校验／保存 | 请至少选择一道错题 |  | 错误原因<br>[src/mistake-manager.ts:779](E:/project/MN/src/mistake-manager.ts:779) |
| P182 | 会话工具条、反馈、分类或结果报告 | 未知卡片菜单命令 |  | 错误原因<br>[src/card-menu.ts:15](E:/project/MN/src/card-menu.ts:15) |
| P183 | 会话工具条、反馈、分类或结果报告 | 菜单未提供有效的卡片ID |  | 错误原因<br>[src/card-menu.ts:16](E:/project/MN/src/card-menu.ts:16) |
| P184 | 会话工具条、反馈、分类或结果报告 | 学习集已切换，请在目标卡片上重新标记 |  | 错误原因<br>[src/card-menu.ts:21](E:/project/MN/src/card-menu.ts:21) |
| P185 | 智能复习反馈、错因或历史操作 | 保持率须为 70%–97%，最大间隔须为 1–36500 天 |  | 错误原因<br>[src/fsrs-domain.ts:30](E:/project/MN/src/fsrs-domain.ts:30) |
| P186 | 智能复习反馈、错因或历史操作 | 无效的错因 |  | 错误原因<br>[src/fsrs-domain.ts:35](E:/project/MN/src/fsrs-domain.ts:35) |
| P187 | 智能复习反馈、错因或历史操作 | 错因备注最多 500 字 |  | 错误原因<br>[src/fsrs-domain.ts:36](E:/project/MN/src/fsrs-domain.ts:36) |
| P188 | 智能复习反馈、错因或历史操作 | 原复习日期无效，未迁入 |  | 错误原因<br>[src/fsrs-domain.ts:40](E:/project/MN/src/fsrs-domain.ts:40) |
| P189 | 智能复习反馈、错因或历史操作 | 无效的复习反馈 |  | 错误原因<br>[src/fsrs-domain.ts:65](E:/project/MN/src/fsrs-domain.ts:65)<br>[src/fsrs-domain.ts:90](E:/project/MN/src/fsrs-domain.ts:90) |
| P190 | 智能复习反馈、错因或历史操作 | 复习状态已变化，请刷新后重试 |  | 错误原因<br>[src/fsrs-domain.ts:67](E:/project/MN/src/fsrs-domain.ts:67)<br>[src/fsrs-domain.ts:78](E:/project/MN/src/fsrs-domain.ts:78)<br>[src/fsrs-domain.ts:87](E:/project/MN/src/fsrs-domain.ts:87) |
| P191 | 智能复习反馈、错因或历史操作 | 请先恢复此题的智能复习 |  | 错误原因<br>[src/fsrs-domain.ts:68](E:/project/MN/src/fsrs-domain.ts:68) |
| P192 | 智能复习反馈、错因或历史操作 | 当前时间早于上次复习，请检查设备时间 |  | 错误原因<br>[src/fsrs-domain.ts:69](E:/project/MN/src/fsrs-domain.ts:69) |
| P193 | 智能复习反馈、错因或历史操作 | 复习记录不存在 |  | 错误原因<br>[src/fsrs-domain.ts:79](E:/project/MN/src/fsrs-domain.ts:79) |
| P194 | 智能复习反馈、错因或历史操作 | 只能更正最后一次反馈 |  | 错误原因<br>[src/fsrs-domain.ts:89](E:/project/MN/src/fsrs-domain.ts:89) |
| P195 | 智能复习反馈、错因或历史操作 | 算法版本已变化，不能重算旧反馈 |  | 错误原因<br>[src/fsrs-domain.ts:91](E:/project/MN/src/fsrs-domain.ts:91) |
| P196 | 智能复习反馈、错因或历史操作 | 请在调试模式中开启 FSRS 智能复习 |  | 错误原因<br>[src/fsrs-service.ts:11](E:/project/MN/src/fsrs-service.ts:11) |
| P197 | 智能复习反馈、错因或历史操作 | 文档目录不可用 |  | 错误原因<br>[src/fsrs-service.ts:14](E:/project/MN/src/fsrs-service.ts:14) |
| P198 | 智能复习反馈、错因或历史操作 | 错题记录不存在，请刷新 |  | 错误原因<br>[src/fsrs-service.ts:62](E:/project/MN/src/fsrs-service.ts:62) |
| P199 | 智能复习反馈、错因或历史操作 | 状态已变化，请刷新后重试 |  | 错误原因<br>[src/fsrs-service.ts:75](E:/project/MN/src/fsrs-service.ts:75) |
| P200 | 智能复习反馈、错因或历史操作 | 未知智能复习命令 |  | 错误原因<br>[src/fsrs-service.ts:77](E:/project/MN/src/fsrs-service.ts:77) |
| P201 | 定位原题或进入焦点模式 | 目标卡片缺少 noteId |  | 错误原因<br>[src/note-navigation.ts:646](E:/project/MN/src/note-navigation.ts:646) |
| P202 | 定位原题或进入焦点模式 | 目标卡片不存在或尚未同步 |  | 错误原因<br>[src/note-navigation.ts:647](E:/project/MN/src/note-navigation.ts:647) |
| P203 | 定位原题或进入焦点模式 | 跳转失败，请检查脑图文档同步模式是否已设为“双向同步”或者“从文档定位到脑图” |  | 错误原因<br>[src/note-navigation.ts:526](E:/project/MN/src/note-navigation.ts:526) |
| P204 | 定位原题或进入焦点模式 | 已发出跳转请求，但 MarginNote 暂未完成响应，请稍候后重试 |  | 错误原因<br>[src/note-navigation.ts:528](E:/project/MN/src/note-navigation.ts:528) |
| P205 | 定位原题或进入焦点模式 | 已定位目标卡片，但未能进入焦点模式，请稍后重试 |  | 错误原因<br>[src/note-navigation.ts:530](E:/project/MN/src/note-navigation.ts:530) |
| P206 | 相关异常转译为通用错误文案 | 答案索引尚未建立或暂时无法读取 |  | 共享错误映射<br>[src/error-messages.ts:12](E:/project/MN/src/error-messages.ts:12) |
| P207 | 相关异常转译为通用错误文案 | 找不到已绑定的答案脑图，可能已被删除 |  | 共享错误映射<br>[src/error-messages.ts:13](E:/project/MN/src/error-messages.ts:13) |
| P208 | 相关异常转译为通用错误文案 | 答案卡片已不存在，请刷新答案索引 |  | 共享错误映射<br>[src/error-messages.ts:14](E:/project/MN/src/error-messages.ts:14) |
| P209 | 相关异常转译为通用错误文案 | 请先绑定答案脑图 |  | 共享错误映射<br>[src/error-messages.ts:15](E:/project/MN/src/error-messages.ts:15) |
| P210 | 相关异常转译为通用错误文案 | 请先选中当前题目脑图中的任一卡片 |  | 共享错误映射<br>[src/error-messages.ts:17](E:/project/MN/src/error-messages.ts:17) |
| P211 | 相关异常转译为通用错误文案 | 原题卡片不存在或尚未同步 |  | 共享错误映射<br>[src/error-messages.ts:18](E:/project/MN/src/error-messages.ts:18) |
| P212 | 相关异常转译为通用错误文案 | 绑定的答案脑图根节点不存在，请重新绑定答案脑图 |  | 共享错误映射<br>[src/error-messages.ts:19](E:/project/MN/src/error-messages.ts:19) |
| P213 | 相关异常转译为通用错误文案 | 未能在绑定答案脑图创建卡片：${params.detail} |  | 共享错误映射<br>[src/error-messages.ts:21](E:/project/MN/src/error-messages.ts:21) |
| P214 | 相关异常转译为通用错误文案 | 未能在绑定答案脑图创建卡片，请重新绑定后重试 |  | 共享错误映射<br>[src/error-messages.ts:22](E:/project/MN/src/error-messages.ts:22) |
| P215 | 相关异常转译为通用错误文案 | 错题记录不存在 |  | 共享错误映射<br>[src/error-messages.ts:23](E:/project/MN/src/error-messages.ts:23) |
| P216 | 相关异常转译为通用错误文案 | ${params.action}失败：未能写入原题标签，请打开原题所在学习集后重试 |  | 共享错误映射<br>[src/error-messages.ts:24](E:/project/MN/src/error-messages.ts:24) |
| P217 | 相关异常转译为通用错误文案 | 该错题的标签已在 MarginNote 内被移除，记录已同步取消 |  | 共享错误映射<br>[src/error-messages.ts:25](E:/project/MN/src/error-messages.ts:25) |
| P218 | 相关异常转译为通用错误文案 | 请先开启调试模式 |  | 共享错误映射<br>[src/error-messages.ts:27](E:/project/MN/src/error-messages.ts:27) |
| P219 | 相关异常转译为通用错误文案 | 网络请求失败：${params.detail} |  | 共享错误映射<br>[src/error-messages.ts:28](E:/project/MN/src/error-messages.ts:28) |
| P220 | 相关异常转译为通用错误文案 | 网络请求失败，请稍后重试 |  | 共享错误映射<br>[src/error-messages.ts:28](E:/project/MN/src/error-messages.ts:28) |
| P221 | 相关异常转译为通用错误文案 | 网络请求超时：${params.detail} |  | 共享错误映射<br>[src/error-messages.ts:29](E:/project/MN/src/error-messages.ts:29) |
| P222 | 相关异常转译为通用错误文案 | 网络请求超时，请稍后重试 |  | 共享错误映射<br>[src/error-messages.ts:29](E:/project/MN/src/error-messages.ts:29) |
| P223 | 相关异常转译为通用错误文案 | 操作超时，请稍后重试 |  | 共享错误映射<br>[src/error-messages.ts:54](E:/project/MN/src/error-messages.ts:54) |
| P224 | 相关异常转译为通用错误文案 | 网络连接失败，请检查网络后重试 |  | 共享错误映射<br>[src/error-messages.ts:55](E:/project/MN/src/error-messages.ts:55) |
| P225 | 相关异常转译为通用错误文案 | 数据解析失败，请刷新索引后重试 |  | 共享错误映射<br>[src/error-messages.ts:56](E:/project/MN/src/error-messages.ts:56) |
| P226 | 相关异常转译为通用错误文案 | 没有执行该操作的权限 |  | 共享错误映射<br>[src/error-messages.ts:57](E:/project/MN/src/error-messages.ts:57) |
| P227 | 相关异常转译为通用错误文案 | 操作失败，请重试；若持续出现请开启调试模式导出日志 |  | 共享错误映射<br>[src/error-messages.ts:60](E:/project/MN/src/error-messages.ts:60) |

## 四、界面标签、反馈说明与等待状态

| 编号 | 触发场景 | 当前原文 | 改成 | 类型与源码位置 |
| --- | --- | --- | --- | --- |
| P228 | 智能复习反馈、错因或历史操作 | 不会 |  | 界面文字／状态<br>[src/review-mode.ts:260](E:/project/MN/src/review-mode.ts:260)<br>[src/review-mode.ts:265](E:/project/MN/src/review-mode.ts:265)<br>[src/fsrs-domain.ts:4](E:/project/MN/src/fsrs-domain.ts:4)<br>[web/src/FsrsReview.jsx:6](E:/project/MN/web/src/FsrsReview.jsx:6) |
| P229 | 智能复习反馈、错因或历史操作 | 不熟 |  | 界面文字／状态<br>[src/review-mode.ts:260](E:/project/MN/src/review-mode.ts:260)<br>[src/review-mode.ts:265](E:/project/MN/src/review-mode.ts:265)<br>[src/fsrs-domain.ts:4](E:/project/MN/src/fsrs-domain.ts:4)<br>[web/src/FsrsReview.jsx:6](E:/project/MN/web/src/FsrsReview.jsx:6) |
| P230 | 智能复习反馈、错因或历史操作 | 良好 |  | 界面文字／状态<br>[src/review-mode.ts:260](E:/project/MN/src/review-mode.ts:260)<br>[src/fsrs-domain.ts:4](E:/project/MN/src/fsrs-domain.ts:4)<br>[web/src/FsrsReview.jsx:6](E:/project/MN/web/src/FsrsReview.jsx:6) |
| P231 | 智能复习反馈、错因或历史操作 | 掌握 |  | 界面文字／状态<br>[src/review-mode.ts:260](E:/project/MN/src/review-mode.ts:260)<br>[src/review-mode.ts:265](E:/project/MN/src/review-mode.ts:265)<br>[src/fsrs-domain.ts:4](E:/project/MN/src/fsrs-domain.ts:4)<br>[web/src/FsrsReview.jsx:6](E:/project/MN/web/src/FsrsReview.jsx:6) |
| P232 | 会话工具条、反馈、分类或结果报告 | 跳过 |  | 界面文字／状态<br>[src/review-mode.ts:262](E:/project/MN/src/review-mode.ts:262) |
| P233 | 会话工具条、反馈、分类或结果报告 | ${name} · 约 ${item.preview?.[index]?.days ?? '—'} 天 |  | 界面文字／状态<br>[src/review-mode.ts:262](E:/project/MN/src/review-mode.ts:262) |
| P234 | 会话工具条、反馈、分类或结果报告 | +${days}天 |  | 界面文字／状态<br>[src/review-mode.ts:274](E:/project/MN/src/review-mode.ts:274) |
| P235 | 会话工具条、反馈、分类或结果报告 | 重试保存手写并继续 |  | 界面文字／状态<br>[src/review-mode.ts:283](E:/project/MN/src/review-mode.ts:283) |
| P236 | 会话工具条、反馈、分类或结果报告 | 批注窗口已关闭？恢复操作 |  | 界面文字／状态<br>[src/review-mode.ts:283](E:/project/MN/src/review-mode.ts:283) |
| P237 | 会话工具条、反馈、分类或结果报告 | 待切换 · ${row.title} |  | 界面文字／状态<br>[src/review-mode.ts:321](E:/project/MN/src/review-mode.ts:321) |
| P238 | 会话工具条、反馈、分类或结果报告 | 当前 · ${row.title} |  | 界面文字／状态<br>[src/review-mode.ts:321](E:/project/MN/src/review-mode.ts:321) |
| P239 | 会话工具条、反馈、分类或结果报告 | 复习反馈 |  | 界面文字／状态<br>[src/review-mode.ts:464](E:/project/MN/src/review-mode.ts:464)<br>[src/review-mode.ts:478](E:/project/MN/src/review-mode.ts:478) |
| P240 | 会话工具条、反馈、分类或结果报告 | 打开 CardLink |  | 界面文字／状态<br>[src/review-mode.ts:468](E:/project/MN/src/review-mode.ts:468) |
| P241 | 会话工具条、反馈、分类或结果报告 | 第 ${current.index + 1} 题，共 ${current.items.length} 题 |  | 界面文字／状态<br>[src/review-mode.ts:469](E:/project/MN/src/review-mode.ts:469) |
| P242 | 会话工具条、反馈、分类或结果报告 | 上一题 |  | 界面文字／状态<br>[src/review-mode.ts:470](E:/project/MN/src/review-mode.ts:470) |
| P243 | 会话工具条、反馈、分类或结果报告 | 查找当前卡片答案 |  | 界面文字／状态<br>[src/review-mode.ts:472](E:/project/MN/src/review-mode.ts:472) |
| P244 | 会话工具条、反馈、分类或结果报告 | 收起分类 |  | 界面文字／状态<br>[src/review-mode.ts:473](E:/project/MN/src/review-mode.ts:473) |
| P245 | 会话工具条、反馈、分类或结果报告 | 分类索引 |  | 界面文字／状态<br>[src/review-mode.ts:473](E:/project/MN/src/review-mode.ts:473) |
| P246 | 会话工具条、反馈、分类或结果报告 | 结束做题 |  | 界面文字／状态<br>[src/review-mode.ts:474](E:/project/MN/src/review-mode.ts:474) |
| P247 | 会话工具条、反馈、分类或结果报告 | 退出复习 |  | 界面文字／状态<br>[src/review-mode.ts:474](E:/project/MN/src/review-mode.ts:474) |
| P248 | 历史作答窗口加载、查看或继续作答 | 历史作答 |  | 界面文字／状态<br>[src/review-mode.ts:476](E:/project/MN/src/review-mode.ts:476)<br>[src/practice-history.ts:26](E:/project/MN/src/practice-history.ts:26)<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P249 | 标记、复测或定位记录的校验／保存 | 标记错题 |  | 界面文字／状态<br>[src/review-mode.ts:478](E:/project/MN/src/review-mode.ts:478)<br>[src/mistake-manager.ts:545](E:/project/MN/src/mistake-manager.ts:545) |
| P250 | 会话工具条、反馈、分类或结果报告 | 第 ${current.index + 1} 题 |  | 界面文字／状态<br>[src/review-mode.ts:541](E:/project/MN/src/review-mode.ts:541)<br>[src/review-mode.ts:581](E:/project/MN/src/review-mode.ts:581) |
| P251 | 会话工具条、反馈、分类或结果报告 | ${config?.reason \|\| '当前模板未配置原生作答判定'}。请导入带 CardLink 配置的场景模板后重试 |  | 界面文字／状态<br>[src/review-mode.ts:743](E:/project/MN/src/review-mode.ts:743) |
| P252 | 会话工具条、反馈、分类或结果报告 | 当前模板未配置原生作答判定 |  | 界面文字／状态<br>[src/review-mode.ts:743](E:/project/MN/src/review-mode.ts:743) |
| P253 | 会话工具条、反馈、分类或结果报告 | 当前宿主未提供可用的手写会话 |  | 界面文字／状态<br>[src/review-mode.ts:744](E:/project/MN/src/review-mode.ts:744) |
| P254 | 会话工具条、反馈、分类或结果报告 | ${writingMode === 'annotation' ? '模板配置' : '手写会话能力'}检测失败：${String((error as Error)?.message \|\| error)} |  | 界面文字／状态<br>[src/review-mode.ts:750](E:/project/MN/src/review-mode.ts:750) |
| P255 | 会话工具条、反馈、分类或结果报告 | 模板配置 |  | 界面文字／状态<br>[src/review-mode.ts:750](E:/project/MN/src/review-mode.ts:750) |
| P256 | 会话工具条、反馈、分类或结果报告 | 手写会话能力 |  | 界面文字／状态<br>[src/review-mode.ts:750](E:/project/MN/src/review-mode.ts:750) |
| P257 | 会话工具条、反馈、分类或结果报告 | 未命名节点 |  | 界面文字／状态<br>[src/review-mode.ts:760](E:/project/MN/src/review-mode.ts:760) |
| P258 | 会话工具条、反馈、分类或结果报告 | 题目定位或答案遮盖未完成 |  | 界面文字／状态<br>[src/review-mode.ts:819](E:/project/MN/src/review-mode.ts:819) |
| P259 | 会话工具条、反馈、分类或结果报告 | 批注窗口尚未确认打开，请先恢复窗口状态 |  | 界面文字／状态<br>[src/review-mode.ts:819](E:/project/MN/src/review-mode.ts:819) |
| P260 | 会话工具条、反馈、分类或结果报告 | 未命名题目 |  | 界面文字／状态<br>[src/review-mode.ts:831](E:/project/MN/src/review-mode.ts:831) |
| P261 | 会话工具条、反馈、分类或结果报告 | 未命名学习集 |  | 界面文字／状态<br>[src/review-mode.ts:831](E:/project/MN/src/review-mode.ts:831) |
| P262 | 会话工具条、反馈、分类或结果报告 | 切换到第 ${intent.index! + 1} 题 |  | 界面文字／状态<br>[src/review-mode.ts:956](E:/project/MN/src/review-mode.ts:956) |
| P263 | 会话工具条、反馈、分类或结果报告 | 退出 |  | 界面文字／状态<br>[src/review-mode.ts:956](E:/project/MN/src/review-mode.ts:956) |
| P264 | 会话工具条、反馈、分类或结果报告 | 切换下一题 |  | 界面文字／状态<br>[src/review-mode.ts:956](E:/project/MN/src/review-mode.ts:956) |
| P265 | 会话工具条、反馈、分类或结果报告 | 错因：${reason.label} |  | 界面文字／状态<br>[src/review-mode.ts:1408](E:/project/MN/src/review-mode.ts:1408) |
| P266 | 选择不会／不熟后的错因选择 | 概念不清 |  | 界面文字／状态<br>[src/error-reasons.ts:5](E:/project/MN/src/error-reasons.ts:5)<br>[src/fsrs-domain.ts:6](E:/project/MN/src/fsrs-domain.ts:6)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P267 | 选择不会／不熟后的错因选择 | 公式遗忘 |  | 界面文字／状态<br>[src/error-reasons.ts:5](E:/project/MN/src/error-reasons.ts:5)<br>[src/fsrs-domain.ts:6](E:/project/MN/src/fsrs-domain.ts:6)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P268 | 选择不会／不熟后的错因选择 | 思路受阻 |  | 界面文字／状态<br>[src/error-reasons.ts:6](E:/project/MN/src/error-reasons.ts:6)<br>[src/fsrs-domain.ts:6](E:/project/MN/src/fsrs-domain.ts:6)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P269 | 选择不会／不熟后的错因选择 | 计算失误 |  | 界面文字／状态<br>[src/error-reasons.ts:6](E:/project/MN/src/error-reasons.ts:6)<br>[src/fsrs-domain.ts:7](E:/project/MN/src/fsrs-domain.ts:7)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P270 | 选择不会／不熟后的错因选择 | 审题遗漏 |  | 界面文字／状态<br>[src/error-reasons.ts:7](E:/project/MN/src/error-reasons.ts:7)<br>[src/fsrs-domain.ts:7](E:/project/MN/src/fsrs-domain.ts:7)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P271 | 选择不会／不熟后的错因选择 | 时间不足 |  | 界面文字／状态<br>[src/error-reasons.ts:7](E:/project/MN/src/error-reasons.ts:7)<br>[src/fsrs-domain.ts:7](E:/project/MN/src/fsrs-domain.ts:7)<br>[web/src/FsrsReview.jsx:7](E:/project/MN/web/src/FsrsReview.jsx:7) |
| P272 | 脑图做题定位、遮盖或切题 | 答案已遮盖 |  | 界面文字／状态<br>[src/same-map-practice.ts:178](E:/project/MN/src/same-map-practice.ts:178) |
| P273 | 历史作答窗口加载、查看或继续作答 | 第 ${row.ordinal} 次作答 |  | 界面文字／状态<br>[src/practice-history.ts:26](E:/project/MN/src/practice-history.ts:26) |
| P274 | 历史作答窗口加载、查看或继续作答 | 无法读取这次作答的图片，请在原卡片查看。 |  | 界面文字／状态<br>[src/practice-history.ts:27](E:/project/MN/src/practice-history.ts:27) |
| P275 | 历史作答窗口加载、查看或继续作答 | 日期未记录 |  | 界面文字／状态<br>[src/practice-history.ts:97](E:/project/MN/src/practice-history.ts:97) |
| P276 | 历史作答窗口加载、查看或继续作答 | 会了 |  | 界面文字／状态<br>[src/practice-history.ts:98](E:/project/MN/src/practice-history.ts:98) |
| P277 | 历史作答窗口加载、查看或继续作答 | 还要练 |  | 界面文字／状态<br>[src/practice-history.ts:98](E:/project/MN/src/practice-history.ts:98) |
| P278 | 历史作答窗口加载、查看或继续作答 | 未反馈 |  | 界面文字／状态<br>[src/practice-history.ts:98](E:/project/MN/src/practice-history.ts:98) |
| P279 | 历史作答窗口加载、查看或继续作答 | 第 ${row.ordinal} 次 ${feedback}${escapeHtml(date)}${escapeHtml(row.practice.reasonLabel \|\| '未记录错因')}${checked === undefined ? '对答案状态未记录' : checked ? '已查看答案' : '未查看答案'} |  | 界面文字／状态<br>[src/practice-history.ts:100](E:/project/MN/src/practice-history.ts:100) |
| P280 | 历史作答窗口加载、查看或继续作答 | 未记录错因 |  | 界面文字／状态<br>[src/practice-history.ts:100](E:/project/MN/src/practice-history.ts:100) |
| P281 | 历史作答窗口加载、查看或继续作答 | 对答案状态未记录 |  | 界面文字／状态<br>[src/practice-history.ts:100](E:/project/MN/src/practice-history.ts:100) |
| P282 | 历史作答窗口加载、查看或继续作答 | 已查看答案 |  | 界面文字／状态<br>[src/practice-history.ts:100](E:/project/MN/src/practice-history.ts:100) |
| P283 | 历史作答窗口加载、查看或继续作答 | 未查看答案 |  | 界面文字／状态<br>[src/practice-history.ts:100](E:/project/MN/src/practice-history.ts:100) |
| P284 | 历史作答窗口加载、查看或继续作答 | 暂无已保存作答 |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105)<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P285 | 历史作答窗口加载、查看或继续作答 | 正在读取作答… |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105)<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P286 | 场景面板或桥接请求状态检查 | 加载启动资源 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:89](E:/project/MN/rails-native/SceneWorkbench.js:89) |
| P287 | 场景面板或桥接请求状态检查 | 场景面板已关闭 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:92](E:/project/MN/rails-native/SceneWorkbench.js:92) |
| P288 | 场景面板或桥接请求状态检查 | 读取版本后检测场景状态 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:94](E:/project/MN/rails-native/SceneWorkbench.js:94) |
| P289 | 场景面板或桥接请求状态检查 | 加载并渲染工作台脚本 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:102](E:/project/MN/rails-native/SceneWorkbench.js:102) |
| P290 | 场景面板或桥接请求状态检查 | 新面板要求软件 4.5.0 及以上，并处于场景页面 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:133](E:/project/MN/rails-native/SceneWorkbench.js:133) |
| P291 | 场景面板或桥接请求状态检查 | 未知场景消息 |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:199](E:/project/MN/rails-native/SceneWorkbench.js:199) |
| P292 | 场景面板或桥接请求状态检查 | 启动超时： |  | 界面文字／状态<br>[rails-native/SceneWorkbench.js:209](E:/project/MN/rails-native/SceneWorkbench.js:209) |
| P293 | 做题入口、队列准备或模式选择 | 做题模式 |  | 界面文字／状态<br>[src/mnutils-entrance.ts:1182](E:/project/MN/src/mnutils-entrance.ts:1182) |
| P294 | 做题入口、队列准备或模式选择 | 摘题模式 |  | 界面文字／状态<br>[src/mnutils-entrance.ts:1182](E:/project/MN/src/mnutils-entrance.ts:1182) |
| P295 | 做题入口、队列准备或模式选择 | 没有可开始的题目 |  | 界面文字／状态<br>[src/mnutils-entrance.ts:1250](E:/project/MN/src/mnutils-entrance.ts:1250) |
| P296 | 复习方式选择或工作台命令检查 | 当前错题没有可定位的答案卡片 |  | 界面文字／状态<br>[src/rails-core.ts:318](E:/project/MN/src/rails-core.ts:318) |
| P297 | 当前题查答案或卡片标记入口 | ${notebookTitle(target.notebookId)} › ${target.rootNodeId === MAIN_MINDMAP_SCOPE_ID ? "主脑图" : rootTitle \|\| target.rootTitle \|\| "未命名子脑图"} |  | 界面文字／状态<br>[src/plugin.ts:1404](E:/project/MN/src/plugin.ts:1404) |
| P298 | 当前题查答案或卡片标记入口 | 主脑图 |  | 界面文字／状态<br>[src/plugin.ts:1404](E:/project/MN/src/plugin.ts:1404) |
| P299 | 当前题查答案或卡片标记入口 | 未命名子脑图 |  | 界面文字／状态<br>[src/plugin.ts:1404](E:/project/MN/src/plugin.ts:1404) |
| P300 | 当前题查答案或卡片标记入口 | 正在刷新答案索引… |  | 界面文字／状态<br>[src/plugin.ts:1409](E:/project/MN/src/plugin.ts:1409) |
| P301 | 当前题查答案或卡片标记入口 | 当前卡片没有固定顺序配对，也未找到同标题答案：${questionTitle} |  | 界面文字／状态<br>[src/plugin.ts:1486](E:/project/MN/src/plugin.ts:1486) |
| P302 | 当前题查答案或卡片标记入口 | 题目规则未提取到可匹配键，或答案规则没有对应结果：${questionTitle} |  | 界面文字／状态<br>[src/plugin.ts:1488](E:/project/MN/src/plugin.ts:1488) |
| P303 | 当前题查答案或卡片标记入口 | 未找到同标题答案：${questionTitle} |  | 界面文字／状态<br>[src/plugin.ts:1489](E:/project/MN/src/plugin.ts:1489) |
| P304 | 当前题查答案或卡片标记入口 | 尚未记录 |  | 界面文字／状态<br>[src/plugin.ts:1494](E:/project/MN/src/plugin.ts:1494) |
| P305 | 当前题查答案或卡片标记入口 | 正在刷新答案索引并重试… |  | 界面文字／状态<br>[src/plugin.ts:1506](E:/project/MN/src/plugin.ts:1506) |
| P306 | 当前题查答案或卡片标记入口 | 生命周期 |  | 界面文字／状态<br>[src/plugin.ts:1540](E:/project/MN/src/plugin.ts:1540)<br>[src/plugin.ts:1606](E:/project/MN/src/plugin.ts:1606) |
| P307 | 当前题查答案或卡片标记入口 | 新增 ${result.added} 道 |  | 界面文字／状态<br>[src/plugin.ts:1600](E:/project/MN/src/plugin.ts:1600) |
| P308 | 当前题查答案或卡片标记入口 | 更新 ${result.updated} 道 |  | 界面文字／状态<br>[src/plugin.ts:1600](E:/project/MN/src/plugin.ts:1600) |
| P309 | 当前题查答案或卡片标记入口 | 失败 ${result.failed} 道 |  | 界面文字／状态<br>[src/plugin.ts:1601](E:/project/MN/src/plugin.ts:1601) |
| P310 | 标记、复测或定位记录的校验／保存 | 未命名错题 |  | 界面文字／状态<br>[src/mistake-manager.ts:521](E:/project/MN/src/mistake-manager.ts:521)<br>[src/mistake-manager.ts:609](E:/project/MN/src/mistake-manager.ts:609) |
| P311 | 标记、复测或定位记录的校验／保存 | 错题管理 |  | 界面文字／状态<br>[src/mistake-manager.ts:627](E:/project/MN/src/mistake-manager.ts:627)<br>[src/mistake-manager.ts:642](E:/project/MN/src/mistake-manager.ts:642) |
| P312 | 标记、复测或定位记录的校验／保存 | 批量标记错题 |  | 界面文字／状态<br>[src/mistake-manager.ts:634](E:/project/MN/src/mistake-manager.ts:634) |
| P313 | 标记、复测或定位记录的校验／保存 | 错题复习 |  | 界面文字／状态<br>[src/mistake-manager.ts:720](E:/project/MN/src/mistake-manager.ts:720) |
| P314 | 标记、复测或定位记录的校验／保存 | 复习 |  | 界面文字／状态<br>[src/mistake-manager.ts:725](E:/project/MN/src/mistake-manager.ts:725) |
| P315 | 标记、复测或定位记录的校验／保存 | 批量复习错题 |  | 界面文字／状态<br>[src/mistake-manager.ts:809](E:/project/MN/src/mistake-manager.ts:809) |
| P316 | 智能复习反馈、错因或历史操作 | ${root}/FSRS智能复习备份.json |  | 界面文字／状态<br>[src/fsrs-service.ts:17](E:/project/MN/src/fsrs-service.ts:17) |
| P317 | 智能复习反馈、错因或历史操作 | 这次卡在哪里？ |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:12](E:/project/MN/web/src/FsrsReview.jsx:12) |
| P318 | 智能复习反馈、错因或历史操作 | 选填 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:12](E:/project/MN/web/src/FsrsReview.jsx:12) |
| P319 | 智能复习反馈、错因或历史操作 | 错因备注 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:14](E:/project/MN/web/src/FsrsReview.jsx:14) |
| P320 | 智能复习反馈、错因或历史操作 | 补充一句，方便下次回顾… |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:14](E:/project/MN/web/src/FsrsReview.jsx:14) |
| P321 | 智能复习反馈、错因或历史操作 | 取消 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:15](E:/project/MN/web/src/FsrsReview.jsx:15) |
| P322 | 智能复习反馈、错因或历史操作 | 保存反馈 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:15](E:/project/MN/web/src/FsrsReview.jsx:15) |
| P323 | 智能复习反馈、错因或历史操作 | 正在读取复习记录… |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:51](E:/project/MN/web/src/FsrsReview.jsx:51) |
| P324 | 智能复习反馈、错因或历史操作 | 正在读取历史… |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:67](E:/project/MN/web/src/FsrsReview.jsx:67) |
| P325 | 智能复习反馈、错因或历史操作 | 暂无复测记录 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:68](E:/project/MN/web/src/FsrsReview.jsx:68)<br>[web/src/main.jsx:2305](E:/project/MN/web/src/main.jsx:2305) |
| P326 | 智能复习反馈、错因或历史操作 | 错因与反馈更正 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:69](E:/project/MN/web/src/FsrsReview.jsx:69) |
| P327 | 智能复习反馈、错因或历史操作 | 错因未填写 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:70](E:/project/MN/web/src/FsrsReview.jsx:70) |
| P328 | 智能复习反馈、错因或历史操作 | 修改错因 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:71](E:/project/MN/web/src/FsrsReview.jsx:71) |
| P329 | 智能复习反馈、错因或历史操作 | 更正末次反馈 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:72](E:/project/MN/web/src/FsrsReview.jsx:72) |
| P330 | 智能复习反馈、错因或历史操作 | 更正最后一次反馈 |  | 界面文字／状态<br>[web/src/FsrsReview.jsx:72](E:/project/MN/web/src/FsrsReview.jsx:72) |
| P331 | 待复习页面、时间轴或答案查看 | 复测历史蛇形时间轴 |  | 界面文字／状态<br>[web/src/main.jsx:1914](E:/project/MN/web/src/main.jsx:1914) |
| P332 | 待复习页面、时间轴或答案查看 | 错因：${entry.errorReason.label} |  | 界面文字／状态<br>[web/src/main.jsx:1921](E:/project/MN/web/src/main.jsx:1921) |
| P333 | 待复习页面、时间轴或答案查看 | 错因： |  | 界面文字／状态<br>[web/src/main.jsx:1921](E:/project/MN/web/src/main.jsx:1921) |
| P334 | 待复习页面、时间轴或答案查看 | 答案预览 |  | 界面文字／状态<br>[web/src/main.jsx:1931](E:/project/MN/web/src/main.jsx:1931) |
| P335 | 待复习页面、时间轴或答案查看 | 答案缩放 |  | 界面文字／状态<br>[web/src/main.jsx:1931](E:/project/MN/web/src/main.jsx:1931) |
| P336 | 待复习页面、时间轴或答案查看 | 缩小答案 |  | 界面文字／状态<br>[web/src/main.jsx:1931](E:/project/MN/web/src/main.jsx:1931) |
| P337 | 待复习页面、时间轴或答案查看 | 恢复答案原始大小 |  | 界面文字／状态<br>[web/src/main.jsx:1931](E:/project/MN/web/src/main.jsx:1931) |
| P338 | 待复习页面、时间轴或答案查看 | 放大答案 |  | 界面文字／状态<br>[web/src/main.jsx:1931](E:/project/MN/web/src/main.jsx:1931) |
| P339 | 待复习页面、时间轴或答案查看 | ${title}答案 |  | 界面文字／状态<br>[web/src/main.jsx:1933](E:/project/MN/web/src/main.jsx:1933) |
| P340 | 待复习页面、时间轴或答案查看 | 来源脑图尚未绑定答案 |  | 界面文字／状态<br>[web/src/main.jsx:1933](E:/project/MN/web/src/main.jsx:1933) |
| P341 | 待复习页面、时间轴或答案查看 | 答案按原题脑图当前绑定实时查询。 |  | 界面文字／状态<br>[web/src/main.jsx:1933](E:/project/MN/web/src/main.jsx:1933) |
| P342 | 待复习页面、时间轴或答案查看 | 本次结果：掌握 · 连续第二次确认，已结束自动复习并保留错题记录。 |  | 界面文字／状态<br>[web/src/main.jsx:2224](E:/project/MN/web/src/main.jsx:2224) |
| P343 | 待复习页面、时间轴或答案查看 | 本次结果：${levelNames[level]} · ${nextDays(item, level)} 天后再次复测。 |  | 界面文字／状态<br>[web/src/main.jsx:2225](E:/project/MN/web/src/main.jsx:2225) |
| P344 | 待复习页面、时间轴或答案查看 | 已恢复复习计划，下次复测时间为 ${formatDate(result.nextReviewAt)}。 |  | 界面文字／状态<br>[web/src/main.jsx:2232](E:/project/MN/web/src/main.jsx:2232) |
| P345 | 待复习页面、时间轴或答案查看 | 逾期池已经清空。 |  | 界面文字／状态<br>[web/src/main.jsx:2248](E:/project/MN/web/src/main.jsx:2248) |
| P346 | 待复习页面、时间轴或答案查看 | 已从逾期池加入 ${result.addedCount} 道题到今日队列。 |  | 界面文字／状态<br>[web/src/main.jsx:2251](E:/project/MN/web/src/main.jsx:2251) |
| P347 | 待复习页面、时间轴或答案查看 | 计划到期状态 |  | 界面文字／状态<br>[web/src/main.jsx:2255](E:/project/MN/web/src/main.jsx:2255) |
| P348 | 待复习页面、时间轴或答案查看 | 今日到期 |  | 界面文字／状态<br>[web/src/main.jsx:2256](E:/project/MN/web/src/main.jsx:2256) |
| P349 | 待复习页面、时间轴或答案查看 | 已逾期 |  | 界面文字／状态<br>[web/src/main.jsx:2256](E:/project/MN/web/src/main.jsx:2256) |
| P350 | 待复习页面、时间轴或答案查看 | 未到期 |  | 界面文字／状态<br>[web/src/main.jsx:2256](E:/project/MN/web/src/main.jsx:2256) |
| P351 | 待复习页面、时间轴或答案查看 | 已暂停 |  | 界面文字／状态<br>[web/src/main.jsx:2256](E:/project/MN/web/src/main.jsx:2256)<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P352 | 待复习页面、时间轴或答案查看 | 已结束 |  | 界面文字／状态<br>[web/src/main.jsx:2256](E:/project/MN/web/src/main.jsx:2256)<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P353 | 待复习页面、时间轴或答案查看 | 收起筛选 |  | 界面文字／状态<br>[web/src/main.jsx:2259](E:/project/MN/web/src/main.jsx:2259) |
| P354 | 待复习页面、时间轴或答案查看 | 展开筛选 |  | 界面文字／状态<br>[web/src/main.jsx:2259](E:/project/MN/web/src/main.jsx:2259) |
| P355 | 待复习页面、时间轴或答案查看 | 排序 |  | 界面文字／状态<br>[web/src/main.jsx:2260](E:/project/MN/web/src/main.jsx:2260) |
| P356 | 待复习页面、时间轴或答案查看 | 收起全部题目 |  | 界面文字／状态<br>[web/src/main.jsx:2262](E:/project/MN/web/src/main.jsx:2262) |
| P357 | 待复习页面、时间轴或答案查看 | 展开全部题目 |  | 界面文字／状态<br>[web/src/main.jsx:2262](E:/project/MN/web/src/main.jsx:2262) |
| P358 | 待复习页面、时间轴或答案查看 | 排序方式 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P359 | 待复习页面、时间轴或答案查看 | 最后复习 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P360 | 待复习页面、时间轴或答案查看 | 最近优先 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P361 | 待复习页面、时间轴或答案查看 | 脑图 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P362 | 待复习页面、时间轴或答案查看 | 名称顺序 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P363 | 待复习页面、时间轴或答案查看 | 添加日期 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P364 | 待复习页面、时间轴或答案查看 | 最新优先 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P365 | 待复习页面、时间轴或答案查看 | 等级 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P366 | 待复习页面、时间轴或答案查看 | 由低到高 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P367 | 待复习页面、时间轴或答案查看 | 剩余天数 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P368 | 待复习页面、时间轴或答案查看 | 由少到多 |  | 界面文字／状态<br>[web/src/main.jsx:2264](E:/project/MN/web/src/main.jsx:2264) |
| P369 | 待复习页面、时间轴或答案查看 | 今日任务量不够？ |  | 界面文字／状态<br>[web/src/main.jsx:2268](E:/project/MN/web/src/main.jsx:2268) |
| P370 | 待复习页面、时间轴或答案查看 | 从逾期池随机补充： |  | 界面文字／状态<br>[web/src/main.jsx:2268](E:/project/MN/web/src/main.jsx:2268) |
| P371 | 待复习页面、时间轴或答案查看 | 题 |  | 界面文字／状态<br>[web/src/main.jsx:2268](E:/project/MN/web/src/main.jsx:2268) |
| P372 | 待复习页面、时间轴或答案查看 | 当前队列没有题目 |  | 界面文字／状态<br>[web/src/main.jsx:2272](E:/project/MN/web/src/main.jsx:2272) |
| P373 | 待复习页面、时间轴或答案查看 | 可以切换其他复习状态或掌握等级查看。 |  | 界面文字／状态<br>[web/src/main.jsx:2272](E:/project/MN/web/src/main.jsx:2272) |
| P374 | 待复习页面、时间轴或答案查看 | 今天到期 |  | 界面文字／状态<br>[web/src/main.jsx:2280](E:/project/MN/web/src/main.jsx:2280) |
| P375 | 待复习页面、时间轴或答案查看 | 已逾期 ${Math.max(1, Math.ceil((startToday - new Date(item.nextReviewAt).getTime()) / 86400000))} 天 |  | 界面文字／状态<br>[web/src/main.jsx:2281](E:/project/MN/web/src/main.jsx:2281) |
| P376 | 待复习页面、时间轴或答案查看 | 已暂停智能复习 |  | 界面文字／状态<br>[web/src/main.jsx:2283](E:/project/MN/web/src/main.jsx:2283) |
| P377 | 待复习页面、时间轴或答案查看 | 掌握 · 连续 2 次确认 |  | 界面文字／状态<br>[web/src/main.jsx:2283](E:/project/MN/web/src/main.jsx:2283) |
| P378 | 待复习页面、时间轴或答案查看 | 第 ${item.reviewCount + 1} 次复测 · ${dueText} |  | 界面文字／状态<br>[web/src/main.jsx:2283](E:/project/MN/web/src/main.jsx:2283) |
| P379 | 待复习页面、时间轴或答案查看 | 待反馈 |  | 界面文字／状态<br>[web/src/main.jsx:2286](E:/project/MN/web/src/main.jsx:2286) |
| P380 | 待复习页面、时间轴或答案查看 | 错题标签 |  | 界面文字／状态<br>[web/src/main.jsx:2287](E:/project/MN/web/src/main.jsx:2287) |
| P381 | 待复习页面、时间轴或答案查看 | 收起 ${item.sourceTitle} 的题目预览 |  | 界面文字／状态<br>[web/src/main.jsx:2288](E:/project/MN/web/src/main.jsx:2288) |
| P382 | 待复习页面、时间轴或答案查看 | 展开 ${item.sourceTitle} 的题目预览 |  | 界面文字／状态<br>[web/src/main.jsx:2288](E:/project/MN/web/src/main.jsx:2288) |
| P383 | 待复习页面、时间轴或答案查看 | 完整原题 |  | 界面文字／状态<br>[web/src/main.jsx:2291](E:/project/MN/web/src/main.jsx:2291) |
| P384 | 待复习页面、时间轴或答案查看 | ${item.sourceTitle}完整原题 |  | 界面文字／状态<br>[web/src/main.jsx:2291](E:/project/MN/web/src/main.jsx:2291) |
| P385 | 待复习页面、时间轴或答案查看 | 读取完整原题失败。 |  | 界面文字／状态<br>[web/src/main.jsx:2291](E:/project/MN/web/src/main.jsx:2291) |
| P386 | 待复习页面、时间轴或答案查看 | 重试 |  | 界面文字／状态<br>[web/src/main.jsx:2291](E:/project/MN/web/src/main.jsx:2291) |
| P387 | 待复习页面、时间轴或答案查看 | 正在读取完整原题… |  | 界面文字／状态<br>[web/src/main.jsx:2291](E:/project/MN/web/src/main.jsx:2291) |
| P388 | 待复习页面、时间轴或答案查看 | 正在切换学习集并定位原题，请稍候… |  | 界面文字／状态<br>[web/src/main.jsx:2293](E:/project/MN/web/src/main.jsx:2293) |
| P389 | 待复习页面、时间轴或答案查看 | 定位原题 |  | 界面文字／状态<br>[web/src/main.jsx:2297](E:/project/MN/web/src/main.jsx:2297) |
| P390 | 待复习页面、时间轴或答案查看 | 读取答案… |  | 界面文字／状态<br>[web/src/main.jsx:2298](E:/project/MN/web/src/main.jsx:2298) |
| P391 | 待复习页面、时间轴或答案查看 | 收起答案 |  | 界面文字／状态<br>[web/src/main.jsx:2298](E:/project/MN/web/src/main.jsx:2298) |
| P392 | 待复习页面、时间轴或答案查看 | 查看答案 |  | 界面文字／状态<br>[web/src/main.jsx:2298](E:/project/MN/web/src/main.jsx:2298) |
| P393 | 待复习页面、时间轴或答案查看 | 收起复测历史 |  | 界面文字／状态<br>[web/src/main.jsx:2299](E:/project/MN/web/src/main.jsx:2299) |
| P394 | 待复习页面、时间轴或答案查看 | 复测历史 (${item.historyCount ?? item.history?.length ?? 0}) |  | 界面文字／状态<br>[web/src/main.jsx:2299](E:/project/MN/web/src/main.jsx:2299) |
| P395 | 待复习页面、时间轴或答案查看 | 书写 ${item.sourceTitle} |  | 界面文字／状态<br>[web/src/main.jsx:2300](E:/project/MN/web/src/main.jsx:2300) |
| P396 | 待复习页面、时间轴或答案查看 | 直接打开该题的整卡批注面板 |  | 界面文字／状态<br>[web/src/main.jsx:2300](E:/project/MN/web/src/main.jsx:2300) |
| P397 | 待复习页面、时间轴或答案查看 | 手写未启用，点击查看原因 |  | 界面文字／状态<br>[web/src/main.jsx:2300](E:/project/MN/web/src/main.jsx:2300) |
| P398 | 待复习页面、时间轴或答案查看 | 恢复复习计划 |  | 界面文字／状态<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P399 | 待复习页面、时间轴或答案查看 | 本次复测结果 |  | 界面文字／状态<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P400 | 待复习页面、时间轴或答案查看 | 结束 |  | 界面文字／状态<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P401 | 待复习页面、时间轴或答案查看 | +${nextDays(item, level)} 天 |  | 界面文字／状态<br>[web/src/main.jsx:2301](E:/project/MN/web/src/main.jsx:2301) |
| P402 | 待复习页面、时间轴或答案查看 | 复测历史 |  | 界面文字／状态<br>[web/src/main.jsx:2305](E:/project/MN/web/src/main.jsx:2305) |
| P403 | 定位原题或进入焦点模式 | 已确认切换到目标学习集 |  | 界面文字／状态<br>[src/note-navigation.ts:632](E:/project/MN/src/note-navigation.ts:632) |
| P404 | 定位原题或进入焦点模式 | 等待目标学习集超时；保留 pending 供 notebookWillOpen 延迟接力 |  | 界面文字／状态<br>[src/note-navigation.ts:637](E:/project/MN/src/note-navigation.ts:637) |
| P405 | 定位原题或进入焦点模式 | 上一条定位请求仍在处理中，请稍候 |  | 界面文字／状态<br>[src/note-navigation.ts:652](E:/project/MN/src/note-navigation.ts:652) |
| P406 | 历史作答窗口加载、查看或继续作答 | 从当前批注继续 |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P407 | 历史作答窗口加载、查看或继续作答 | 关闭 |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P408 | 历史作答窗口加载、查看或继续作答 | 收起作答列表 |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
| P409 | 历史作答窗口加载、查看或继续作答 | 拖动调节窗口大小，方向键微调 |  | 界面文字／状态<br>[src/practice-history.ts:105](E:/project/MN/src/practice-history.ts:105) |
## 源码范围与说明

- `src/review-mode.ts`：相关模块全文
- `src/error-reasons.ts`：相关模块全文
- `src/same-map-practice.ts`：相关模块全文
- `src/practice-history.ts`：相关模块全文
- `web/annotation-client.js`：相关模块全文
- `web/src/lib/writingSession.js`：相关模块全文
- `web/src/lib/sceneTransport.js`：仅做题／复习相关片段 1–133、159–250
- `rails-native/SceneWorkbench.js`：相关模块全文
- `src/mnutils-entrance.ts`：仅做题／复习相关片段 415–450、1180–1265
- `src/rails-core.ts`：仅做题／复习相关片段 125–166、300–319、333–349
- `src/plugin.ts`：仅做题／复习相关片段 1390–1577、1580–1688
- `src/mistake-manager.ts`：仅做题／复习相关片段 64–72、499–570、575–659、698–845、1480–1505
- `src/card-menu.ts`：相关模块全文
- `src/fsrs-domain.ts`：相关模块全文
- `src/fsrs-service.ts`：相关模块全文
- `web/src/FsrsReview.jsx`：仅做题／复习相关片段 1–76
- `web/src/main.jsx`：仅做题／复习相关片段 1850–1935、2200–2320
- `src/note-navigation.ts`：仅做题／复习相关片段 632–661

- `src/level-picker.ts`：标记错题等级选择框。
- `src/error-messages.ts`：相关错误码、网络及通用失败映射。
- `src/note-navigation.ts`：补充焦点定位的三种提示常量。

合并后共 **409 条源码文案**：浮动提示 44 条，弹窗文字 39 条，错误原因 144 条，界面标签与状态 182 条。另有开头 8 种组合形式。源位置以本次 b68 工作区为准。

共享错误表可能将“卡片”“超时”“网络”等底层异常替换成通用文案，所以实际弹出内容也取决于调用的是原文透传还是 describeError/presentError。
