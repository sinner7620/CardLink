import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { dockPosition, nearestDockEdge } from "../web/src/detail-dock-geometry"

test("拖动中与松手时使用相同的最近边计算", () => {
  assert.equal(nearestDockEdge(15, 180, 400, 500), "left")
  assert.equal(nearestDockEdge(385, 180, 400, 500), "right")
  assert.equal(nearestDockEdge(200, 15, 400, 500), "top")
  assert.equal(nearestDockEdge(200, 490, 400, 500), "bottom")
})

test("停靠按真实尺寸限位：四边角落、展开和多答案宽度变化", () => {
  const stage = { width: 430, height: 300 }
  for (const edge of ["top", "bottom", "left", "right"]) {
    for (const ratio of [0, .06, .5, .94, 1]) {
      for (const bar of [{ width: 40, height: 40 }, { width: 280, height: 44 }, { width: 414, height: 80 }, { width: 92, height: 280 }]) {
        const pos = dockPosition(stage, bar, edge, ratio)
        assert.ok(pos.left >= 8 && pos.top >= 8)
        assert.ok(pos.left + bar.width <= stage.width - 8)
        assert.ok(pos.top + bar.height <= stage.height - 8)
      }
    }
  }
})
import {
  answerCandidatesForDisplay,
  buildIndex,
  distinctAnswers,
  excludeAnswerNoteId,
  extractAnswer,
  filterSelectionToAnchorGroup,
  normalizeTitle,
  pathMatchScore,
  rankAnswers
} from "../src/domain"

test("答案候选按卡片去重，并在唯一高置信匹配时收敛为单答案", () => {
  const answer = (id: string, noteId: string, pathTitles: string[], tags: string[] = []) => ({
    id, noteId, pathTitles, tags
  })
  assert.equal(distinctAnswers([
    answer("node-a", "card-1", []),
    answer("node-b", "card-1", [])
  ]).length, 1)
  assert.deepEqual(answerCandidatesForDisplay([
    answer("a", "card-1", ["第一章"]),
    answer("b", "card-2", ["第二章"])
  ], ["第一章"]), [])
  assert.deepEqual(answerCandidatesForDisplay([
    answer("a", "card-1", [], ["标准答案"]),
    answer("b", "card-2", [])
  ], []), [])
  assert.equal(answerCandidatesForDisplay([
    answer("a", "card-1", []),
    answer("b", "card-2", [])
  ], []).length, 2)
})
import { readSafeNote } from "../src/safe-note"
import { describeError } from "../src/error-messages"
import { renderCardHtml } from "../src/card-html"
import { compareVersions } from "../src/version"
import { freePositionFrame, isFrameFullyOutside } from "../src/answer-card-layout"
import { answerControlBarLayout } from "../src/window-controls"
import { noteReferenceUrl, noteReferenceUrlCandidates } from "../src/note-link"
import {
  answerOnlyBindingScopes,
  bindingAnswerTargets,
  bindingKey,
  getBinding,
  getBindingForMode,
  normalizeBinding,
  setBinding,
  targetForMode
} from "../src/binding"
import {
  buildOrderedPairing,
  normalizeParentTitle
} from "../src/ordered-pairing-domain"
import {
  extractAnswerRegexKey,
  extractQuestionRegexKey,
  validateRegexMatchingRules
} from "../src/regex-matching"
import { scopeKey } from "../src/scope-key"
import {
  MAIN_MINDMAP_SCOPE_ID,
  childMindMapNoteId,
  collectChildMindMapNoteIds,
  mindMapScopeIdForNote,
  noteBelongsToMindMapScope
} from "../src/mindmap-candidate"
import { buildMindMapOptions, buildParentInsights, buildSourceInsights } from "../src/source-insights"
import { cleanMistakeTags, customMistakeTagsFromSource, hasLegacyManagedMistakeTag, hasLegacyMistakeLevelTag, legacyMistakeLevelFromTags, mistakeSourceTags, mistakeStateFromSourceTags, withoutMistakeSourceTags } from "../src/mistake-tags"
import {
  categoryPathPrefixes,
  createMistakeRecord,
  compareMistakeRecords,
  isDue,
  manualTagsOf,
  mistakeCategoryLabel,
  nextReviewTime,
  reviewMistake
} from "../src/mistake-domain"
import { normalizeMistakeReviewCurves } from "../src/mistake-review-settings"

test("答案悬浮条左右换边时整体贴边并镜像三控件顺序", () => {
  const left = answerControlBarLayout(500, "left", true)
  const right = answerControlBarLayout(500, "right", true)
  assert.equal(left.bar.x, 6)
  assert.equal(right.bar.x + right.bar.width, 494)
  assert.ok(left.close.x < left.refresh.x && left.refresh.x < left.candidates.x)
  assert.ok(right.candidates.x < right.refresh.x && right.refresh.x < right.close.x)
  // 控件统一 40×40（贴近 HIG 44 触控目标）、条高 52；三控件条宽 12 + 120 + 8。
  assert.equal(left.close.width, 40)
  assert.equal(left.close.height, 40)
  assert.equal(left.refresh.width, 40)
  assert.equal(left.candidates.height, 40)
  assert.equal(left.bar.height, 52)
  assert.equal(answerControlBarLayout(500, "left", false).bar.width, 96)
  assert.equal(left.bar.width, 140)
})

