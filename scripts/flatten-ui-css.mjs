// CSS 收敛脚本（阶段三清理）：
//  1) token 别名链摊平：仅消除"全局 :root 单值别名"的旧代词汇
//     （--preview-ui-* / --preview-accent* / --study-* / --mn-blue-legacy*），
//     全部 var() 用法重写到终点 token，别名定义删除；带作用域重定义或
//     字面值不同的旧 token 一律保留，绝不猜值。
//  2) 同文件、同层（mn-ui-base/mn-ui-priority）、同 at-rule 上下文内，
//     相同 selector 文本的多条规则合并到最后一次出现的位置，后面的同属性
//     声明覆盖前面的（机械级联结论）；priority 层对同 selector+属性在 base
//     层的声明做清除。不跨选择器、不跨文件猜测可重叠关系。
// 用法：node scripts/flatten-ui-css.mjs [--dry]
import fs from "node:fs"
import path from "node:path"
import postcss from "postcss"

const dry = process.argv.includes("--dry")
const uiDir = path.resolve("web/src/ui")
const FILE_ORDER = ["tokens.css", "controls.css", "shell.css", "overview.css", "mistakes.css", "review.css", "export.css", "settings.css"]
// 由 JS 在运行时注入/消费的自定义属性：永不消除、永不改值。
const JS_SET = new Set(["--mn-accent", "--mn-gray-fill", "--mn-level-0", "--mn-level-1", "--mn-level-2", "--mn-topbar-height", "--progress"])
const LEGACY_PREFIXES = ["--preview-ui-", "--preview-accent", "--study-", "--mn-blue-legacy"]
const isLegacy = name => LEGACY_PREFIXES.some(prefix => name.startsWith(prefix))

const roots = new Map()
for (const file of FILE_ORDER) {
  roots.set(file, postcss.parse(fs.readFileSync(path.join(uiDir, file), "utf8"), { from: file }))
}

// ── 上下文工具：layer 之外的 at-rule 链（media/supports 等）作为级联上下文 ──
function contextChain(node) {
  const chain = []
  let current = node.parent
  while (current && current.type === "atrule") {
    if (!["layer", "keyframes", "-webkit-keyframes", "font-face"].includes(current.name)) {
      // 参数内部空白归一化：`max-width:600px` 与 `max-width: 600px` 是同一上下文
      chain.unshift(`${current.name} ${current.params.replace(/\s+/g, "")}`)
    }
    current = current.parent
  }
  return chain.join("\u0000")
}

function layerOf(node) {
  let current = node.parent
  while (current) {
    if (current.type === "atrule" && current.name === "layer") return current.params
    if (current.type === "atrule" && ["keyframes", "-webkit-keyframes", "font-face"].includes(current.name)) return "opaque"
    current = current.parent
  }
  return "(top)"
}

function* walkRules(container) {
  for (const node of container.nodes || []) {
    if (node.type === "rule") yield node
    else if (node.type === "atrule" && node.nodes && !["keyframes", "-webkit-keyframes", "font-face"].includes(node.name)) {
      yield* walkRules(node)
    }
  }
}

// ── Pass 1：收集全局 :root 自定义属性定义，判定可消除的纯别名 ──
// effective: name -> { value, layer, file }（同上下文后定义覆盖先定义，priority 层高于 base 层）
const globalDefs = [] // { name, value, layer, file, node, parent }
const scopedLegacyNames = new Set()
for (const [file, root] of roots) {
  for (const rule of walkRules(root)) {
    if (rule.selector.trim() !== ":root") continue
    for (const decl of rule.nodes || []) {
      if (decl.type !== "decl" || !decl.prop.startsWith("--")) continue
      globalDefs.push({ name: decl.prop, value: decl.value.trim(), layer: layerOf(rule), file, node: decl, parent: rule })
    }
  }
  // 作用域（非 :root）内的旧代词汇重定义 → 该名字不可消除
  for (const rule of walkRules(root)) {
    if (rule.selector.trim() === ":root") continue
    for (const decl of rule.nodes || []) {
      if (decl.type === "decl" && decl.prop.startsWith("--") && isLegacy(decl.prop)) scopedLegacyNames.add(decl.prop)
    }
  }
}
const layerRank = layer => (layer === "mn-ui-priority" ? 1 : 0)
const effective = new Map()
for (const def of globalDefs) {
  const previous = effective.get(def.name)
  if (!previous || layerRank(def.layer) >= layerRank(previous.layer)) effective.set(def.name, def)
}

