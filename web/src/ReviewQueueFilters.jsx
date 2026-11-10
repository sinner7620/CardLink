import React, { useMemo, useState } from "react"
import { Icon } from "./icons"
import { buildReviewFilterTree, canExpandReviewNode, toggleReviewSelection, chooseReviewSources, chooseReviewLevels } from "./lib/reviewQueueControls"

export function ReviewQueueFilters({ records, names, levels, setLevels, selected, setSelected, onReset, favoritesOnly = false, onFavoritesToggle }) {
  const tree = useMemo(() => buildReviewFilterTree(records), [records])
  const [expanded, setExpanded] = useState(new Set())
  function rows(nodes, depth = 0) {
    return nodes.map(node => {
      const checked = selected !== null && node.recordIds.every(id => selected.has(id))
      const partial = selected !== null && !checked && node.recordIds.some(id => selected.has(id))
      const expandable = canExpandReviewNode(node), open = expanded.has(node.key)
      return <React.Fragment key={node.key}>
        <div className="reviewSourceRow" data-selection={checked ? "all" : partial ? "partial" : "none"} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => setSelected(chooseReviewSources(selected, node.recordIds))}>
          {expandable ? <button type="button" className="reviewSourceExpand" aria-label={`${open ? "折叠" : "展开"}${node.title}`} aria-expanded={open} onClick={event => { event.stopPropagation(); setExpanded(current => toggleReviewSelection(current, [node.key])) }}><Icon name={open ? "down" : "right"} /></button> : <span className="reviewSourceSpacer" />}
          <button type="button" className="reviewSourceSelect" aria-pressed={partial ? "mixed" : checked}><span>{node.title}</span><small>{node.recordIds.length}</small></button>
        </div>
        {expandable && open && rows(node.children.filter(child => child.children.length), depth + 1)}
      </React.Fragment>
    })
  }
  return <>
    <div className="reviewFilterHeader"><div className="reviewFilterChoices"><div className="reviewLevelSegments" role="group" aria-label="等级筛选">{names.map(([level, name]) => <button type="button" key={level} data-level={level} aria-pressed={levels !== null && levels.includes(level)} onClick={() => setLevels(current => chooseReviewLevels(current, level))}>{name}</button>)}</div>{onFavoritesToggle && <button type="button" className="mistakeFavoritesStar" aria-label="仅看收藏错题" title="仅看收藏错题" aria-pressed={favoritesOnly} onClick={onFavoritesToggle}><Icon name="star" /></button>}</div><button type="button" className="reviewFilterReset" onClick={onReset}>重置</button></div>
    <div className="reviewSourceTree" aria-label="学习集与脑图筛选">{rows(tree)}{!tree.length && <p>暂无复习记录</p>}</div>
  </>
}
