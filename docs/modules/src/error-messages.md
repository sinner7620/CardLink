# error-messages.ts — 用户可读错误文案
## 职责
`src/errors.ts` 定义稳定的 `ErrorCode`、参数与 `CardLinkError`；业务层只表达“错误是什么”。

`describeError` 负责“错误怎么显示”：有码时通过 `error.<code>` 键和参数查文案表，无码时进入一个版本的关键字兼容层。`presentError` 在桥接边界产出 `{ code?, message }`，其中 `message` 已是用户文案。
## 验收
- 修改 `CardLinkError.message` 或抛错点文字不改变错误分类与最终文案。
- passthrough 白名单不存在；策划过的文案必须通过错误码表达。
- 未码化旧错误仍按既有关键字规则归类，未知错误使用安全兜底。
