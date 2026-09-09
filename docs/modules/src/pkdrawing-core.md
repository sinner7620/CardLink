# pkdrawing-core.ts — PKDrawing 解码器单一来源（R3）
## 职责
PencilKit 手写数据解码唯一实现：bplist/NSKeyedArchiver/wrd 流/笔迹字段（libfreeform 语义）。
## 消费方
pkdrawing-svg（TS 侧）与 pkdrawing-core-webview（构建期 IIFE 注入画布脚本）。
## 验收
两侧解码行为一致（构建锚点验证）。