test("同一学习集中的不同脑图可保存独立答案绑定并兼容旧绑定", () => {
  const bindings: any = { questions: "legacy-answers" }
  assert.deepEqual(getBinding(bindings, "questions", "root-a"), { notebookId: "legacy-answers" })
  setBinding(bindings, "questions", "root-a", {
    notebookId: "same-study-set",
    rootNodeId: "answer-root-a"
  })
  assert.deepEqual(getBinding(bindings, "questions", "root-a"), {
    notebookId: "same-study-set",
    rootNodeId: "answer-root-a"
  })
  assert.deepEqual(getBinding(bindings, "questions", "root-b"), { notebookId: "legacy-answers" })
  assert.equal(bindingKey("questions", "root-a"), "questions::root::root-a")
  assert.equal(scopeKey({ notebookId: "same-study-set", rootNodeId: "answer-root-a" }), "same-study-set::root::answer-root-a")
})

test("错题多选只保留触发按钮所在脑图，排除另一脑图残留的答案选择", () => {
  const questionA = { id: "q-a", map: "questions" }
  const questionB = { id: "q-b", map: "questions" }
  const staleAnswer = { id: "a", map: "answers" }
  assert.deepEqual(
    filterSelectionToAnchorGroup(
      [staleAnswer, questionA, questionB],
      questionA,
      item => item.map
    ),
    [questionA, questionB]
  )
})

test("错题索引只把未兼任题目来源的绑定脑图视为纯答案范围", () => {
  const bindings: any = {
    "study::root::questions": { notebookId: "study", rootNodeId: "answers" },
    "study::root::dual-role": { notebookId: "study", rootNodeId: "dual-role" },
    legacy: "whole-answer-study-set",
    "dual-study::root::questions": "dual-study"
  }
  assert.deepEqual(
    [...answerOnlyBindingScopes(bindings)],
    ["study::root::answers", "whole-answer-study-set"]
  )
  assert.deepEqual(
    bindingAnswerTargets(bindings).map(target => bindingKey(target.notebookId, target.rootNodeId)),
    ["study::root::answers", "study::root::dual-role", "whole-answer-study-set", "dual-study"]
  )
})

test("绑定模式关闭时使用整个学习集，开启时限定具体脑图", () => {
  const bindings: any = {
    questions: "whole-answer-set",
    [bindingKey("questions", "question-root")]: {
      notebookId: "scoped-answer-set",
      rootNodeId: "answer-root"
    }
  }
  assert.deepEqual(getBindingForMode(bindings, "questions", "question-root", false), {
    notebookId: "whole-answer-set"
  })
  const scoped = getBindingForMode(bindings, "questions", "question-root", true)!
  assert.equal(scoped.rootNodeId, "answer-root")
  assert.deepEqual(targetForMode(scoped, false), { notebookId: "scoped-answer-set" })
})

test("绑定记录可保存章节顺序匹配方式和固定卡片 ID", () => {
  const target = normalizeBinding({
    notebookId: "answers",
    rootNodeId: "answer-root",
    matchMode: "parent-order",
    orderedPairing: {
      sourceNotebookId: "questions",
      sourceRootNodeId: "question-root",
      answerNotebookId: "answers",
      answerRootNodeId: "answer-root",
      createdAt: "2026-07-23T00:00:00.000Z",
      matchedGroups: 1,
      pairs: [{
        questionNodeId: "q1",
        questionNoteId: "qn1",
        answerNodeId: "a1",
        answerNoteId: "an1",
        parentTitle: "绪论",
        position: 0
      }]
    }
  })
  assert.equal(target?.matchMode, "parent-order")
  assert.equal(target?.orderedPairing?.pairs[0].answerNoteId, "an1")
})

test("绑定记录可保存独立正则模式和题目、答案规则", () => {
  const target = normalizeBinding({
    notebookId: "answers",
    matchMode: "regex",
    regexRules: {
      questionPattern: String.raw`第(\d+)题`,
      answerPattern: String.raw`答案-(\d+)`
    }
  })
  assert.equal(target?.matchMode, "regex")
  assert.equal(target?.regexRules?.questionPattern, String.raw`第(\d+)题`)
  assert.deepEqual(targetForMode(target!, false), target)
})

test("正则模式未填写规则时仍保留待配置状态", () => {
  const target = normalizeBinding({
    notebookId: "answers",
    matchMode: "regex"
  })
  assert.equal(target?.matchMode, "regex")
  assert.equal(target?.regexRules, undefined)
  assert.deepEqual(targetForMode(target!, false), target)
})

test("正则题目规则和答案规则独立提取相同匹配键", () => {
  const rules = {
    questionPattern: String.raw`第\s*(\d+)\s*章.*?第\s*(\d+)\s*题`,
    answerPattern: String.raw`答案\s*(\d+)-0*(\d+)`
  }
  assert.equal(extractQuestionRegexKey("第 3 章 第 12 题：弯曲", rules), "3\u001f12")
  assert.equal(extractAnswerRegexKey("答案 3-012", rules), "3\u001f12")
})

test("正则规则没有捕获组时使用完整匹配且无效表达式会被拒绝", () => {
  const fullMatchRules = {
    questionPattern: String.raw`Q-\d+`,
    answerPattern: String.raw`Q-\d+`
  }
  assert.equal(extractQuestionRegexKey("题目 Q-17", fullMatchRules), "q-17")
  assert.equal(validateRegexMatchingRules(fullMatchRules).valid, true)
  assert.equal(validateRegexMatchingRules({
    questionPattern: "(",
    answerPattern: String.raw`(\d+)`
  }).valid, false)
  assert.equal(validateRegexMatchingRules({
    questionPattern: String.raw`(a+)+`,
    answerPattern: String.raw`(\d+)`
  }).valid, false)
})

