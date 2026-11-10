import React, { useId } from "react"
import { Icon } from "./icons"
import { toggleExportFilter } from "../../src/export-filters"
import "./ui/export-filters.css"

export function FilterSection({ title, count = 0, open = false, children }) {
  return <details className="exportFilterSection" open={open || undefined}>
    <summary><strong>{title}</strong>{count > 0 && <span className="exportFilterBadge">{count}</span>}<Icon name="down" /></summary>
    <div className="exportFilterOptions">{children}</div>
  </details>
}

export function FilterChoices({ title, value, onChange, options, multiple = false }) {
  const name = useId()
  return <div className="exportFilterChoiceList" role={multiple ? "group" : "radiogroup"} aria-label={title}>{options.map(option => <label key={option.value}>
    <input type={multiple ? "checkbox" : "radio"} name={name} checked={multiple ? option.value === "all" ? value.length === 0 : value.includes(option.value) : value === option.value} onChange={() => onChange(multiple ? toggleExportFilter(value, option.value) : option.value)} />
    {option.color && <i style={{ background: option.color }} aria-hidden="true" />}<span>{option.label}</span>
    {option.count !== undefined && <small>{option.count}</small>}
  </label>)}</div>
}

export default function ExportFilters({ query, setQuery, activeCount, onReset, children, count, emptyMaps }) {
  return <div className="exportFilterWorkbench">
    <div className="exportFilterTop"><strong>筛选</strong><button type="button" disabled={!activeCount} onClick={onReset}><Icon name="reset" />重置{activeCount > 0 && <span>{activeCount}</span>}</button></div>
    <label className="exportFilterSearch"><Icon name="search" /><input aria-label="搜索导出题目" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、章节或标签…" /></label>
    {children}
    <div className="exportFilterResult" role="status" aria-live="polite">{emptyMaps ? "请选择至少一个学习集 / 脑图" : <><strong>{count}</strong> 道可用错题符合条件</>}</div>
  </div>
}
