import { createWindowSurface } from "./window-opacity"
import { MN } from "marginnote"
import { UI_COLORS } from "./ui-tokens"
import { loadMatcherSettings } from "./settings"
import { reviewResultHint, type MistakeRecord, type MistakeLevel } from "./mistake-domain"

const BUTTON_WIDTH = 96
const BUTTON_HEIGHT = 34
const TOOLBAR_HEIGHT = BUTTON_HEIGHT * 2 + 6
const DROPDOWN_GAP = 4
const DROPDOWN_HEIGHT = BUTTON_HEIGHT * 3 + DROPDOWN_GAP * 4
const DROPDOWN_WIDTH = BUTTON_WIDTH

function toolbarButton(title: string, color: string, selector: string): UIButton {
  const button = UIButton.buttonWithType(0)
  button.setTitleForState(title, 0)
  button.setTitleColorForState(UIColor.whiteColor(), 0)
  button.backgroundColor = UIColor.colorWithHexString(color)
  button.layer.cornerRadius = 7
  button.layer.masksToBounds = false
  const layer = button.layer as any
  layer.shadowColor = UIColor.blackColor()
  layer.shadowOffset = { width: 0, height: 1 }
  layer.shadowRadius = 2
  layer.shadowOpacity = 0.35
  button.addTargetActionForControlEvents(self, selector, 1 << 6)
  return button
}

export function createAnswerToolbar(): UIView {
  destroyAnswerToolbar()
  const toolbar = createWindowSurface({ x: 0, y: 0, width: BUTTON_WIDTH, height: TOOLBAR_HEIGHT })
  toolbar.backgroundColor = UIColor.clearColor()

  const answerButton = toolbarButton("查找答案", UI_COLORS.accent, "onAnswerToolbarSingleTap:")
  answerButton.frame = { x: 0, y: 0, width: BUTTON_WIDTH, height: BUTTON_HEIGHT }
  const answerLongPress = new UILongPressGestureRecognizer(self, "onAnswerToolbarLongPress:")
  answerLongPress.minimumPressDuration = 0.55
  answerLongPress.cancelsTouchesInView = false
  answerButton.addGestureRecognizer(answerLongPress)
  toolbar.addSubview(answerButton)

  const mistakeButton = toolbarButton("标记错题", UI_COLORS.action, "onMistakeToolbarClick:")
  mistakeButton.frame = { x: 0, y: BUTTON_HEIGHT + 6, width: BUTTON_WIDTH, height: BUTTON_HEIGHT }
  toolbar.addSubview(mistakeButton)

  self.answerToolbarButton = answerButton
  self.answerToolbarLongPressGesture = answerLongPress
  self.mistakeToolbarButton = mistakeButton
  const dropdown = createWindowSurface({ x: 0, y: 0, width: DROPDOWN_WIDTH, height: DROPDOWN_HEIGHT })
  dropdown.backgroundColor = UIColor.colorWithHexString(UI_COLORS.surface)
  dropdown.layer.cornerRadius = 9
  dropdown.layer.masksToBounds = false
  const dropdownLayer = dropdown.layer as any
  dropdownLayer.shadowColor = UIColor.blackColor()
  dropdownLayer.shadowOffset = { width: 0, height: 2 }
  dropdownLayer.shadowRadius = 5
  dropdownLayer.shadowOpacity = 0.24
  const levelButtons: UIButton[] = []
  ;[
    ["不会", UI_COLORS.level0, "onMistakeLevel0Click:"],
    ["不熟", UI_COLORS.level1, "onMistakeLevel1Click:"],
    ["掌握", UI_COLORS.level2, "onMistakeLevel2Click:"]
  ].forEach(([title, color, selector], index) => {
    const button = toolbarButton(title, color, selector)
    button.titleLabel.font = UIFont.systemFontOfSize(13)
    button.frame = {
      x: DROPDOWN_GAP,
      y: DROPDOWN_GAP + index * (BUTTON_HEIGHT + DROPDOWN_GAP),
      width: DROPDOWN_WIDTH - DROPDOWN_GAP * 2,
      height: BUTTON_HEIGHT
    }
    dropdown.addSubview(button)
    levelButtons.push(button)
  })
  dropdown.hidden = true
  self.mistakeLevelDropdown = dropdown
  self.mistakeLevelButtons = levelButtons
  toolbar.hidden = true
  return toolbar
}

function parseWinRect(winRect: string): {
  x: number
  y: number
  width: number
  height: number
} | undefined {
  try {
    const values = JSON.parse(`[${winRect.replace(/[{}]/g, "")}]`) as number[]
    if (values.length !== 4 || values.some(value => !Number.isFinite(value))) return
    return { x: values[0], y: values[1], width: values[2], height: values[3] }
  } catch {
    return
  }
}

