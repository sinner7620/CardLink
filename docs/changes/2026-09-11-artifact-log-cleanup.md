# 历史产物与日志清理：已完成

## 目的

按用户请求清理仓库内历史遗留产物和日志。

## 已完成

- 盘点 Git 状态、历史安装包、临时解包目录、测试结果、浏览器日志与截图。
- 检查构建脚本的资源路径，以及网站对历史安装包的引用。
- 首次删除曾被自动审批审查拒绝。用户再次要求清理后，在当前权限下先检查绝对路径、Git 跟踪状态和目录联接，再执行删除，已全部完成。

## 已删除范围

- `.playwright-cli/`：浏览器控制台日志和页面快照。
- `test-results/`：旧测试输出和 CSS 基线结果。
- `.codex-tmp/beta-artifact-diff/`、`beta61-reference/`、`beta97-inspect/`、`beta98-inspect/`：历史解包及对比目录。
- `.codex-tmp/gitee-upload/`、`ui-verify/`：上传和 UI 验证临时产物。
- `.codex-tmp/gitee-CardLink-v2.4.1.mnaddon`、`github-CardLink-v2.4.1.mnaddon`：远端校验下载副本。
- `dist/` 中除 `CardLink-v2.4.1.mnaddon` 外的旧 `.mnaddon`；以及 `dist/mn4-answer-matcher/` 历史解包目录。
- `ui-preview/mn4-full-ui-preview.html`：旧命名预览入口。
- 根目录两个 `mn4-answer-matcher-v2.3.3-beta.2-diag.*.mnaddon` 诊断包。
- 根目录 `cardlink-site.tar.gz` 网站打包副本。
- `output/playwright/` 的历史截图和结果文件；辅助脚本保留。

## 保留范围与兼容影响

- 当前正式包、当前构建目录和预览入口。
- 网站源码以及 `website/app/page.tsx` 仍引用的两个下载包。
- `generated-assets/` 宣传素材、`SF-Symbols-7.0.4-SVG.zip` 图标源压缩包。
- `.codex-tmp/locateexp4-docx/` 说明资料、`bench-10k.ts` 及 output 下辅助脚本和图标资料。
- 历史发布说明、变更记录、交接与调查文档。
- 原有工作区修改及删除项、依赖和 Git 历史。

## 验证与限制

已删除 121 个目标，共 231 个文件，逻辑文件大小合计 62,139,379 字节（约 59.3 MiB）。所有目标均在 E:\project\MN 内，无 Git 跟踪文件或目录联接/符号链接。删除后核对所有目标均不存在，当前正式包和网站引用的两个下载包 SHA-256 与清理前一致。未改业务代码、配置、版本或既有工作区修改；不运行应用测试或构建。删除的旧日志、截图和诊断包不再保留。

## 删除明细

