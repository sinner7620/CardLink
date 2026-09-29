# base64.ts — base64 与图片魔数（R10 归一）
## 职责
decodeBase64Bytes（宽容：data: 前缀/URL-safe/空白）、encodeBase64Ascii、decodeBase64Ascii、imageMimeFromBase64、imageExtensionFromSource。四类调用方共用单一实现。