export function showAnswerToolbar(winRect: string): void {
  if (!loadMatcherSettings().cardToolbarEnabled) return
  const rect = parseWinRect(winRect)
  if (!rect || !self.answerToolbar) return

  const studyFrame = MN.studyController.view.frame
  const cardX = rect.x - studyFrame.x
  const cardY = rect.y - studyFrame.y
  const gap = 8
  const rightX = cardX + rect.width + gap
  const leftX = cardX - BUTTON_WIDTH - gap
  const x =
    rightX + BUTTON_WIDTH <= studyFrame.width - gap
      ? rightX
      : Math.max(gap, leftX)
  const maxY = Math.max(gap, studyFrame.height - TOOLBAR_HEIGHT - gap)
  const y = Math.max(
    gap,
    Math.min(maxY, cardY + (rect.height - TOOLBAR_HEIGHT) / 2)
  )

  self.answerToolbar.frame = { x, y, width: BUTTON_WIDTH, height: TOOLBAR_HEIGHT }
  hideMistakeLevelDropdown()
  self.answerToolbar.hidden = false
  if (!self.answerToolbar.superview) {
    MN.studyController.view.addSubview(self.answerToolbar)
  }
  self.answerToolbarShownAt = Date.now()
}

export function cardMistakeAnchor(owner: any, noteID: string, host: any): { x: number; y: number; width: number; height: number } | undefined {
  const cached = owner.answerToolbarNoteId === noteID ? owner.answerToolbarTargetRect : undefined
  if (cached) return host === owner.window ? { ...cached } : { ...cached, x: cached.x - host.frame.x, y: cached.y - host.frame.y }
  const study = Application.sharedInstance().studyController(owner.window)
  const map = study?.notebookController?.mindmapView
  const entry = (Array.from(map?.selViewLst ?? []) as any[]).find(item => String(item?.note?.note?.noteId ?? item?.note?.noteId ?? '') === noteID)
  const view = entry?.view ?? entry
  if (!view?.superview || !view.bounds || typeof view.convertRectToView !== 'function') return
  try {
    const rect = view.convertRectToView(view.bounds, host)
    if ([rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0) return rect
  } catch {}
}

export function updateMistakeToolbarTitle(isExistingMistake: boolean, record?: MistakeRecord): void {
  self.mistakeToolbarButton?.setTitleForState(isExistingMistake ? "复习结果" : "标记错题", 0)
  const curves = loadMatcherSettings().mistakeReviewCurves
  ;["不会", "不熟", "掌握"].forEach((title, level) => self.mistakeLevelButtons?.[level]?.setTitleForState(`${title}  ${reviewResultHint(record, level as MistakeLevel, curves)}`, 0))
}

export function hideAnswerToolbar(owner: any = self): void {
  if (owner.answerToolbar) owner.answerToolbar.hidden = true
  hideMistakeLevelDropdown(owner)
}

export function showMistakeLevelDropdown(): void {
  const dropdown = self.mistakeLevelDropdown
  const toolbar = self.answerToolbar
  if (!dropdown || !toolbar || toolbar.hidden) return
  const studyFrame = MN.studyController.view.frame
  const below = toolbar.frame.y + toolbar.frame.height + 5
  const y = below + DROPDOWN_HEIGHT <= studyFrame.height - 8
    ? below
    : Math.max(8, toolbar.frame.y - DROPDOWN_HEIGHT - 5)
  dropdown.frame = { x: Math.max(8, Math.min(toolbar.frame.x, studyFrame.width - DROPDOWN_WIDTH - 8)), y, width: DROPDOWN_WIDTH, height: DROPDOWN_HEIGHT }
  dropdown.hidden = false
  if (!dropdown.superview) MN.studyController.view.addSubview(dropdown)
}

export function hideMistakeLevelDropdown(owner: any = self): void {
  if (owner.mistakeLevelDropdown) owner.mistakeLevelDropdown.hidden = true
}

export function toggleMistakeLevelDropdown(): void {
  if (!self.mistakeLevelDropdown || !self.answerToolbar || self.answerToolbar.hidden) return
  if (self.mistakeLevelDropdown.hidden) showMistakeLevelDropdown()
  else hideMistakeLevelDropdown()
}

export function destroyAnswerToolbar(): void {
  const toolbar = self.answerToolbar
  if (toolbar?.superview) toolbar.removeFromSuperview()
  self.answerToolbar = undefined
  self.answerToolbarButton = undefined
  self.answerToolbarLongPressGesture = undefined
  self.mistakeToolbarButton = undefined
  const dropdown = self.mistakeLevelDropdown
  if (dropdown?.superview) dropdown.removeFromSuperview()
  self.mistakeLevelDropdown = undefined
  self.mistakeLevelButtons = undefined
}