test("纯章节名与带标题章节名都能规范化用于父节点匹配", () => {
  assert.equal(normalizeParentTitle("第一章"), normalizeTitle("第一章"))
  assert.equal(normalizeParentTitle("第一章 绪论"), normalizeTitle("绪论"))
})

test("同名父节点仅在两侧直接子卡片数量相同时按顺序配对", () => {
  const child = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      nodeId: `${prefix}-node-${index}`,
      noteId: `${prefix}-note-${index}`,
      title: `${prefix}${index + 1}`
    }))
  const result = buildOrderedPairing(
    [
      { nodeId: "q-intro", title: "绪论与基本变形概念", children: child("q", 2) },
      { nodeId: "q-twist", title: "扭转", children: child("qt", 2) }
    ],
    [
      { nodeId: "a-intro", title: "第一部分 绪论", children: child("a", 2) },
      { nodeId: "a-twist", title: "扭转", children: child("at", 3) }
    ],
    {
      sourceNotebookId: "questions",
      sourceRootNodeId: "question-root",
      answerNotebookId: "answers",
      answerRootNodeId: "answer-root",
      createdAt: "2026-07-23T00:00:00.000Z"
    }
  )
  assert.equal(result.pairing.matchedGroups, 1)
  assert.deepEqual(
    result.pairing.pairs.map(pair => [pair.questionNodeId, pair.answerNodeId]),
    [["q-node-0", "a-node-0"], ["q-node-1", "a-node-1"]]
  )
  assert.deepEqual(
    result.previews.map(preview => [preview.parentTitle, preview.position, preview.questionTitle, preview.answerTitle]),
    [["绪论与基本变形概念", 0, "q1", "a1"], ["绪论与基本变形概念", 1, "q2", "a2"]]
  )
  assert.deepEqual(
    result.issues.map(issue => [issue.title, issue.reason, issue.sourceCount, issue.answerCount]),
    [["扭转", "count", 2, 3]]
  )
})

test("父节点标题重复时不进行不确定的顺序配对", () => {
  const group = (nodeId: string, title: string) => ({
    nodeId,
    title,
    children: [{
      nodeId: `${nodeId}-child`,
      noteId: `${nodeId}-note`,
      title: "卡片"
    }]
  })
  const result = buildOrderedPairing(
    [group("q1", "第一章 绪论"), group("q2", "绪论")],
    [group("a1", "第一部分 绪论")],
    {
      sourceNotebookId: "questions",
      sourceRootNodeId: "question-root",
      answerNotebookId: "answers",
      answerRootNodeId: "answer-root"
    }
  )
  assert.equal(result.pairing.pairs.length, 0)
  assert.equal(result.issues[0].reason, "ambiguous")
})

test("脑图范围按主脑图和公开 childMindMap API 划分", () => {
  const childId = "4C82C823-D256-4821-85AE-3FB0D5C4EBEB"
  const childMindMap = { noteId: childId }
  const notes = [
    { noteId: "main-card" },
    { noteId: childId },
    { noteId: "child-card-1", childMindMap },
    { noteId: "child-card-2", childMindMap }
  ]
  assert.equal(childMindMapNoteId(notes[0]), "")
  assert.equal(childMindMapNoteId(notes[2]), childId)
  assert.deepEqual(collectChildMindMapNoteIds(notes), [childId])
  assert.equal(mindMapScopeIdForNote(notes[0], [childId]), MAIN_MINDMAP_SCOPE_ID)
  assert.equal(mindMapScopeIdForNote(notes[1], [childId]), childId)
  assert.equal(mindMapScopeIdForNote(notes[2], [childId]), childId)
  assert.equal(noteBelongsToMindMapScope(notes[0], MAIN_MINDMAP_SCOPE_ID, [childId]), true)
  assert.equal(noteBelongsToMindMapScope(notes[1], MAIN_MINDMAP_SCOPE_ID, [childId]), false)
  assert.equal(noteBelongsToMindMapScope(notes[2], MAIN_MINDMAP_SCOPE_ID, [childId]), false)
  assert.equal(noteBelongsToMindMapScope(notes[1], childId), true)
  assert.equal(noteBelongsToMindMapScope(notes[2], childId), true)
})

test("父级错题分类包含路径下的全部子级", () => {
  const options = categoryPathPrefixes(["多元微分", "基本概念题", "概念题"])
  assert.deepEqual(options.map(item => item.label), [
    "多元微分",
    "多元微分 › 基本概念题",
    "多元微分 › 基本概念题 › 概念题"
  ])
  assert.equal(options[0].key, "path:多元微分")
  assert.equal(options[2].depth, 2)
})

test("标题标准化忽略全半角、空白、常见中英文标点和大小写", () => {
  assert.equal(normalizeTitle(" Ａbc ？\n"), "abc")
  assert.equal(normalizeTitle("什么是 FFT："), normalizeTitle("什么是fft?"))
})

