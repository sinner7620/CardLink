# MN4 Answer Matcher v2.3.3-beta.108

## 调整

- 将错题迁移确认弹窗替换为定稿文案，明确原六档到新三档的迁移关系及不可逆提示。
- 补充错题标签识别、纯答案记录处理和标签暂时不可读时保留记录的说明。
- 保持迁移逻辑、持久化键和桥接命令不变。

## 验证

- `pnpm check`
- `pnpm test`
- `pnpm build`
- 已复制构建产物到 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.108.mnaddon`。
- 源文件与复制件 SHA-256 一致：`27D13CF4C0959013145470AFD6D94A8B5104ABBED2056CA42658B9C864F377B0`。

## 未验证限制

- 构建工具仍报告已有的 `.sfIconGlyph:svg` CSS 伪类警告；不影响本次构建成功。
