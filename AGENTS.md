# Repository Working Agreement

## Mandatory Markdown change record

Every code, configuration, test, build, or UI modification must include a Markdown change record in the same working set.

- Create or update `docs/changes/YYYY-MM-DD-<topic>.md` for every modification task.
- Record the change purpose, implemented behavior, affected files or modules, compatibility/data impact, validation performed, and any unverified limitations.
- Update the corresponding `RELEASE_NOTES_*.md` as well when the modification belongs to a release.
- Keep documentation aligned with the final implementation; do not document planned behavior as completed behavior.
- A modification task is not complete until its Markdown record has been written and checked.

## Mandatory version iteration and delivery

All development happens in this formal project. Every modification round that ships code/config/UI changes must iterate the version, unless the user explicitly confirms that the current round may overwrite the current version.

- Bump `package.json` `version` for every round, format `2.3.3-beta.<N+1>`; never reuse a version number with different content. Drop the `-beta` suffix only for a formal release, decided by the user.
- Exception: when the user explicitly confirms that a specific modification round may keep and overwrite the current version, do not bump `package.json`; update the existing matching release notes and change record, rebuild the same-version artifact, replace the delivery copy, and record the new matching SHA-256. This exception applies only to that confirmed round and must not be inferred for later rounds.
- The plugin always builds the formal channel (`mnChannel: "stable"`, 正式插件 ID/标题). The version's `-beta` suffix only affects update-check prerelease matching and telemetry channel tags — never switch the plugin ID based on the version string.
- Create the matching `RELEASE_NOTES_<version>.md` describing this round's fixes, verification, and unverified limitations.
- Run `pnpm check`, `pnpm test`, `pnpm build`, then copy the built `.mnaddon` to `E:\iCloudDrive\同步文件夹\` and record its SHA-256 (must match the dist original) in the change record.

## Mandatory animation spec (Morphicons)

All SVG icon morph animations must use the official Morphicons engine — no exceptions, no hand-written substitutes.

- Always `createMorph` from `morphicons/dom` (official npm package). Forbidden: dual-path crossfade, CSS opacity/transform transitions, or bezier curves that imitate a morph (`scale/rotate + opacity` fake morphs included).
- Spring presets are limited to the official ones: `"smooth"`, `"snappy"`, `"bouncy"`. Never pass custom `{ stiffness, damping }` unless the official presets demonstrably cannot fit.
- Always create engines with `{ reducedMotion: "user" }` so 系统减弱动态 is honored.
- Icons are consumed as data (a `d` string or Lucide `IconNode`), matching the official consumption model.
- Non-morph motion (spinners, highlights, layout transitions) stays plain CSS and must respect `prefers-reduced-motion`.
- Any new icon/state animation lands as a `createMorph`-based component; PRs introducing hand-rolled icon morphs are rejected in review.


