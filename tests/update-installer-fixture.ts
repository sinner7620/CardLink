export const addonId = "marginnote.extension.mn4-answer-matcher"
export const target = `/extensions/${addonId}`
export const files = new Map<string, any>()
export const moves: string[][] = []
export const options = { version: "9.9.9", id: addonId, unzip: true, missing: "", failBackup: false, failInstall: false, failRestore: false }
export function resetInstaller() {
  files.clear(); moves.length = 0
  Object.assign(options, { version: "9.9.9", id: addonId, unzip: true, missing: "", failBackup: false, failInstall: false, failRestore: false })
  files.set(target, true)
  files.set(`${target}/mnaddon.json`, { addonid: addonId, version: "2.3.3-beta.28" })
  files.set(`${target}/old-only.js`, "old")
}
export function readJSON(path: string) { return files.get(path) }
export function installNativeMocks() {
  Object.assign(globalThis, {
    self: { mainPath: target },
    NSFileManager: { defaultManager: () => ({
      fileExistsAtPath: (p: string) => files.has(p),
      createDirectoryAtPathWithIntermediateDirectoriesAttributes: (p: string) => { files.set(p, true); return true },
      moveItemAtPathToPath: (from: string, to: string) => {
        moves.push([from, to])
        if ((options.failBackup && from === target) || (options.failInstall && from.endsWith("/new")) || (options.failRestore && from.endsWith("/previous"))) return false
        if (!files.has(from) || files.has(to)) return false
        for (const [key, value] of [...files]) if (key === from || key.startsWith(`${from}/`)) { files.delete(key); files.set(to + key.slice(from.length), value) }
        return true
      }
    }) },
    ZipArchive: { unzipFileAtPathToDestination: (_file: string, dest: string) => {
      if (!options.unzip) return false
      files.set(dest, true)
      files.set(`${dest}/mnaddon.json`, { addonid: options.id, version: options.version })
      for (const name of ["main.js", "AnswerMatcherCore.js", "WebAddon.js", "WebPanelController.js", "web-dist/index.html", "web-dist/app.js"]) if (name !== options.missing) files.set(`${dest}/${name}`, "new")
      return true
    } }
  })
}
