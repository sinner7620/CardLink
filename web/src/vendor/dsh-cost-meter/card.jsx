/**
 * Vendored from dsh-cost-meter (MIT)
 * https://github.com/Han-1413141/dsh-cost-meter/tree/cff8dcdf115c4e29342d458d539c48329a17c1a9
 *   src/client/03-settings-panels-main.js   （Card 渲染器）
 *   src/client/03-settings-panels-main.js   （HistoryTable 的按天表格骨架）
 *
 * CardLink 修改（最小适配）：
 *  - 上游用 `el()` 手写 vnode；这里等价改写成 JSX（本文件是 .jsx，故不带类型标注），
 *    DOM 结构与类名逐项一致：
 *    div.cm-card > p.cm-card-title + div.cm-card-value.cm-num + p.cm-card-sub；
 *  - `Cards` 只是上游 `<div className="cm-cards">` 的包装（同一类名）；
 *  - `CostTable` 由 `HistoryTable` 的日期行骨架拆离：上游日期行可点击展开当日会话明细，
 *    H1 没有会话账本 → 去掉点击展开、会话子表与 `cm-row-click`，保留 table/thead/num 结构；
 *  - 金额/数字格式化由调用方传入已格式化的字符串（上游 formatMoneyUsd/formatTokens
 *    依赖宿主价格与账本，不移植）。
 */

export function Card({ title, value, sub }) {
  return (
    <div className="cm-card">
      <p className="cm-card-title">{title}</p>
      <div className="cm-card-value cm-num">{value}</div>
      <p className="cm-card-sub">{sub}</p>
    </div>
  )
}

export function Cards({ children }) {
  return <div className="cm-cards">{children}</div>
}

export function CostTable({ head, rows }) {
  return (
    <div className="cm-scroll">
      <table className="cm-table">
        <thead>
          <tr>
            {head.map((label, index) => (
              <th className={index === 0 ? undefined : 'num'} key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td><div className="cm-sess-title" title={row.label}>{row.label}</div></td>
              {row.cells.map((cell, index) => (
                <td className="num" key={`${row.key}-${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