const pureAlias = value => /^var\(--[A-Za-z0-9-]+\)$/.test(value)
const aliasTarget = new Map() // 可消除名 -> 终点名
function resolveTerminal(name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token 别名环：${[...seen, name].join(" -> ")}`)
  seen.add(name)
  const def = effective.get(name)
  if (!def || !pureAlias(def.value) || JS_SET.has(name) || scopedLegacyNames.has(name)) {
    return effective.has(name) || JS_SET.has(name) ? name : null
  }
  if (!isLegacy(name)) return name // 非旧代词汇是合法终点（如 --rd-*）
  const target = def.value.slice(4, -1)
  return resolveTerminal(target, seen)
}
for (const name of effective.keys()) {
  if (!isLegacy(name) || scopedLegacyNames.has(name)) continue
  const def = effective.get(name)
  if (!pureAlias(def.value)) continue // 字面值旧 token 保留（值可能与新代不同）
  const terminal = resolveTerminal(name)
  if (terminal && terminal !== name) aliasTarget.set(name, terminal)
}
// 终点若是待消除名（链式别名）需要再收敛 —— resolveTerminal 已递归，直接可用。

// ── Pass 1 执行：重写 var() 用法 + 删除别名定义 ──
let rewritten = 0
const rewriteValues = root => {
  root.walkDecls(decl => {
    if (!decl.value.includes("var(")) return
    let value = decl.value
    for (const [name, terminal] of aliasTarget) {
      const pattern = new RegExp(`var\\(${name.replace(/[-]/g, "\\$&")}(\\)|,)`, "g")
      value = value.replace(pattern, (_match, tail) => `var(${terminal}${tail}`)
    }
    if (value !== decl.value) { rewritten += 1; decl.value = value }
  })
}
for (const root of roots.values()) rewriteValues(root)
let removedDefs = 0
for (const def of globalDefs) {
  if (aliasTarget.has(def.name)) { def.node.remove(); removedDefs += 1 }
}

// ── Pass 2：同文件、同层、同上下文内，清除被后面同 selector 出现覆盖的死声明 ──
// 关键不变量：selector 文本相同 ⇒ 匹配元素集合相同 ⇒ 在双方都命中的任何元素上，
// 后出现的同属性声明（同 important 标记）恒胜，前面的声明在任何情况下都不会
// 生效。因此只做"原地删除死声明"，绝不移动规则——移动会让声明跳过中间的
// 其他选择器规则并翻转胜者（多选择器规则如 `.mistakeList, .detailPane` 正是
// 反例）。
let mergedRules = 0
let droppedDecls = 0
function pruneShadowedDecls(layerAtRule, file) {
  const groups = new Map() // key = context + selector
  for (const rule of walkRules(layerAtRule)) {
    const key = `${contextChain(rule)}\u0000${rule.selector}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(rule)
  }
  for (const rules of groups.values()) {
    if (rules.length < 2) continue
    mergedRules += 1
    const seen = new Set() // 从后往前扫：已见 propKey 说明存在更晚的同属性声明
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index]
      for (const decl of [...(rule.nodes || [])]) {
        if (decl.type !== "decl") continue
        const propKey = `${decl.prop}\u0000${decl.important ? "!" : ""}`
        if (seen.has(propKey)) { decl.remove(); droppedDecls += 1 }
        else seen.add(propKey)
      }
    }
  }
  // 无声明残留的规则（含仅剩注释的空壳）与空 @media 一并删除
  const prune = container => {
    for (const node of [...(container.nodes || [])]) {
      if (node.type === "rule") {
        const hasDecl = (node.nodes || []).some(child => child.type === "decl")
        if (!hasDecl) node.remove()
      } else if (node.type === "atrule" && node.nodes && !["keyframes", "-webkit-keyframes", "font-face"].includes(node.name)) {
        prune(node)
        const hasDecl = (node.nodes || []).some(child => child.type === "decl" || child.type === "rule")
        if (!hasDecl) node.remove()
      }
    }
  }
  prune(layerAtRule)
}

