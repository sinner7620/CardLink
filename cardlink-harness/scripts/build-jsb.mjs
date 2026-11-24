/**
 * P4-0：HarnessCore JSB 打包 + 残留门禁（§4 构建规则）。
 * 1) esbuild IIFE 单文件（platform: neutral，不注入 Buffer/process polyfill）；
 * 2) 自动门禁：扫描产物是否残留 node: 内建、Buffer、process、动态 require——
 *    不得通过 external 标记掩盖问题；
 * 3) 装载冒烟：node 加载产物，验证全局导出可访问（"JSB.require 成功、全局导出可访问"
 *    的开发机等价检查；真机装载属 P5 验收）。
 */
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist");
const outFile = path.join(outDir, "HarnessCore.js");

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "jsb-entry.ts")],
  bundle: true,
  minify: true,
  platform: "neutral",
  format: "iife",
  target: "es2020",
  globalName: "CardLinkHarness",
  outfile: outFile,
  // 故意不设 external：任何 Node 内建引用都应在此处构建失败或被门禁拦截。
  logLevel: "info",
});

// —— 残留门禁 ——
const bundle = await readFile(outFile, "utf8");
const patterns = [
  [/node:[a-z_]+/g, "node: 内建模块引用"],
  [/\bBuffer\b/g, "Buffer 引用"],
  [/\bprocess\.env\b/g, "process.env 引用"],
  [/\bprocess\.exit\b/g, "process.exit 引用"],
  [/\brequire\s*\(/g, "动态 require 调用"],
  [/__dirname|__filename/g, "CommonJS 路径全局"],
  [/import\s*\(/g, "动态 import"],
];
const violations = [];
for (const [re, label] of patterns) {
  const matches = bundle.match(re);
  if (matches) violations.push(`${label}: ${matches.length} 处`);
}
if (violations.length) {
  console.error(`[gate] HarnessCore 残留 Node 运行时依赖，打包拒绝:\n${violations.join("\n")}`);
  process.exit(1);
}

// —— 装载冒烟（开发机等价检查）——
const probe = `
require("./HarnessCore.js");
if (typeof globalThis.CardLinkHarness?.createHarness !== "function") {
  console.error("[gate] 全局导出 CardLinkHarness.createHarness 不可访问");
  process.exit(1);
}
console.log("[gate] HarnessCore 装载冒烟通过: createHarness 可用");
`;
await writeFile(path.join(outDir, ".load-probe.cjs"), probe, "utf8");
const check = spawnSync(process.execPath, [path.join(outDir, ".load-probe.cjs")], { cwd: outDir, encoding: "utf8" });
if (check.status !== 0) {
  console.error(`[gate] 装载冒烟失败:\n${check.stdout}${check.stderr}`);
  process.exit(1);
}
console.log(check.stdout.trim());
console.log(`[gate] 通过 → ${outFile} (${bundle.length} 字节)`);
