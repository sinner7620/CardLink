# 报错提示不再挤动页面

## 原因与修改

用户截图中的内容下移与顶栏泛红来自同一布局问题：App 的 `.error` 是 main 内的普通流元素，会占据 flex 布局空间；顶栏是 absolute 且使用半透明背景和 backdrop-filter，错误条被覆盖在顶栏下面，红色透出而正文被挤下。

- `web/src/main.jsx`：App 级错误改为 `.workbenchError`，带 role=alert 和独立关闭按钮。
- `web/src/ui/shell.css`：错误提示绝对定位于顶栏下方，不占内容空间；长信息限高滚动，允许长字符串换行。
- `docs/modules/web/main.md`：补充错误浮层契约。

无存储、桥接协议或原生代码变化。仍保留错误文字供用户判断失败原因。本轮未升级版本或打包，已交付 b2 包未改变。

## 验证

- 内置浏览器 + Vite 临时夹具模拟 mistakeDetail 读取失败。报错前后及关闭后：header 均为 (0,0,1280,48)，内容 section 均为 (0,0,1280,720)；错误浮层在 (12,56)，位于顶栏下方。
- 截图检查确认提示文字可见、顶栏不再被错误条覆盖；关闭按钮可用。临时夹具已删除。
- web-render-smoke、web-bridge 共39项测试通过。
- Web 生产构建通过，验证产物在 output/error-overlay-web-build；保留既有 `.sfIconGlyph:svg` CSS 警告。
- 任务差异检查通过。MarginNote 真机尚未验证。
