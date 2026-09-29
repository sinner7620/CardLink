/** Web、原生控件与卡片 HTML 共用的唯一语义色值源。 */
export const UI_COLORS = {
  /** 主操作、选中态和链接强调色 */
  accent: "#0e8dfd",
  /** 选中态和原生入口的中性灰底 */
  grayFill: "#d8d8dd",
  /** 次操作（标记错题）：琥珀橙，与插件内不熟档位同源色 */
  action: "#ff9f0a",
  /** 三档等级色：进度条、图例、Web 控件与原生侧边卡片共用 */
  level0: "#ff453a",
  level1: "#ff9f0a",
  level2: "#30d158",
  /** 下拉面板底色：柔化纸感（原纯白） */
  surface: "#f7f8fa"
} as const

export function installWebUiColors(style: { setProperty(name: string, value: string): void }): void {
  style.setProperty("--mn-accent", UI_COLORS.accent)
  style.setProperty("--mn-gray-fill", UI_COLORS.grayFill)
  style.setProperty("--mn-level-0", UI_COLORS.level0)
  style.setProperty("--mn-level-1", UI_COLORS.level1)
  style.setProperty("--mn-level-2", UI_COLORS.level2)
}
