import { UI_COLORS } from "./ui-tokens"

/** The existing practice quick menu and annotation review share one surface. */
export function styleQuickMenuSurface(view: UIView, radius = 18, opacity = 0.94): void {
  view.backgroundColor = UIColor.colorWithHexString(UI_COLORS.surface).colorWithAlphaComponent(opacity)
  view.layer.cornerRadius = radius
}

/** One distinct shell, clear chrome, and a brighter inset list. */
export function styleAnnotationReviewSurface(view: UIView, part: "shell" | "chrome" | "list"): void {
  if (part === "chrome") {
    view.backgroundColor = UIColor.clearColor()
    view.layer.cornerRadius = 0
    return
  }
  if (part === "list") {
    view.backgroundColor = UIColor.whiteColor().colorWithAlphaComponent(0.58)
    view.layer.cornerRadius = 12
    view.layer.borderWidth = 0.5
    view.layer.borderColor = UIColor.colorWithHexString("#cbd5e1").colorWithAlphaComponent(0.75)
    return
  }
  view.backgroundColor = UIColor.colorWithHexString("#f7f8fa").colorWithAlphaComponent(0.78)
  view.layer.cornerRadius = 20
  view.layer.borderWidth = 0.75
  view.layer.borderColor = UIColor.colorWithHexString("#94a3b8").colorWithAlphaComponent(0.65)
  // The controls clip their contents separately; the single shell casts shadow.
  view.layer.masksToBounds = false
  const layer = view.layer as any
  layer.shadowColor = UIColor.colorWithHexString("#172033")
  layer.shadowOffset = { width: 0, height: 4 }
  layer.shadowRadius = 10
  layer.shadowOpacity = 0.14
}
