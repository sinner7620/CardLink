# v2.3.3-beta.63

## CSS 四代体系收敛（2026-09-03）

- token 别名链摊平：消除 mn-blue-legacy / preview-ui / preview-accent / study 四代词汇中的 16 个纯别名（如 `--preview-ui-ink: var(--rd-ink)`、`--rd-accent: var(--mn-accent)`），104 处引用重写到规范 token；字面值不同的旧 token 保留，不猜值。
- 删除 8 个零引用孤立 token（z-index 锚点旧值、未使用的色板变量）。
- 同选择器死声明就地清除与条件合并：132 组同选择器去重、priority 层反向清除 base 声明 28 条、20 组多块安全合并；controls.css 的 6 个 `:root` 块收敛为单块。
- 新增 `scripts/css-baseline.mjs` 基线比对网（18 状态 × 3 视口逐元素计算样式 + 伪元素 + 自定义属性）与 `scripts/flatten-ui-css.mjs` 收敛脚本；本轮全部改动经零差异验证，另抽 2 状态截图字节级比对一致。
- 产物 `app.css` 122.5 KB → 116.2 KB；源码 6735 → 6578 行。
- 测试断言随 token 规范名与声明顺序无关化更新 2 处；158/158 通过。
- 约定：后续新样式写入所有权模块内组件的唯一块，不再向尾部追加覆盖规则；批量改动用基线比对网验证。
- 版本迭代为 `2.3.3-beta.63`。

完整记录见 `docs/changes/2026-09-03-beta63-css-generation-consolidation.md`。
