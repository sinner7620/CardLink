# 自定义答案遮盖图片改用原生资源

## 目的

原实现每张答案遮盖均创建 `UIWebView` 并加载同一张 base64 图片，增加视图与解码开销。

## 实现

- `same-map-practice.ts` 在开始做题时通过项目已有的 base64 字节转换、`NSData` 与 `UIImage.imageWithData` 解码图片，按图片来源缓存一个原生 `UIImage`。
- 每张遮盖使用轻量 `UIImageView`，共用已解码的 `UIImage`；保持填充裁切、圆角、标签和原有遮盖位置同步。图片来源改变时重新解码，移除图片时释放缓存引用。
- 图片解码或原生图片视图不可用时，开始做题返回明确原因，不进入遮盖状态。

## 影响与兼容

- 仅改遮盖图片的原生渲染路径；设置存储格式、颜色遮盖、题目队列与遮盖定位逻辑不变。`docs/pages/settings.md` 同步说明。

## 验证与限制

- `pnpm check` 通过；现有 `same-map-practice` 与 `plugin-events` 测试 31 项通过；`pnpm build` 和 `git diff --check` 通过。包内 `mnaddon.json` 确认为 2.4.4-b24、正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 CardLink；构建产物包含原生 `UIImageView` 与 `UIImage.imageWithData` 路径。
- 安装包已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b24.mnaddon`。
- MarginNote iPad 未连接，原生图片显示和填充裁切尚需设备验证。
