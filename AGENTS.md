# Repository Working Agreement

## Scope and working style

- Work in this formal project. Complete the requested scope; historical review findings do not automatically become new tasks.
- Proceed with routine, reversible work already authorized. Ask only when missing information materially affects scope or authorization is absent.
- Preserve unrelated working-tree changes. Stage only task files; do not clean untracked files or undo existing changes during routine tidying.
- Add validation, compatibility branches or fallback layers for concrete requirements or observed failure modes, not hypothetical risks alone.
- This file owns workflow rules; see `docs/workflow.md` for details. Historical reports describe their own revision, not current instructions.

## Documentation

- Create or update one `docs/changes/YYYY-MM-DD-<topic>.md` per coherent modification task, including rule/documentation changes. Continue that record for follow-up fixes within the task.
- Record purpose, implemented behavior, affected files/modules, compatibility/data impact, validation actually performed and unverified limitations. Keep the record aligned with the final change.
- Update architecture, interface or feature documentation when its contract changes. A new code file does not automatically require a matching documentation file.
- Write `RELEASE_NOTES_v<version>.md` when delivering that version; emphasize user-visible changes and material limitations rather than repeating the engineering record.

## Validation

- Choose checks by affected behavior using `docs/workflow.md`. Documentation-only work needs consistency/link/diff checks, not application tests or a build.
- Prefer tests exercising behavior. Avoid tests that mirror implementation or freeze incidental source spelling; narrow static checks are appropriate for explicit structural contracts.
- Reuse successful checks for unchanged inputs in the same task. Repeat when relevant code, dependencies, environment or new failure evidence changes, not solely after prose edits.
- Report desktop/automated and MarginNote device checks separately. Missing device access limits the relevant claim, not unrelated completed work.

## Version and delivery

- Ordinary development commits and documentation/rule-only changes do not automatically create an installable release or bump the product version.
- Each delivered code/config/UI artifact uses a new version based on current `package.json`, unless the user explicitly authorizes same-version replacement for that round. Do not reuse a delivered version with different content by default.
- Use `X.Y.Z-bN` for new prereleases and `X.Y.Z` for formal releases. The user decides formal promotion. Do not copy obsolete hardcoded version baselines or rename historical versions.
- Always build the formal channel: `mnChannel: "stable"`, ID `marginnote.extension.mn4-answer-matcher`, title `CardLink`. Prerelease versions must not switch plugin identity.
- Before delivering an installation package, run `pnpm check`, `pnpm test`, `pnpm build` for final artifact inputs. Verify package version/identity, copy the `.mnaddon` to `E:\iCloudDrive\同步文件夹\`, and record SHA-256 matching the dist original.
- For explicitly authorized same-version replacement, update its release notes and task record, rebuild, replace the delivery copy and record the new matching hash. The exception does not carry forward.
- GitHub/Gitee publishing follows user release authorization; local modification or commit alone is not a request to publish.

## SVG icon morph animations (Morphicons)

- All SVG icon shape morphs use `createMorph` from official `morphicons/dom`. No hand-written substitutes, dual-path crossfades or scale/rotate plus opacity imitations.
- Use official spring presets `"smooth"`, `"snappy"`, `"bouncy"`. Custom stiffness/damping is allowed only if those presets demonstrably cannot fit.
- Create engines with `{ reducedMotion: "user" }`. Consume icons as data (`d` strings or Lucide `IconNode`).
- Non-morph motion (spinners, highlights, layout transitions) uses CSS and respects `prefers-reduced-motion`; it does not require a morph engine.