// priority 层对同 selector + 同属性的 base 声明做清除（层级恒胜，与顺序无关）
function pruneBaseByPriority(baseLayer, priorityLayer, file) {
  const priorityProps = new Map() // context+selector -> Set(prop key)
  for (const rule of walkRules(priorityLayer)) {
    const key = `${contextChain(rule)}\u0000${rule.selector}`
    if (!priorityProps.has(key)) priorityProps.set(key, new Set())
    for (const decl of rule.nodes || []) {
      if (decl.type === "decl") priorityProps.get(key).add(`${decl.prop}\u0000${decl.important ? "!" : ""}`)
    }
  }
  let pruned = 0
  for (const rule of walkRules(baseLayer)) {
    const key = `${contextChain(rule)}\u0000${rule.selector}`
    const shadowed = priorityProps.get(key)
    if (!shadowed) continue
    for (const decl of [...(rule.nodes || [])]) {
      if (decl.type === "decl" && shadowed.has(`${decl.prop}\u0000${decl.important ? "!" : ""}`)) {
        decl.remove()
        pruned += 1
      }
    }
  }
  return pruned
}

// ── Pass 2b：同 selector 多块条件合并 ──
// 死声明清除后，同一 selector 可能仍剩多个块（各块持有不同存活声明）。把它们
// 合并到最后一个块的位置有一个安全前提：两块之间不存在"同优先级且声明了任一
// 相同属性"的其他规则——否则搬动会跳过该规则并翻转胜者（优先级更高/更低的
// 中间规则不受顺序影响，无需考虑）。
function specificity(selector) {
  let ids = 0, classes = 0, elements = 0
  const cleaned = selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, match => {
    // :not/:is 的参数参与计数，普通伪类按 class 计，::伪元素按 element 计
    if (match.startsWith("::")) { elements += 1; return "" }
    const inner = match.match(/\(([^)]*)\)/)
    if (inner) {
      const nested = specificity(inner[1])
      ids += nested.ids; classes += nested.classes; elements += nested.elements
      return ""
    }
    classes += 1
    return ""
  })
  ids += (cleaned.match(/#[\w-]+/g) || []).length
  classes += (cleaned.match(/\.[\w-]+/g) || []).length
  classes += (cleaned.match(/\[[^\]]+\]/g) || []).length
  const elementWords = cleaned.replace(/[>+~]/g, " ").split(/\s+/).filter(Boolean)
  for (const word of elementWords) if (/^[a-zA-Z][\w-]*$/.test(word)) elements += 1
  return [ids, classes, elements]
}
const specKey = selector => specificity(selector).join(",")

