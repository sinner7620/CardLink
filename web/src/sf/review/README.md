# Unified review and practice toolbar icons

The native toolbar loads transparent 60×60 PNGs at 3×. Plugin entry uses the existing logo.png. Generate assets with `node scripts/generate-review-toolbar-icons.mjs`.

| Asset | Source | Maximum ink size (pt) |
| --- | --- | --- |
| previous | SF chevron.backward | 14 |
| forward | SF chevron.forward | 14 |
| next | SF checkmark | 18 |
| answer | SF magnifyingglass | 19 |
| history | SF clock.arrow.trianglehead.counterclockwise.rotate.90 | 20 |
| category | SF list.bullet | 20 |
| mark | SF flag | 20 |
| exit | SF rectangle.portrait.and.arrow.right | 20 |
| collapse | SF sidebar.left | 20 |

All generated toolbar icons use SF Symbols. Historical lucide-*.svg files are unused; the generator no longer imports Lucide. The progress number/ring remains a status indicator, not an icon.

SF vector source: [Compose Cupertino](https://github.com/alexzhirkevich/compose-cupertino/tree/f66875aa6f3848b30c38e42a89fc99c9ac24a585). `list.bullet` comes from `cupertino-icons-extended/svg/outlined/`; chevrons, checkmark and magnifyingglass come from Kotlin ImageVector definitions under `cupertino/src/commonMain/kotlin/io/github/alexzhirkevich/cupertino/icons/outlined/`. Paths are converted mechanically, preserving proportions and winding. Historical rotate.right and xmark source vectors are retained but unused.

SF Symbols glyph rights belong to Apple; upstream conversion code carries its Apache 2.0 notice. See [Apple SF Symbols](https://developer.apple.com/sf-symbols/). Lucide is ISC licensed; see the project third-party notices.
The four replacements (history, mark, exit, collapse) retain vectors extracted from the local `SF-Symbols-7.0.4-SVG.zip`, under `SF Symbols 7 SVG/svg/`. Rasterization normalizes their 0.85 fill opacity to 1 for the same #172033 ink as the existing icons; path geometry is unchanged.