| 路径 | 文件数 | 字节 |
| --- | ---: | ---: |
| `.playwright-cli` | 51 | 122672 |
| `test-results` | 11 | 22103858 |
| `.codex-tmp/beta-artifact-diff` | 6 | 948985 |
| `.codex-tmp/beta61-reference` | 16 | 1635458 |
| `.codex-tmp/beta97-inspect` | 17 | 1727531 |
| `.codex-tmp/beta98-inspect` | 0 | 0 |
| `.codex-tmp/gitee-upload` | 1 | 518825 |
| `.codex-tmp/ui-verify` | 0 | 0 |
| `.codex-tmp/gitee-CardLink-v2.4.1.mnaddon` | 1 | 576211 |
| `.codex-tmp/github-CardLink-v2.4.1.mnaddon` | 1 | 576211 |
| `dist/mn4-answer-matcher` | 17 | 1750489 |
| `ui-preview/mn4-full-ui-preview.html` | 1 | 1633 |
| `mn4-answer-matcher-v2.3.3-beta.2-diag.1.mnaddon` | 1 | 498086 |
| `mn4-answer-matcher-v2.3.3-beta.2-diag.3.mnaddon` | 1 | 496888 |
| `cardlink-site.tar.gz` | 1 | 1699458 |
| `dist/CardLink-v2.3.3-beta.109.mnaddon` | 1 | 519226 |
| `dist/CardLink-v2.4.0.mnaddon` | 1 | 518825 |
| `dist/CardLink-v2.4.1b1.mnaddon` | 1 | 519198 |
| `dist/CardLink-v2.4.1b10.mnaddon` | 1 | 576324 |
| `dist/CardLink-v2.4.1b11.mnaddon` | 1 | 576322 |
| `dist/CardLink-v2.4.1b2.mnaddon` | 1 | 523678 |
| `dist/CardLink-v2.4.1b3.mnaddon` | 1 | 570473 |
| `dist/CardLink-v2.4.1b4.mnaddon` | 1 | 571663 |
| `dist/CardLink-v2.4.1b5.mnaddon` | 1 | 572791 |
| `dist/CardLink-v2.4.1b6.mnaddon` | 1 | 573454 |
| `dist/CardLink-v2.4.1b7.mnaddon` | 1 | 573716 |
| `dist/CardLink-v2.4.1b8.mnaddon` | 1 | 575760 |
| `dist/CardLink-v2.4.1b9.mnaddon` | 1 | 575775 |
| `dist/mn4-answer-matcher-v1.9.13.mnaddon` | 1 | 120336 |
| `dist/mn4-answer-matcher-v2.3.3-beta.100.mnaddon` | 1 | 514226 |
| `dist/mn4-answer-matcher-v2.3.3-beta.101.mnaddon` | 1 | 514571 |
| `dist/mn4-answer-matcher-v2.3.3-beta.102.mnaddon` | 1 | 514581 |
| `dist/mn4-answer-matcher-v2.3.3-beta.103.mnaddon` | 1 | 514924 |
| `dist/mn4-answer-matcher-v2.3.3-beta.104.mnaddon` | 1 | 515056 |
| `dist/mn4-answer-matcher-v2.3.3-beta.105.mnaddon` | 1 | 516103 |
| `dist/mn4-answer-matcher-v2.3.3-beta.106.mnaddon` | 1 | 516185 |
| `dist/mn4-answer-matcher-v2.3.3-beta.107.mnaddon` | 1 | 516211 |
| `dist/mn4-answer-matcher-v2.3.3-beta.108.mnaddon` | 1 | 516210 |
| `dist/mn4-answer-matcher-v2.3.3-beta.72.mnaddon` | 1 | 489521 |
| `dist/mn4-answer-matcher-v2.3.3-beta.73.mnaddon` | 1 | 489818 |
| `dist/mn4-answer-matcher-v2.3.3-beta.74.mnaddon` | 1 | 489812 |
| `dist/mn4-answer-matcher-v2.3.3-beta.75.mnaddon` | 1 | 490330 |
| `dist/mn4-answer-matcher-v2.3.3-beta.76.mnaddon` | 1 | 495112 |
| `dist/mn4-answer-matcher-v2.3.3-beta.77.mnaddon` | 1 | 495620 |
| `dist/mn4-answer-matcher-v2.3.3-beta.78.mnaddon` | 1 | 495332 |
| `dist/mn4-answer-matcher-v2.3.3-beta.79.mnaddon` | 1 | 494776 |
| `dist/mn4-answer-matcher-v2.3.3-beta.80.mnaddon` | 1 | 494755 |
| `dist/mn4-answer-matcher-v2.3.3-beta.81.mnaddon` | 1 | 495019 |
| `dist/mn4-answer-matcher-v2.3.3-beta.82.mnaddon` | 1 | 494726 |
| `dist/mn4-answer-matcher-v2.3.3-beta.83.mnaddon` | 1 | 499101 |
| `dist/mn4-answer-matcher-v2.3.3-beta.84.mnaddon` | 1 | 498884 |
| `dist/mn4-answer-matcher-v2.3.3-beta.85.mnaddon` | 1 | 498747 |
| `dist/mn4-answer-matcher-v2.3.3-beta.86.mnaddon` | 1 | 498749 |
| `dist/mn4-answer-matcher-v2.3.3-beta.87.mnaddon` | 1 | 498866 |
| `dist/mn4-answer-matcher-v2.3.3-beta.88.mnaddon` | 1 | 498889 |
| `dist/mn4-answer-matcher-v2.3.3-beta.89.mnaddon` | 1 | 498684 |
| `dist/mn4-answer-matcher-v2.3.3-beta.90.mnaddon` | 1 | 499093 |
| `dist/mn4-answer-matcher-v2.3.3-beta.91.mnaddon` | 1 | 498938 |
| `dist/mn4-answer-matcher-v2.3.3-beta.92.mnaddon` | 1 | 498944 |
| `dist/mn4-answer-matcher-v2.3.3-beta.93.mnaddon` | 1 | 498876 |
| `dist/mn4-answer-matcher-v2.3.3-beta.94.mnaddon` | 1 | 499083 |
| `dist/mn4-answer-matcher-v2.3.3-beta.95.mnaddon` | 1 | 509377 |
| `dist/mn4-answer-matcher-v2.3.3-beta.96.mnaddon` | 1 | 510049 |
| `dist/mn4-answer-matcher-v2.3.3-beta.97.mnaddon` | 1 | 512438 |
| `dist/mn4-answer-matcher-v2.3.3-beta.98.mnaddon` | 1 | 512480 |
| `dist/mn4-answer-matcher-v2.4.0.mnaddon` | 1 | 518810 |
| `output/playwright/b10-window-control-capsule-900x640.png` | 1 | 44341 |
| `output/playwright/b11-window-control-height-aligned-900x640.png` | 1 | 44448 |
| `output/playwright/b73-category.png` | 1 | 73590 |
| `output/playwright/b73-delete-confirm.png` | 1 | 88510 |
| `output/playwright/b73-delete-top.png` | 1 | 90279 |
| `output/playwright/b73-divider.png` | 1 | 11344 |
| `output/playwright/b73-tagmenu.png` | 1 | 73257 |
| `output/playwright/b74-header.png` | 1 | 25584 |
| `output/playwright/b76-overview.png` | 1 | 80715 |
| `output/playwright/b76-settings.png` | 1 | 79786 |
| `output/playwright/b77-settings.png` | 1 | 97813 |
| `output/playwright/b80-settings-narrow.png` | 1 | 44914 |
| `output/playwright/b80-settings-wide.png` | 1 | 106501 |
| `output/playwright/b81-chart-month.png` | 1 | 14899 |
| `output/playwright/b81-chart-week.png` | 1 | 14757 |
| `output/playwright/b82-absolute-topbar.png` | 1 | 15570 |
| `output/playwright/b83-settings.png` | 1 | 114285 |
| `output/playwright/b84-mistakes.png` | 1 | 75978 |
| `output/playwright/b84-popover.png` | 1 | 36990 |
| `output/playwright/b84-settings-wide.png` | 1 | 105565 |
| `output/playwright/b85-settings.png` | 1 | 107012 |
| `output/playwright/b87-settings.png` | 1 | 57645 |
| `output/playwright/b88-frosted.png` | 1 | 21819 |
| `output/playwright/b89-checkbox.png` | 1 | 14388 |
| `output/playwright/final-narrow-batch.png` | 1 | 71964 |
| `output/playwright/final-short.png` | 1 | 68727 |
| `output/playwright/narrow-batchbar.png` | 1 | 73447 |
| `output/playwright/narrow-category-popover.png` | 1 | 64786 |
| `output/playwright/narrow-date-popover.png` | 1 | 76650 |
| `output/playwright/narrow-mistakes.png` | 1 | 70687 |
| `output/playwright/narrow-review.png` | 1 | 57446 |
| `output/playwright/narrow-tag-menu.png` | 1 | 74607 |
| `output/playwright/settings-720.png` | 1 | 43311 |
| `output/playwright/v2.4.0-ai-settings-final.png` | 1 | 66391 |
| `output/playwright/v2.4.0-ai-settings-initial.png` | 1 | 66889 |
| `output/playwright/v2.4.0-ai-settings-narrow.png` | 1 | 51469 |
| `output/playwright/v2.4.0-ai-settings.png` | 1 | 63717 |
| `output/playwright/v2.4.0-multiselect-expanded.png` | 1 | 77428 |
| `output/playwright/v2.4.0-multiselect.png` | 1 | 74732 |
| `output/playwright/v233-mistake-detail-narrow.png` | 1 | 90423 |
| `output/playwright/v233-mistake-detail-wide.png` | 1 | 108145 |
| `output/playwright/v233-mistakes-scroll-narrow.png` | 1 | 35449 |
| `output/playwright/v233-mistakes-wide.png` | 1 | 66702 |
| `output/playwright/v233-review-narrow.png` | 1 | 75872 |
| `output/playwright/v233-review-wide.png` | 1 | 84471 |
| `output/playwright/wide-batchbar.png` | 1 | 51010 |
| `output/playwright/wide-category-popover.png` | 1 | 43525 |
| `output/playwright/wide-date-popover.png` | 1 | 53807 |
| `output/playwright/wide-mistakes.png` | 1 | 46804 |
| `output/playwright/wide-tag-menu.png` | 1 | 86682 |
| `output/playwright/x430-tagmenu.png` | 1 | 61884 |
| `output/playwright/x430.png` | 1 | 59343 |
| `output/playwright/x460.png` | 1 | 62224 |
| `output/playwright/x500.png` | 1 | 64943 |
| `output/playwright/x560.png` | 1 | 69112 |

## 保留安装包校验

- `E:\project\MN\dist\CardLink-v2.4.1.mnaddon`：`1EB1F2B0F6135EFE71FD56EF87CD06F9CE97EA9E8448A6B9384A719CCD1F7173`。
- `E:\project\MN\website\public\downloads\mn4-answer-matcher-v1.9.13.mnaddon`：`8820E0954ECA6B08FF8D97160FC058D6085D7F89B70E7711A212A9652104F22A`。
- `E:\project\MN\website\public\downloads\mn4-answer-matcher-v2.3.3-beta.2.mnaddon`：`941D7A06CC984167721B087708729A4E46EB0809A498888B4E5C54862ADDE407`。