function mergeSiblingBlocks(layerAtRule, file) {
  // 收集（上下文, selector）分组的规则及其在层内的线性位置
  const linear = []
  const indexRules = container => {
    for (const node of container.nodes || []) {
      if (node.type === "rule") { linear.push(node); continue }
      if (node.type === "atrule" && node.nodes && !["keyframes", "-webkit-keyframes", "font-face"].includes(node.name)) indexRules(node)
    }
  }
  indexRules(layerAtRule)
  const position = new Map(linear.map((node, index) => [node, index]))
  const groups = new Map()
  for (const rule of linear) {
    const key = `${contextChain(rule)}\u0000${rule.selector}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(rule)
  }
  let merged = 0
  for (const rules of groups.values()) {
    if (rules.length < 2) continue
    const first = rules[0]
    const last = rules[rules.length - 1]
    const from = position.get(first)
    const to = position.get(last)
    if (to - from < 2) { // 相邻块无中间规则，直接合并
    } else {
      const props = new Set()
      for (const rule of rules) for (const decl of rule.nodes || []) if (decl.type === "decl") props.add(decl.prop)
      const spec = specKey(first.selector)
      let conflict = false
      for (let index = from + 1; index < to && !conflict; index += 1) {
        const between = linear[index]
        if (specKey(between.selector) !== spec) continue
        for (const decl of between.nodes || []) {
          if (decl.type === "decl" && props.has(decl.prop)) { conflict = true; break }
        }
      }
      if (conflict) continue
    }
    const mergedRule = last.clone({ nodes: [] })
    for (const rule of rules) {
      for (const node of [...(rule.nodes || [])]) {
        if (node.type === "decl") mergedRule.append(node.clone())
        else if (node.type === "rule" || node.type === "atrule") mergedRule.append(node.clone())
      }
    }
    last.replaceWith(mergedRule)
    for (const rule of rules) if (rule !== last) rule.remove()
    merged += 1
  }
  return merged
}

let prunedTotal = 0
let mergedBlocksTotal = 0
// :root 合并：同文件、同层内把所有非 media 上下文的 :root 块并成最后一个位置的
// 单块。安全依据：:root 只匹配 html；html 上同属性的同优先级竞争者只可能是另一
// 个 :root（正在合并的就是它），`*`/`html` 优先级更低不受顺序影响。
function consolidateRoots(layerAtRule, file) {
  const roots = []
  for (const node of layerAtRule.nodes || []) {
    if (node.type === "rule" && node.selector.trim() === ":root") roots.push(node)
  }
  if (roots.length < 2) return
  const last = roots[roots.length - 1]
  for (const root of roots) {
    if (root === last) continue
    for (const decl of [...(root.nodes || [])]) {
      if (decl.type === "decl") last.append(decl.clone())
    }
    root.remove()
  }
  rootConsolidated += 1
}
let rootConsolidated = 0
for (const [file, root] of roots) {
  const layers = root.nodes.filter(node => node.type === "atrule" && node.name === "layer")
  const base = layers.find(node => node.params === "mn-ui-base")
  const priority = layers.find(node => node.params === "mn-ui-priority")
  if (base) pruneShadowedDecls(base, file)
  if (priority) pruneShadowedDecls(priority, file)
  if (base && priority) prunedTotal += pruneBaseByPriority(base, priority, file)
  if (base) mergedBlocksTotal += mergeSiblingBlocks(base, file)
  if (priority) mergedBlocksTotal += mergeSiblingBlocks(priority, file)
  if (base) consolidateRoots(base, file)
  if (priority) consolidateRoots(priority, file)
  if (!dry) fs.writeFileSync(path.join(uiDir, file), root.toString())
}

// ── Pass 3：孤立 token 删除（css 内 0 引用且非 JS 注入名） ──
const usage = new Map()
for (const root of roots.values()) {
  const all = root.toString()
  for (const name of effective.keys()) {
    if (aliasTarget.has(name)) continue
    const count = (all.match(new RegExp(`var\\(${name.replace(/[-]/g, "\\$&")}[),]`, "g")) || []).length
    usage.set(name, (usage.get(name) || 0) + count)
  }
}
const orphans = [...usage.entries()].filter(([name, count]) => count === 0 && !JS_SET.has(name)).map(([name]) => name)
let removedOrphans = 0
for (const name of orphans) {
  for (const def of globalDefs) {
    if (def.name === name) { def.node.remove(); removedOrphans += 1 }
  }
}
if (removedOrphans && !dry) {
  for (const [file, root] of roots) fs.writeFileSync(path.join(uiDir, file), root.toString())
}

console.log(`token 别名消除：${aliasTarget.size} 个名字（重写 ${rewritten} 处 var() 引用，删除 ${removedDefs} 条定义）`)
console.log(`  消除映射：${[...aliasTarget].map(([from, to]) => `${from} -> ${to}`).join("; ") || "(无)"}`)
console.log(`死声明清除：${mergedRules} 组同选择器；丢弃被覆盖声明 ${droppedDecls} 条；priority 层清除 base 声明 ${prunedTotal} 条`)
console.log(`同选择器多块合并：${mergedBlocksTotal} 组（仅在无同优先级中间竞争者时执行）`)
console.log(`:root 合并：${rootConsolidated} 处；孤立 token 删除：${removedOrphans} 个（${orphans.join(", ") || "无"}）`)
if (dry) {
  console.log("(dry run — 实际未写盘，但上文统计基于已重写的内存树)")
}