test("错题按来源章节和自然题号稳定排序", () => {
  const base = createMistakeRecord({
    sourceNoteId: "s2",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "第10题",
    sourcePathTitles: ["基本概念题"],
    categoryPath: ["多元微分", "基本概念题"],
    level: 1
  }, new Date("2026-07-17T00:00:00.000Z"))
  const first = { ...base, recordId: "questions:s1", sourceNoteId: "s1", sourceTitle: "第2题" }
  const other = {
    ...base,
    recordId: "questions:s3",
    sourceNoteId: "s3",
    sourceTitle: "第1题",
    categoryPath: ["多元微分", "计算题"]
  }
  assert.deepEqual([base, other, first].sort(compareMistakeRecords).map(item => item.recordId), ["questions:s1", "questions:s2", "questions:s3"])
  assert.equal(mistakeCategoryLabel(first), "多元微分 › 基本概念题")
})

test("自定义标签直接作为标签并替换旧标签", () => {
  assert.deepEqual(
    mistakeSourceTags(["重点", "错题分类·计算题", "旧分类"], 2, ["新标签1", "新标签2"], ["旧分类"]),
    ["重点", "错题_掌握", "新标签1", "新标签2"]
  )
  assert.deepEqual(
    mistakeSourceTags(["重点", "错题", "错题2级", "新标签1"], 2, "新标签1", "新标签1"),
    ["重点", "错题_掌握", "新标签1"]
  )
  assert.deepEqual(
    withoutMistakeSourceTags(["重点", "错题", "错题2级", "错题_掌握", "新标签1", "新标签2"], ["新标签1", "新标签2"]),
    ["重点"]
  )
  assert.deepEqual(cleanMistakeTags([" #数学 ", "数学", "物理", "", "物理"]), ["数学", "物理"])
  assert.deepEqual(
    customMistakeTagsFromSource(["错题", "错题2级", "重点", "MN新增标签", "错题状态·S2", "错题分类·旧版"]),
    ["重点", "MN新增标签"]
  )
})

test("可从 MarginNote 标签恢复错题身份、等级和自定义标签", () => {
  assert.deepEqual(
    mistakeStateFromSourceTags(["错题", "错题4级", "傅里叶变换", "重点"]),
    { isMistake: true, level: 2, customTags: ["傅里叶变换", "重点"] }
  )
  assert.deepEqual(
    mistakeStateFromSourceTags(["错题状态·S2", "旧版标签"]),
    { isMistake: true, level: 1, customTags: ["旧版标签"] }
  )
  assert.deepEqual(
    mistakeStateFromSourceTags(["普通标签"]),
    { isMistake: false, level: undefined, customTags: ["普通标签"] }
  )
})

test("标签归一化：去 #、去重、保留首标签为 manualCategory", () => {
  assert.deepEqual(manualTagsOf({ manualCategories: ["A", "B"] }), ["A", "B"])
  assert.deepEqual(manualTagsOf({ manualCategory: "A" }), ["A"])
  assert.deepEqual(manualTagsOf({}), [])
})

test("错题来源分布按题目脑图根节点而不是学习集名称分组", () => {
  const records = [
    {
      recordId: "r1",
      sourceNotebookId: "study-set",
      sourceNotebookTitle: "材料力学",
      sourceRootNodeId: "root-a",
      sourceRootTitle: "第一章 拉伸",
      categoryPath: ["材料力学", "第一章 拉伸", "练习"],
      level: 0
    },
    {
      recordId: "r2",
      sourceNotebookId: "study-set",
      sourceNotebookTitle: "材料力学",
      sourceRootNodeId: "root-b",
      sourceRootTitle: "第二章 扭转",
      categoryPath: ["材料力学", "第二章 扭转", "练习"],
      level: 3
    },
    {
      recordId: "r3",
      sourceNotebookId: "study-set",
      sourceNotebookTitle: "材料力学",
      sourceRootNodeId: "root-a",
      sourceRootTitle: "第一章 拉伸",
      categoryPath: ["材料力学", "第一章 拉伸", "计算题"],
      level: 1
    }
  ]
  const sources = buildSourceInsights(records)
  assert.deepEqual(
    sources.map(source => [source.name, source.count, source.weak]),
    [["第一章 拉伸", 2, 2], ["第二章 扭转", 1, 0]]
  )
  assert.equal(sources.reduce((sum, source) => sum + source.count, 0), records.length)
  assert.deepEqual(sources[0].path, ["材料力学", "第一章 拉伸"])
})

test("同一学习集中的同名题目脑图按根节点 ID 分开显示", () => {
  const sources = buildSourceInsights([
    {
      recordId: "r1",
      sourceNotebookId: "study-set",
      sourceNotebookTitle: "题库",
      sourceRootNodeId: "root-a",
      sourceRootTitle: "习题",
      level: 0
    },
    {
      recordId: "r2",
      sourceNotebookId: "study-set",
      sourceNotebookTitle: "题库",
      sourceRootNodeId: "root-b",
      sourceRootTitle: "习题",
      level: 0
    }
  ])
  assert.equal(sources.length, 2)
  assert.deepEqual(sources.map(source => source.name), ["习题（1）", "习题（2）"])
  assert.notEqual(sources[0].key, sources[1].key)
})

