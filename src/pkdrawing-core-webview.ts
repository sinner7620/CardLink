// R3：webview 画布脚本的构建期入口。build.mjs 把本文件编译成 IIFE，
// 通过 __PKDRAWING_CORE_SCRIPT__ define 注入 pkdrawing-renderer.ts 的脚本字符串，
// 保证画布侧与 TS 侧永远共用同一个解码器。
import { all, decodeStrokes, drawingData, f32, fields, one } from "./pkdrawing-core"

;(globalThis as any).__mnPkdrawingCore = { all, decodeStrokes, drawingData, f32, fields, one }
