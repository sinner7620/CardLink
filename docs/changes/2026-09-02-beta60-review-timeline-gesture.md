# beta.60 复测时间轴手势仲裁修复

日期：2026-09-02  
版本：2.3.3-beta.60

## 目的

修复待复习页的复测历史时间轴与页面纵向滚动互相争抢，造成纵向死区、斜向横滑启动不稳定，以及鼠标显示 grab 却无法拖动的问题。

## 诊断

- 参考分析文档指出 beta.55 使用 `.reviewPage { touch-action: pan-y }`，同时对时间轴 `ol` 和每个 `li` 强制 `pan-x`。
- 当前 beta.59 源码核对后仍保留这组规则，且 React 中不存在时间轴 pointer/touch 拖动逻辑。
- 因此手势起点落在时间轴节点时由 WebKit 在嵌套横纵滚动容器间猜测方向；斜向手势容易既未触发页面纵滚，也未启动横滚。
- 原生 `headerPan` 只在标题栏内且不在控件上时允许开始，并已设置 `cancelsTouchesInView = false`，不是本轮主因，未修改。

## 实现

### CSS 所有权

- `.reviewHistory ol` 改为 `touch-action: pan-y`，让纵向手势直接进入外层复习页滚动链。
- 删除 `.reviewHistory li` 的 `touch-action`，节点不再各自参与方向抢占。
- 横向 overscroll 改回 `auto`，撤销时间轴自己的 contain 截断。
- 仅在真正进入横向拖动后添加 `isTimelineDragging`，启用 grabbing 光标和禁止选中文字。

### 明确方向仲裁

- 新增 `ReviewTimeline` React 组件，使用 Pointer Events 统一触摸、Pencil、鼠标和触控板指针。
- pointerdown 只记录起点，不立即 capture，也不阻止默认滚动。
- 移动不足 8px 时保持 pending，避免手指微抖触发。
- 当 `|dx| <= |dy| × 1.15` 时判为纵向/斜向，立即放弃时间轴状态，由外层原生纵滚继续处理。
- 只有明确横向时才调用 `setPointerCapture()`、`preventDefault()` 并以起始位置计算 `scrollLeft`。
- pointerup、pointercancel 和 lostpointercapture 共用清理路径，避免拖动状态残留。
- 增加左右方向键每次 120px 的滚动支持。

## 影响文件

- `web/src/main.jsx`
- `web/src/ui/review.css`
- `tests/web-bridge.test.ts`
- `tests/ui-stage2-visual.spec.js`
- `web/src/lib/previewBridge.js`
- `package.json`
- `README.md`、`docs/README.md`、`交接文档.md`

## 兼容性与数据影响

- 不修改复习记录、时间轴间距算法、错题数据、原生窗口手势、桥协议或共享存储。
- Pointer Events 和 `setPointerCapture` 均由当前 MarginNote 4 的 WebKit 提供；调用使用可选链，缺少 capture API 时仍可在指针停留于时间轴范围内拖动。
- CSS 继续遵循 beta.59 的 `mn-ui-base / mn-ui-priority` 层级，不重新引入 `!important`。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过，158/158。
- `pnpm exec playwright test "tests/ui-stage2-visual.spec.js"` 通过，3/3。
- Playwright 动态扩展时间轴以产生真实横向溢出，鼠标从右向左拖动后 `scrollLeft > 40`。
- 模拟纵向 60px、横向 3px 的触摸指针移动后，`scrollLeft = 0` 且未进入 `isTimelineDragging`。
- 500px/920px 总览、错题、复习、设置页面继续无页面级横向溢出。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.60.mnaddon`。

## 真机复核

- 浏览器可验证方向判定和滚动结果，但无法完全模拟 UIWebView 与 iOS 系统滚动 recognizer 的时序。安装 beta.60 后应分别测试：时间轴区域纵向滑页面、轻微斜向横滑、快速横甩、左右边界继续拖动，以及 Apple Pencil/触控板拖动。
