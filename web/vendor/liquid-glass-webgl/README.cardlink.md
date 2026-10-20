# CardLink integration

Upstream: https://github.com/martin65536/liquid-glass-webgl

Pinned revision: `0b90f9fc1cea8c7e59825f9aff1cbb96674b5b80`.

Files listed in `UPSTREAM.json` are byte-for-byte upstream copies. Its Git blob
IDs are verified by `tests/scene-size-glass.test.ts`. Do not edit these copies.

CardLink's `web/src/lib/useSizeGlassFooter.js` uses the original renderer,
pointer-handling hook and `makeButton` for blue Reset and Done buttons. Both
buttons and the grid wallpaper share one panel-sized canvas, avoiding separate
wallpaper scaling. Other controls in `web/src/SceneSizeGlass.jsx` are ordinary
DOM controls. The adapter supplies layout, keyboard semantics, business callbacks
and a packaged grid wallpaper; it does not use the demo's hardcoded clock asset
or replace glass rendering with CSS.

The user authorized reducing the original blue tint's alpha parameter from
1 to 0.45. This changes the preset's appearance, not the upstream source.
The adapter forwards active pointer moves/releases at window capture phase;
cancellation, lost capture, blur and page hiding release the original press
state without firing a button action.

Only the normal compiled JavaScript bundle and runtime wallpaper are installed.

Do not copy this source directory, source maps, or source archives into `.mnaddon`.
