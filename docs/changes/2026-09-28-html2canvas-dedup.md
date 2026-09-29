# html2canvas 安装包去重

## 目的与实现

消除工作台 app.js 内嵌的 html2canvas 副本，保留安装包内唯一 vendor 文件和原有 PDF 导出链路。首次 OCR/手写截图等待本地脚本加载，连续/并发请求复用；资源加载失败或未提供全局函数时进入已有题目失败处理，后续请求允许重新加载。

工作台加载器在 app.js 执行时记录脚本 URL，供正式页面和跨目录的源码预览定位 vendor；开发模式以页面目录定位资源，Vite 中间件读取锁定依赖的本地文件。截图库版本、截图参数、数据格式与存储路径不变，无迁移。

## 影响文件

- `web/src/lib/html2canvas-loader.mjs`：本地脚本加载与复用。
- `web/src/main.jsx`：截图前等待依赖。
- `web/vite.config.js`：开发环境本地 vendor 路由。
- `tests/html2canvas-loader.test.mjs`、`tests/ai-subsystem.test.ts`：加载行为与调用链检查。
- `docs/pages/settings.md`、`package.json`、`RELEASE_NOTES_v2.4.4-b45.md`：契约、版本和发布说明。

## 验证

- `pnpm check` 通过。
- `node --test tests/html2canvas-loader.test.mjs`：5 项通过，覆盖并发复用、失败重试、已有全局函数和资源路径。
- `pnpm exec tsx --experimental-test-module-mocks --test tests/ai-subsystem.test.ts tests/ai-input-behavior.test.ts tests/mistake-export.test.ts tests/web-render-smoke.test.ts`：84 项通过。
- `pnpm build` 通过。原有 CSS `.sfIconGlyph:svg` 选择器警告仍存在，不属于本次修改。
- ZIP 检查通过：2.4.4-b45，正式 ID `marginnote.extension.mn4-answer-matcher`，标题 CardLink，stable 渠道；app.js 不含截图库内部实现标记。
- 与本地 b44 逐字节比较，html2canvas、jsPDF、PDF runtime 和 WebBridgeCommands 保持一致。
- 本地 b44 安装包 622,877 B，b45 为 576,595 B，减少 46,282 B（7.43%）。app.js 从 630,786 B 降到 431,184 B，ZIP 内从 182,026 B 降到 135,743 B。

- Playwright/Chromium：Vite 开发页面和 file:// 本地编译预览均通过真实题目准备界面生成非空 JPEG；编译预览在首次截图前未加载库，截图时从 app.js 同目录下的 vendor 加载。预览使用模拟桥接，不调用远端 OCR 服务。
- 浏览器中还观察到既有 favicon 404（开发页面）和未知 image 图标回退警告，不影响本次截图验证。
- `git diff --check` 检查本次涉及的已跟踪文件通过。
- 交付：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b45.mnaddon`。

MarginNote 真机上的首次截图、手写截图及 PDF 导出未验证。保留原有工作区的无关变更，未提交 Git 或发布远端。