test("错题来源可按题目脑图根节点生成多选项", () => {
  const records = [
    { recordId: "a1", sourceNotebookId: "book", sourceNotebookTitle: "高数", sourceRootNodeId: "root-a", sourceRootTitle: "极限题", sourcePathTitles: ["第一组", "极限题"], level: 0 },
    { recordId: "a2", sourceNotebookId: "book", sourceNotebookTitle: "高数", sourceRootNodeId: "root-a", sourceRootTitle: "极限题", sourcePathTitles: ["第二组", "极限题"], level: 2 },
    { recordId: "b1", sourceNotebookId: "book", sourceNotebookTitle: "高数", sourceRootNodeId: "root-b", sourceRootTitle: "导数题", sourcePathTitles: ["第一组", "导数题"], level: 1 }
  ]
  const options = buildMindMapOptions(records)
  assert.deepEqual(options.map(option => [option.name, option.count]), [["极限题", 2], ["导数题", 1]])
  assert.notEqual(options[0].key, options[1].key)
})

test("父节点统计会从一题一类自动上移到有效聚合层级", () => {
  const records = [
    ["r1", "题1", "极限"], ["r2", "题2", "极限"], ["r3", "题3", "极限"],
    ["r4", "题4", "导数"], ["r5", "题5", "导数"], ["r6", "题6", "导数"]
  ].map(([recordId, directParent, parentGroup], index) => ({
    recordId,
    sourceNotebookId: "book",
    sourceNotebookTitle: "高数",
    sourceRootNodeId: "root-a",
    sourceRootTitle: "章节题库",
    sourcePathTitles: [directParent, parentGroup, "章节题库"],
    categoryPath: ["高数", directParent, parentGroup, "章节题库"],
    level: index < 2 ? 1 : 3
  }))
  const result = buildParentInsights(records)
  assert.equal(result.selectedRecords, 6)
  assert.equal(result.classifiedRecords, 6)
  assert.equal(result.unclassifiedRecords, 0)
  assert.deepEqual(result.groups.map(group => [group.name, group.count]), [["导数", 3], ["极限", 3]])
})

test("父节点统计不会把全部错题强行显示成单一分类", () => {
  const records = ["r1", "r2", "r3", "r4"].map(recordId => ({
    recordId,
    sourceNotebookId: "book",
    sourceNotebookTitle: "高数",
    sourceRootNodeId: "root-a",
    sourceRootTitle: "章节题库",
    sourcePathTitles: ["同一父节点", "章节题库"],
    categoryPath: ["高数", "同一父节点", "章节题库"],
    level: 2
  }))
  const result = buildParentInsights(records)
  assert.equal(result.groups.length, 0)
  assert.equal(result.classifiedRecords, 0)
  assert.equal(result.unclassifiedRecords, 4)
})

test("父节点统计只计算用户选中的一个或多个脑图", () => {
  const makeRecords = (rootNodeId: string, rootTitle: string, prefix: string) => [
    ["a", "组A"], ["b", "组A"], ["c", "组B"], ["d", "组B"]
  ].map(([suffix, parent], index) => ({
    recordId: `${prefix}-${suffix}`,
    sourceNotebookId: "book",
    sourceNotebookTitle: "题库",
    sourceRootNodeId: rootNodeId,
    sourceRootTitle: rootTitle,
    sourcePathTitles: [parent, rootTitle],
    categoryPath: ["题库", parent, rootTitle],
    level: index
  }))
  const records = [...makeRecords("root-a", "脑图A", "a"), ...makeRecords("root-b", "脑图B", "b")]
  const options = buildMindMapOptions(records)
  const mapA = options.find(option => option.name === "脑图A")
  assert.ok(mapA)
  const result = buildParentInsights(records, [mapA.key])
  assert.equal(result.selectedMapCount, 1)
  assert.equal(result.selectedRecords, 4)
  assert.deepEqual(result.groups.map(group => [group.name, group.count]), [["组A", 2], ["组B", 2]])
})

test("索引同一卡片的重复标题只收录一次", () => {
  const answer = { id: "1", titles: ["问题？", "问题?"] }
  const index = buildIndex([answer])
  assert.equal(index.get("问题")?.length, 1)
})

test("答案候选会排除当前题目自身的 noteId", () => {
  const matches = [
    { noteId: "question", title: "题目自身" },
    { noteId: "answer", title: "真正答案" }
  ]
  assert.deepEqual(excludeAnswerNoteId(matches, "question"), [
    { noteId: "answer", title: "真正答案" }
  ])
})

test("标准答案标签排在普通匹配前", () => {
  const answers = [{ tags: [] }, { tags: ["标准答案"] }]
  assert.equal(rankAnswers(answers)[0], answers[1])
})

test("答案按评论、摘录、子卡片的优先级回退", () => {
  const base = { id: "1", titles: ["题"], tags: [], comments: [], excerpts: [], children: [] }
  assert.equal(extractAnswer({ ...base, comments: ["评论"], excerpts: ["摘录"] }), "评论")
  assert.equal(extractAnswer({ ...base, excerpts: ["摘录"] }), "摘录")
  assert.equal(
    extractAnswer({ ...base, children: [{ title: "定义", text: "内容" }] }),
    "【定义】\n内容"
  )
})

test("失效的合并卡片引用不会中断答案读取", () => {
  const note = {
    noteTitle: "测试题",
    excerptText: "摘录",
    comments: [
      { type: "LinkNote", noteid: "missing" },
      { type: "TextNote", text: "标准答案" }
    ],
    childNotes: []
  }
  const result = readSafeNote(note, () => undefined)
  assert.deepEqual(result.comments, ["标准答案"])
  assert.deepEqual(result.excerpts, ["摘录"])
  assert.equal(result.brokenLinks, 1)
})

