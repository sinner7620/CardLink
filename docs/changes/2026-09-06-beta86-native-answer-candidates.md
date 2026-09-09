# v2.3.3-beta.86：答案窗口候选切换改为原生长条 + 下拉

日期：2026-09-06。基线：beta.85（正式渠道，版本号 2.3.3-beta.86）。范围：真机反馈——卡片内 HTML 候选下拉不可用，改为原生控件并集成关闭/刷新体系。

## 补丁废弃与根因

beta.81 在答案卡片 HTML 顶部注入 `<select>`，经 `mnaddon://` 自导航切换候选——真机不可用。按"不打补丁"原则整体废弃（candidateBarHtml 注入、switchAnswerCandidate 桥命令与路由删除），改为纯原生实现。

## 实现

- 原生长条按钮（深色半透明胶囊，与关闭 ×/刷新 ↻ 同体系）位于刷新按钮右侧（x=106），标题「候选 i/N · 当前答案名」，仅多候选显示。
- 点击展开/收起原生下拉面板（surface 底圆角投影，行高 34，当前候选蓝底高亮，★ 标标准答案），选择行原位重渲染（窗口位置保持）并收起。
- 行序定位双重回退：sender 身份比对 + sender.tag。拖窗/关闭/刷新时收起下拉。
- 布局：候选控件随窗口宽度/侧边设置联动（layoutAnswerCardWindowControls 统一管理）。

## 影响文件

`src/answer-card-view.ts`、`src/plugin.ts`、`src/matcher.ts`（回退二元签名）、`src/rails-core.ts`、`tests/bridge-schema.test.ts`、`tests/plugin-events.test.ts`、`package.json`。

## 兼容性与数据影响

数据结构、存储键不变；正式渠道 ID 原地覆盖升级。多候选交互行为变化（见发布说明）。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过（新增"多候选走原生长条与下拉、卡片内不注入"静态断言）；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.86.mnaddon`（SHA-256 `769886D5EC51F40D3B7881566939E1D47D6D52F66A99C0006A23488F0401CE5C`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.86.mnaddon`，副本与原包哈希一致。

## 未验证限制（必须真机）

长条位置/宽度、下拉展开与候选切换、JSB 控件 sender 传参行为——桌面无宿主，全部待真机；如 sender 未传参导致行定位失败，反馈后改为按行序闭包定位。
