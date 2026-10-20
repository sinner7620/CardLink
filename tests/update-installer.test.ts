import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { files, moves, options, target, readJSON, resetInstaller, installNativeMocks } from "./update-installer-fixture"

installNativeMocks()
mock.module("marginnote", { namedExports: { readJSON, MN: { app: { cachePath: "/cache" } } } })
async function install() { return (await import("../src/update-installer")).installUpdatePackage("/download.mnaddon", target, "9.9.9") }

test("完整替换目录，保留旧版本备份，不混入旧文件", async () => {
  resetInstaller()
  const result = await install()
  assert.equal(readJSON(`${target}/mnaddon.json`).version, "9.9.9")
  assert.equal(files.has(`${target}/old-only.js`), false)
  assert.equal(files.get(`${result.backup}/old-only.js`), "old")
})
test("错误 ID、版本、缺文件、解压失败均在移走旧目录前拒绝", async () => {
  for (const change of [{ id: "other" }, { version: "8.8.8" }, { version: "0.0.1" }, { missing: "main.js" }, { unzip: false }]) {
    resetInstaller(); Object.assign(options, change)
    await assert.rejects(install)
    assert.equal(moves.length, 0)
    assert.equal(files.get(`${target}/old-only.js`), "old")
  }
})
test("备份失败不替换；替换失败恢复旧目录；恢复失败提供备份位置", async () => {
  resetInstaller(); options.failBackup = true
  await assert.rejects(install, /备份失败/)
  assert.equal(moves.length, 1)
  resetInstaller(); options.failInstall = true
  await assert.rejects(install, /已恢复旧版本/)
  assert.equal(files.get(`${target}/old-only.js`), "old")
  resetInstaller(); options.failInstall = options.failRestore = true
  await assert.rejects(install, /旧版本保留于 \/cache\/CardLink\/updates\//)
  assert.ok([...files.keys()].some(k => k.endsWith("/previous/old-only.js")))
})
test("不接受未知安装路径和重复安装同版本", async () => {
  resetInstaller()
  const { installUpdatePackage } = await import("../src/update-installer")
  assert.throws(() => installUpdatePackage("/a.mnaddon", "/extensions/other"), /目录不可用/)
  await install()
  assert.throws(() => installUpdatePackage("/a.mnaddon", target), /不高于/)
})