test("完整卡片 HTML 包含图片摘录、图片评论和子卡片", () => {
  const note = {
    noteTitle: "答案",
    excerptPic: { paint: "excerpt-image" },
    excerptText: "OCR 文本",
    comments: [{ type: "PaintNote", paint: "comment-image" }],
    childNotes: [{ noteTitle: "子卡片", excerptText: "子卡片内容", comments: [] }]
  }
  const html = renderCardHtml(note, "问题", () => undefined, hash => `base64-${hash}`)
  assert.match(html, /base64-excerpt-image/)
  assert.match(html, /base64-comment-image/)
  assert.match(html, /__mnCardPreview/)
  assert.match(html, /color-scheme:light/)
  assert.doesNotMatch(html, /prefers-color-scheme:dark/)
  assert.match(html, /maximum-scale=3,user-scalable=yes/)
  assert.match(html, /子卡片内容/)
  assert.doesNotMatch(html, /OCR 文本/)
})

test("合并卡片会递归展示全部有效内容并阻止循环引用", () => {
  const first: any = {
    noteId: "first",
    noteTitle: "主卡片",
    excerptText: "主摘录",
    comments: [{ type: "LinkNote", noteid: "second" }]
  }
  const second: any = {
    noteId: "second",
    noteTitle: "合并摘录二",
    excerptText: "第二段摘录",
    comments: [
      { type: "TextNote", text: "第二段评论" },
      { type: "LinkNote", noteid: "first" }
    ]
  }
  const notes: Record<string, any> = { first, second }
  const html = renderCardHtml(first, "问题", id => notes[id], () => undefined)
  assert.match(html, /主摘录/)
  assert.match(html, /第二段摘录/)
  assert.match(html, /第二段评论/)
  assert.equal((html.match(/第二段摘录/g) ?? []).length, 1)
})

test("MN4 LinkNote 内嵌的全部合并文字、图片及评论会被展示", () => {
  const note = {
    noteTitle: "答案卡片",
    comments: [
      { type: "LinkNote", noteid: "unresolvable-1", q_htext: "合并文字摘录" },
      {
        type: "LinkNote",
        noteid: "unresolvable-2",
        q_htext: "图片 OCR",
        q_hpic: { paint: "merged-picture" }
      },
      { type: "TextNote", noteid: "unresolvable-1", text: "合并卡片文字评论" },
      {
        type: "HtmlNote",
        noteid: "unresolvable-2",
        text: "HTML 评论",
        html: "<strong>HTML 评论</strong>"
      },
      { type: "PaintNote", paint: "comment-picture" }
    ]
  }
  const html = renderCardHtml(note, "问题", () => undefined, hash => `data-${hash}`)
  assert.match(html, /合并文字摘录/)
  assert.match(html, /data-merged-picture/)
  assert.match(html, /合并卡片文字评论/)
  assert.match(html, /<strong>HTML 评论<\/strong>/)
  assert.match(html, /data-comment-picture/)
  assert.doesNotMatch(html, /图片 OCR/)
  assert.doesNotMatch(html, /class="merged"|合并摘录/)
})

test("同名卡片可通过最近祖先路径区分", () => {
  const questionPath = ["基本概念题", "概念题", "多元微分"]
  assert.ok(
    pathMatchScore(questionPath, ["基本概念题", "概念题", "答案脑图"]) >
      pathMatchScore(questionPath, ["常规", "概念题", "答案脑图"])
  )
})

test("手写评论兼容实际 marginpkg 中的 drawing 字段", () => {
  const note = {
    noteTitle: "1994数一",
    comments: [{ type: "PaintNote", drawing: "handwriting-media" }]
  }
  const html = renderCardHtml(
    note,
    "问题",
    () => undefined,
    () => undefined,
    hash => `drawing-${hash}`
  )
  assert.match(html, /canvas data-drawing-id="handwriting-media" data-drawing="drawing-handwriting-media"/)
  assert.doesNotMatch(html, /data:image\/jpeg;base64,drawing-handwriting-media/)
  assert.doesNotMatch(html, /手写内容不可用/)
})

test("PaintNote 同时包含底图和 drawing 时会叠加显示手写层", () => {
  const note = {
    noteTitle: "北京市2015年竞赛题",
    comments: [{ type: "PaintNote", paint: "question-image", drawing: "answer-drawing" }]
  }
  const html = renderCardHtml(
    note,
    "北京市2015年竞赛题",
    () => undefined,
    hash => `media-${hash}`,
    hash => `drawing-${hash}`
  )
  assert.match(html, /class="paint-note"/)
  assert.match(html, /media-question-image/)
  assert.match(html, /drawing-answer-drawing/)
  assert.match(html, /data-drawing-overlay="true"/)
  assert.match(html, /Math\.max\(img\.naturalHeight,Math\.ceil\(bounds\.maxY\+pad\)\)/)
})

test("OTA 版本比较支持正式版和 GitHub 测试版标签", () => {
  assert.equal(compareVersions("v1.9.0", "1.8.9"), 1)
  assert.equal(compareVersions("1.9.1-beta.2", "1.9.1-beta.1"), 1)
  assert.equal(compareVersions("1.9.1", "1.9.1-beta.2"), 1)
  assert.equal(compareVersions("v1.9.0", "1.9.0"), 0)
})

