import React from "react"

// 设置项图标：SF Symbols 官方 SVG（SF-Symbols-7.0.4 导出，fill=currentColor）。
// 颜色按大类统一（tone），底色为同色淡渐变（符合 UI 规范的浅底+同色字形模式）。
import link from "./sf/link.svg?raw"
import book from "./sf/book.svg?raw"
import sliders from "./sf/sliders.svg?raw"
import refresh from "./sf/refresh.svg?raw"
import linkBreak from "./sf/unlink.svg?raw"
import flag from "./sf/flag.svg?raw"
import share from "./sf/export.svg?raw"
import toggle from "./sf/toggle.svg?raw"
import info from "./sf/info.svg?raw"
import guide from "./sf/guide.svg?raw"
import arrowsLR from "./sf/arrowsLR.svg?raw"
import reset from "./sf/reset.svg?raw"
import update from "./sf/update.svg?raw"
import fileText from "./sf/fileText.svg?raw"
import wifi from "./sf/wifi.svg?raw"
import close from "./sf/close.svg?raw"
import locate from "./sf/locate.svg?raw"

const svgs = { link, notebook: book, sliders, refresh, unlink: linkBreak, flag, download: share, toggle, info, guide, arrowsLR, reset, update, fileText, wifi, close, locate }

// 大类 tone → 色板色（--mn-* 同源：accent / level1 / level2 / level0）
export const SF_TONE_COLORS = {
  accent: "#0e8dfd",
  amber: "#ff9f0a",
  green: "#30d158",
  red: "#ff453a"
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "")
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function SFTileIcon({ name, tone = "accent" }) {
  const raw = (name && svgs[name]) || svgs.info
  const color = SF_TONE_COLORS[tone] || SF_TONE_COLORS.accent
  return <i
    className="sfIcon"
    aria-hidden="true"
    style={{
      color,
      background: `linear-gradient(to bottom, ${rgba(color, 0.12)}, ${rgba(color, 0.22)})`
    }}
    dangerouslySetInnerHTML={{ __html: raw.replace(/<svg /, '<svg class="sfIconGlyph" ') }}
  />
}
