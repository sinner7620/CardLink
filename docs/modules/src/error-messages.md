# error-messages.ts — 用户可读错误文案
## 职责
describeError：异常 → 用户可读文案（映射表 + 策划文案透传清单）；Error 实例取 message（避免 "Error: " 前缀使锚定失配）。
## 验收
透传清单（跳转超时/下载不完整/写入失败等）不被兜底吞掉。