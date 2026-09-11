# v2.3.3-beta.92：答案窗口拖动区覆盖顶部整条（控件可点、空隙可拖）

日期：2026-09-06。基线：beta.91（正式渠道，版本号 2.3.3-beta.92）。范围：真机反馈——答案窗口顶部三个控件区域无法响应拖动。

## 根因

答案窗口的拖动手势区（dragArea）只覆盖 x≥102 且创建于各控件之后：①左侧 102pt（关闭/刷新所在条）无拖动手势；②候选长条（x≈106）位于 dragArea 之下，点按被吞（"候选选择点击无反应"的另一半根因，beta.88 只修了下拉行 tag 定位）。

## 实现

- 拖动区改为顶部整条（全宽 × 48pt），setup 中最先加入（垫底）；关闭/刷新/候选长条依次叠于其上——控件可点，控件间空隙与留白可拖。
- `layoutAnswerCardWindowControls` 同步拖动区帧（窗口缩放/侧边切换保持全宽覆盖）。
- 修复脚本误删导致的 dragArea/手势缺失（窗口创建曾抛 ReferenceError）。

## 影响文件

`src/answer-card-view.ts`、`tests/plugin-events.test.ts`、`package.json`。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 180/180 通过（新增：拖动区全宽声明、层序"拖动区先于关闭按钮加入"、布局同步断言）；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.92.mnaddon`（SHA-256 `FAF0332E8EB38EF5D91C42F1C7A5E7DFDBE4D75FC398B5EF85DC935A58D4FEF6`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.92.mnaddon`，副本与原包哈希一致。

## 未验证限制（必须真机）

拖动区命中分配（按钮可点、空隙可拖）需真机确认；按钮正上方的按下仍是"点按钮"而非"拖窗"（预期行为）。
