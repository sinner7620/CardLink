# beta.59 UI 阶段二上下半程完成

日期：2026-09-02  
版本：2.3.3-beta.59

## 目的

按最初 UI 重构计划完整执行阶段二，而不是沿用 beta.55“已完成”的过早结论：上半程收敛错题页与公共控件，下半程收敛待复习、设置、概览和 Shell，同时保持当前所有可见控件和布局不变。

## 实现

### 上半程：错题页与公共控件

- 对 `mistakes.css`、`controls.css` 中同一 selector、同一 at-rule 上下文、同一优先级的重复属性做后值收口。
- 不跨不同选择器猜测 DOM 重叠关系，不删除仅凭静态分析无法证明为无效的规则。

### 下半程：其余页面与 Shell

- 同样处理 `review.css`、`settings.css`、`overview.css`、`shell.css`。
- 导出页不改变控件、布局或视觉；只参与统一级联优先级表达，避免公共规则在层外反压页面规则。

### 清除 `!important`

- 新增 `scripts/consolidate-ui-priority.mjs`，将普通声明与历史强制声明分别迁入 `mn-ui-base`、`mn-ui-priority` 两个命名 cascade layer。
- `tokens.css` 显式声明层顺序；模块导入顺序和各层内部源码顺序保持不变。
- 这不是简单删除 `!important`：原先的重要声明仍进入更高优先层，因此保留原有级联胜负关系，同时消除 1345 个散落的声明级强制标记。
- `scripts/dedupe-ui-css.mjs` 改为仅处理六个阶段二目标模块，并能删除值不同但已被同 selector 后值确定覆盖的属性。

## 指标

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| UI 源码 `!important` | 1345 | 0 |
| 阶段二模块可证明覆盖声明 | 13 | 0 |
| 目标页面横向溢出 | 0 | 0 |

## 影响文件

- `web/src/ui/tokens.css`
- `web/src/ui/controls.css`
- `web/src/ui/shell.css`
- `web/src/ui/overview.css`
- `web/src/ui/mistakes.css`
- `web/src/ui/review.css`
- `web/src/ui/settings.css`
- `web/src/ui/export.css`
- `scripts/dedupe-ui-css.mjs`
- `scripts/consolidate-ui-priority.mjs`
- `tests/ui-stage2-visual.spec.js`
- `package.json`、`pnpm-lock.yaml`

## 兼容性与数据影响

- 仅修改 CSS 级联表达和测试基础设施；不修改 React DOM、桥协议、错题数据、复习状态、答案绑定或共享存储。
- cascade layer 由当前 MarginNote 4 使用的现代 WebKit 支持；层内仍保留原有 selector、媒体查询、容器查询和源码顺序。
- `@playwright/test` 仅作为开发依赖，不进入 `.mnaddon` 运行包。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过，158/158。
- `pnpm exec playwright test tests/ui-stage2-visual.spec.js` 通过，2/2。
- Playwright 覆盖 500×900、920×900 两档视口和总览、错题本、待复习、设置四页。
- CSS 转换、版本号尚未更新的检查点中，重构前后 8 张 PNG 的 SHA-256 分别一致。最终 beta.59 的 6 张非设置页截图仍完全一致；两张设置页截图仅“当前版本”文字从 beta.58 变为 beta.59。
- 页面根 `scrollWidth - clientWidth <= 1px`，无新增页面级横向滚动。
- `pnpm build` 通过，生产 `web-dist/app.css` 中 `!important` 为 0，生成 `dist/mn4-answer-matcher-v2.3.3-beta.59.mnaddon`。

## 未验证限制

- 浏览器预览不能覆盖 MarginNote 真机的全部系统字号、动态数据长度和 WebKit 合成路径；安装 beta.59 后仍需快速复核错题详情窄窗、长复测时间线和设置编辑态。