test("答案窗口位置不再被屏幕边界限制", () => {
  assert.deepEqual(
    freePositionFrame({ x: -640, y: 900, width: 600, height: 500 }),
    { x: -640, y: 900, width: 600, height: 500 }
  )
  assert.equal(
    isFrameFullyOutside(
      { x: -640, y: 100, width: 600, height: 500 },
      { x: 0, y: 0, width: 1024, height: 768 }
    ),
    true
  )
})

test("旧六级及合并式错题标签可检测并迁移为独立的新等级标签", () => {
  assert.equal(hasLegacyMistakeLevelTag(["错题", "错题4级"]), true)
  assert.equal(legacyMistakeLevelFromTags(["错题", "错题4级"]), 2)
  assert.equal(hasLegacyMistakeLevelTag(["错题", "错题不熟"]), true)
  assert.equal(legacyMistakeLevelFromTags(["错题", "错题不熟"]), 1)
  assert.deepEqual(mistakeSourceTags(["错题", "错题4级", "计算题"], 2, ["计算题"]), ["错题_掌握", "计算题"])
  assert.deepEqual(mistakeStateFromSourceTags(["错题", "不会", "概念题"]), {
    isMistake: true,
    level: undefined,
    customTags: ["不会", "概念题"]
  })
  assert.deepEqual(mistakeStateFromSourceTags(["错题_不熟", "概念题"]), {
    isMistake: true,
    level: 1,
    customTags: ["概念题"]
  })
  assert.deepEqual(mistakeStateFromSourceTags(["错题_掌握"]), {
    isMistake: true,
    level: 2,
    customTags: []
  })
})

test("裸不会/不熟/掌握始终属于用户标签，不能恢复错题或在取消错题时删除", () => {
  for (const tag of ["不会", "不熟", "掌握"]) {
    assert.deepEqual(mistakeStateFromSourceTags([tag, "普通标签"]), {
      isMistake: false,
      level: undefined,
      customTags: [tag, "普通标签"]
    })
    assert.deepEqual(customMistakeTagsFromSource([tag, "错题_不熟"]), [tag])
    assert.deepEqual(withoutMistakeSourceTags([tag, "错题_掌握", "普通标签"]), [tag, "普通标签"])
    assert.deepEqual(mistakeSourceTags([tag, "普通标签"], 0), [tag, "普通标签", "错题_不会"])
  }
})

test("旧错题托管标签会被识别为待迁移，当前三级标签不会重复迁移", () => {
  for (const tag of ["错题", "错题0级", "错题5级", "错题不会", "错题状态·S3"]) {
    assert.equal(hasLegacyManagedMistakeTag([tag]), true)
  }
  assert.equal(hasLegacyManagedMistakeTag(["错题_不会", "普通标签"]), false)
})

test("自定义标签不会覆盖题目标题下方的来源分类", () => {
  const record = createMistakeRecord({
    sourceNoteId: "source-with-tags",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "条件极值",
    sourcePathTitles: ["极值问题", "条件极值"],
    categoryPath: ["多元微分", "极值问题", "条件极值"],
    manualCategories: ["计算题", "需要重做"],
    manualCategory: "计算题",
    level: 1
  }, new Date("2026-08-27T00:00:00.000Z"))
  assert.equal(mistakeCategoryLabel(record), "多元微分 › 极值问题 › 条件极值")
  assert.deepEqual(manualTagsOf(record), ["计算题", "需要重做"])
})

test("答案卡片文字支持 Markdown 和行内、块级 LaTeX", () => {
  const note = {
    noteTitle: "Markdown 答案",
    excerptText: "## 结论\n\n- 第一项\n- 第二项",
    comments: [
      { type: "TextNote", text: "行内公式 $E=mc^2$ 和 **重点**" },
      { type: "TextNote", text: "$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$" },
      { type: "TextNote", text: "代码中的公式不渲染：`$x$`" }
    ]
  }
  const html = renderCardHtml(note, "问题", () => undefined, () => undefined)
  assert.match(html, /<h2>结论<\/h2>/)
  assert.match(html, /<li>第一项<\/li>/)
  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /<span class="katex"><math/)
  assert.match(html, /<math[^>]*display="block"/)
  assert.match(html, /<code>\$x\$<\/code>/)
})


test("scoped 解除绑定同时清除笔记本级回退键，避免假解除", () => {
  const plugin = readFileSync("src/plugin.ts", "utf8")
  const start = plugin.indexOf("export async function unbindCurrent")
  const end = plugin.indexOf("export async function openMenu", start)
  const body = plugin.slice(start, end)
  const scopedBranch = body.slice(body.indexOf("  } else {"))
  assert.match(scopedBranch, /removeBinding\(bindings, questionNotebookId, source\.rootNodeId\)/)
  assert.match(scopedBranch, /if \(notebookLevel\) \{\s*removeBinding\(bindings, questionNotebookId\)/)
  assert.match(body, /回退绑定一并移除/)
})

test("索引快照存 cachePath 文件并带旧存储迁移", () => {
  const store = readFileSync("src/index-store.ts", "utf8")
  assert.match(store, /MN\.app\.cachePath/)
  assert.match(store, /writeTextFile\(path, payload\)/)
  assert.match(store, /INDEX_KEY_PREFIX\}\$\{notebookId\}/)
  assert.match(store, /迁移到文件|迁移成功后清空旧键|旧版快照存 NSUserDefaults/)
})


