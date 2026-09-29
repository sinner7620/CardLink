// beta.65 错题详情重构的 CSS 迁移：
//  1) 移除已退出 JSX 的旧类规则（detailTabs 旧标签行、aux 组、折叠钮、collapsed 态、meta 行、due 徽章、旧标签触发钮）
//  2) 在 mn-ui-base 层末尾追加新组件样式（状态方块/标签栏/悬浮操作条，rd 规范同源）
import fs from "node:fs"
import path from "node:path"
import postcss from "postcss"

const target = path.resolve("web/src/ui/mistakes.css")
const RETIRED_TOKENS = [
  "detailTabs", "detailTabRightGroup", "detailTabAux", "detailCollapseToggle",
  "preview-collapsed", "preview-detail-meta", "preview-due-badge", "detailTagTrigger"
]
const RETIRED_SELECTORS = [".preview-detail-title-row > button"]

const NEW_CSS = `
/* ── beta.65 错题详情重构：状态方块 / 标签栏 / 悬浮操作条（与 rd 规范同源） ── */
.detailHeadingBlock {
  min-width: 0;
  flex: 1 1 auto;
}
.detailStatusCard {
  position: relative;
  flex: none;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 96px;
  padding: 6px 12px 7px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  background: var(--preview-ui-button);
  overflow: hidden;
}
.detailStatusCard.preview-level-0 { border-color: rgba(255, 69, 58, 0.38); background: rgba(255, 69, 58, 0.09); }
.detailStatusCard.preview-level-1 { border-color: rgba(255, 159, 10, 0.42); background: rgba(255, 159, 10, 0.1); }
.detailStatusCard.preview-level-2 { border-color: rgba(48, 209, 88, 0.42); background: rgba(48, 209, 88, 0.1); }
.detailStatusLevelName {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--rd-ink);
}
.detailStatusCard.preview-level-0 .detailStatusLevelName { color: var(--mn-level-0); }
.detailStatusCard.preview-level-1 .detailStatusLevelName { color: var(--mn-level-1); }
.detailStatusCard.preview-level-2 .detailStatusLevelName { color: var(--mn-level-2); }
.detailStatusLevelCaption {
  font-size: 9px;
  line-height: 12px;
  color: var(--rd-muted);
}
.detailStatusDue {
  font-size: 10px;
  line-height: 13px;
  color: var(--rd-muted);
}
.detailStatusDue.isDue { color: var(--mn-level-0); font-weight: 700; }
.detailStatusCard .previewLevelSelect {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  padding: 0;
  opacity: 0;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  font-size: 16px;
}
.detailTagPicker.detailTagBar {
  position: relative;
  margin-top: 6px;
}
.detailTagBarTrigger {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 3px 8px;
  border: 1px solid var(--rd-line);
  border-radius: 8px;
  background: var(--preview-ui-soft, rgba(120, 120, 128, 0.07));
  cursor: pointer;
  text-align: left;
}
.detailTagBarTrigger > em {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
  font-size: 10px;
  line-height: 16px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--preview-ui-button);
  color: var(--rd-text, #3a3a3c);
}
.detailTagBarEmpty {
  font-size: 10px;
  color: var(--rd-muted);
}
.detailStage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.detailActionBar {
  position: absolute;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--rd-line);
  border-radius: 999px;
  background: var(--rd-surface);
  box-shadow: var(--rd-shadow-lift);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
}
.detailActionBar.dragging,
.detailBarDot.dragging { cursor: grabbing; }
.detailActionBar.vertical { flex-direction: column; align-items: stretch; }
.detailActionBar > button:not(.previewFavoriteButton) {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--rd-line);
  border-radius: 999px;
  background: var(--preview-ui-button);
  color: var(--rd-ink);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}
.detailActionBar > button:not(.previewFavoriteButton).active {
  border-color: var(--rd-accent-strong, #0b7ae3);
  color: var(--rd-accent);
}
.detailActionBar > .previewFavoriteButton { flex: none; }
.detailActionBar .answerVariantSelect {
  flex: none;
  max-width: 120px;
  min-height: 30px;
  padding: 2px 6px;
  border: 1px solid var(--rd-line);
  border-radius: 999px;
  background: var(--preview-ui-button);
  font-size: 11px;
}
.detailActionBar .detailRemoveMistake { color: #c43d3d; }
.detailActionBar .detailRemoveMistake.confirming {
  border-color: rgba(196, 61, 61, 0.45);
  background: rgba(196, 61, 61, 0.1);
}
.detailActionBar .detailBarCollapse { width: 32px; padding: 4px 0; }
.detailBarDot {
  position: absolute;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--rd-line);
  border-radius: 999px;
  background: var(--rd-surface);
  box-shadow: var(--rd-shadow-lift);
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
`

const root = postcss.parse(fs.readFileSync(target, "utf8"))
let removed = 0

const isRetired = selector => {
  if (RETIRED_SELECTORS.includes(selector.trim())) return true
  return RETIRED_TOKENS.some(token => new RegExp(`\\.${token}(?![-\\w])`).test(selector))
}

function prune(container) {
  for (const node of [...(container.nodes || [])]) {
    if (node.type === "rule") {
      const kept = node.selectors.filter(selector => !isRetired(selector))
      if (kept.length !== node.selectors.length) removed += node.selectors.length - kept.length
      if (!kept.length) node.remove()
      else node.selectors = kept
    } else if (node.type === "atrule" && node.nodes && !["keyframes", "-webkit-keyframes", "font-face"].includes(node.name)) {
      prune(node)
      const hasContent = (node.nodes || []).some(child => child.type === "decl" || child.type === "rule")
      if (!hasContent) node.remove()
    }
  }
}
prune(root)

const base = root.nodes.find(node => node.type === "atrule" && node.name === "layer" && node.params === "mn-ui-base")
if (!base) throw new Error("mn-ui-base 层不存在")
base.append(postcss.parse(NEW_CSS))

fs.writeFileSync(target, root.toString())
console.log(`移除退役选择器 ${removed} 个；新样式块已插入 mn-ui-base 层末尾`)
