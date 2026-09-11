import fs from "node:fs"
import path from "node:path"
import postcss from "postcss"

const uiDir = path.resolve("web/src/ui")
const files = fs.readdirSync(uiDir).filter(name => name.endsWith(".css"))
const retiredClasses = new Set([
  "previewPaper", "previewMore", "mn-glass-control-title", "mn-glass-presets",
  "mn-glass-preset", "mn-glass-control-row", "mn-glass-background-tools", "mn-glass-hint",
  "preview-target-dot", "preview-switch", "answerLayoutChoices", "pageLayoutChoices",
  "previewMeta", "previewQuestion", "previewAnswer", "previewCardBody",
  "exportActionButtons", "exportFilterGrid", "exportCustomPicker", "exportSummaryText",
  "detailControls", "preview-detail-badges", "preview-level-3", "preview-level-4",
  "preview-level-5", "batchApply", "preview-filter-hidden", "previewDateFilterWrap",
  "preview-hidden-select", "primary", "previewBatchLevelNative", "previewFavoriteMark",
  "previewFavoriteMarkIcon", "previewDatePopover", "previewDateFilterButton",
  "previewLevelIconGlyph", "previewFavoriteOption", "previewFavoriteOptionLead",
  "pdfGroupLabel", "exportSearch", "batchCheck"
])
let removed = 0
let retired = 0

function referencesRetiredClass(selector) {
  return [...selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)]
    .some(match => retiredClasses.has(match[1]))
}

function pruneRetiredSelectors(root) {
  root.walkRules(rule => {
    const selectors = rule.selectors.filter(selector => !referencesRetiredClass(selector))
    retired += rule.selectors.length - selectors.length
    if (!selectors.length) rule.remove()
    else rule.selectors = selectors
  })
  root.walkAtRules(rule => {
    if (rule.nodes && !rule.nodes.length) rule.remove()
  })
}

function dedupeParent(parent) {
  const seen = new Map()
  const nodes = [...(parent.nodes || [])]
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node.type === "atrule" && node.nodes) dedupeParent(node)
    if (node.type !== "rule") continue
    const declarations = [...(node.nodes || [])]
    for (let declarationIndex = declarations.length - 1; declarationIndex >= 0; declarationIndex -= 1) {
      const declaration = declarations[declarationIndex]
      if (declaration.type !== "decl") continue
      // 对同一规则、同一级联上下文和同一优先级，后出现的同属性一定覆盖
      // 前值；值是否相同不影响结论。仅按 exact selector 处理，不跨选择器
      // 猜测可重叠关系，因此这是保持级联语义的机械收敛。
      const key = `${node.selector}\u0000${declaration.prop}\u0000${declaration.important}`
      if (seen.has(key)) {
        declaration.remove()
        removed += 1
      } else {
        seen.set(key, true)
      }
    }
    if (!node.nodes?.some(child => child.type === "decl")) node.remove()
  }
}

const stageTwoFiles = new Set(["controls.css", "shell.css", "overview.css", "mistakes.css", "review.css", "settings.css"])

for (const file of files) {
  if (!stageTwoFiles.has(file)) continue
  const target = path.join(uiDir, file)
  const root = postcss.parse(fs.readFileSync(target, "utf8"), { from: target })
  pruneRetiredSelectors(root)
  dedupeParent(root)
  fs.writeFileSync(target, root.toString())
}

console.log(`Removed ${retired} retired selectors and ${removed} overridden declarations from ${stageTwoFiles.size} stage-two CSS modules.`)