test("describeError 透传已策划的用户文案，吞不掉具体提示", () => {
  assert.equal(
    describeError(new Error("原题脑图尚未加载完成，请稍后重试"), "fallback"),
    "原题脑图尚未加载完成，请稍后重试"
  )
  assert.match(describeError(new Error("更新包下载不完整（4KB）"), "fallback"), /更新包下载不完整/)
  assert.equal(describeError(new Error("noteId invalid"), "fallback"), "所选卡片无效，请重新选择")
})

test("跨脑图定位使用官方 MN4 卡片链接并保留 MN3 回退", () => {
  assert.equal(noteReferenceUrl("note id"), "marginnote4app://note/note%20id")
  const [primary, legacy] = noteReferenceUrlCandidates("note id")
  assert.equal(primary, "marginnote4app://note/note%20id")
  assert.equal(legacy, "marginnote3app://note/note%20id")
})

test("三档掌握状态采用 1/3/7、2/5/10、14 天复习间隔", () => {
  const now = new Date("2026-07-17T00:00:00.000Z")
  assert.equal(nextReviewTime(0, 0, now).toISOString(), "2026-07-18T00:00:00.000Z")
  assert.equal(nextReviewTime(0, 1, now).toISOString(), "2026-07-20T00:00:00.000Z")
  assert.equal(nextReviewTime(1, 2, now).toISOString(), "2026-07-27T00:00:00.000Z")
  assert.equal(nextReviewTime(2, 0, now).toISOString(), "2026-07-31T00:00:00.000Z")
})

test("旧六级复习天数不会污染三档复习曲线", () => {
  assert.deepEqual(normalizeMistakeReviewCurves({
    0: [1], 1: [1], 2: [3], 3: [7, 14], 4: [30], 5: [60]
  }), { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] })
  assert.deepEqual(normalizeMistakeReviewCurves({
    0: [4, 8, 12], 1: [6, 9, 15], 2: [21]
  }), { 0: [4, 8, 12], 1: [6, 9, 15], 2: [21] })
})

test("自定义错题复习天数会用于新标记和完成复习后的调度", () => {
  const now = new Date("2026-07-17T00:00:00.000Z")
  const curves = { 0: [2, 4, 8], 1: [3, 6, 12], 2: [20] }
  assert.equal(nextReviewTime(1, 0, now, curves).toISOString(), "2026-07-20T00:00:00.000Z")
  assert.equal(nextReviewTime(1, 1, now, curves).toISOString(), "2026-07-23T00:00:00.000Z")
})

test("错题记录保存首次时间、复习历史和下次到期时间", () => {
  const createdAt = new Date("2026-07-17T00:00:00.000Z")
  const record = createMistakeRecord({
    sourceNoteId: "source",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "题目脑图",
    sourceTitle: "1994数一",
    sourcePathTitles: ["基本概念题"],
    answerNotebookId: "answers",
    level: 1
  }, createdAt)
  const reviewed = reviewMistake(record, 1, new Date("2026-07-18T00:00:00.000Z"))
  assert.equal(reviewed.reviewCount, 1)
  assert.equal(reviewed.history.length, 2)
  assert.equal(reviewed.nextReviewAt, "2026-07-23T00:00:00.000Z")
  assert.equal(isDue(reviewed, new Date("2026-07-23T00:00:00.000Z")), true)
})

test("改档与同档统一由 reviewMistake 推算：改档重置序列，同档推进，掌握二次确认后结束", () => {
  const created = createMistakeRecord({
    sourceNoteId: "source-2",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "题目脑图",
    sourceTitle: "复习机制",
    sourcePathTitles: [],
    level: 0
  }, new Date("2026-07-17T00:00:00.000Z"))
  const changed = reviewMistake(created, 2, new Date("2026-07-18T00:00:00.000Z"))
  assert.equal(changed.reviewCount, 0)
  assert.equal(changed.reviewCompleted, false)
  assert.equal(changed.nextReviewAt, "2026-08-01T00:00:00.000Z")
  const confirmed = reviewMistake(changed, 2, new Date("2026-08-01T00:00:00.000Z"))
  assert.equal(confirmed.reviewCount, 1)
  assert.equal(confirmed.reviewCompleted, true)
  assert.equal(isDue(confirmed, new Date("2026-08-20T00:00:00.000Z")), false)
})

test("到期口径统一为日历日：今天 24 点前到期即计入（含已逾期）", () => {
  // 今天 18:00 到期，当前 12:00：日历口径应计入（此前严格时刻判定会漏）
  const dueTodayAt6pm = {
    reviewCompleted: false,
    nextReviewAt: new Date(2026, 6, 18, 18, 0, 0).toISOString()
  } as any
  assert.equal(isDue(dueTodayAt6pm, new Date(2026, 6, 18, 12, 0, 0)), true)
  // 已逾期同样计入（待复习"已逾期"页签的题目属于到期）
  assert.equal(isDue(dueTodayAt6pm, new Date(2026, 6, 19, 12, 0, 0)), true)
  // 明天才到期 → 不计入
  const dueTomorrow = {
    reviewCompleted: false,
    nextReviewAt: new Date(2026, 6, 19, 9, 0, 0).toISOString()
  } as any
  assert.equal(isDue(dueTomorrow, new Date(2026, 6, 18, 12, 0, 0)), false)
  // 已结束复习 → 永不计入
  assert.equal(isDue({ reviewCompleted: true, nextReviewAt: new Date(2026, 6, 18, 18, 0, 0).toISOString() } as any,
    new Date(2026, 6, 18, 12, 0, 0)), false)
})
