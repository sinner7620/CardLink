/**
 * 平台层（P4-0）：RFC 4122 v4 UUID，纯 JS。
 * 用途：消息/事件/审计标识——只要求唯一性，不承担安全职能；
 * JSB 无 crypto.getRandomValues 保证，Math.random 足够（Node 亦同代码）。
 */
export function randomUUID(): string {
  const hex = "0123456789abcdef"
  const octets: string[] = []
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      octets.push("-")
    } else if (i === 14) {
      octets.push("4")
    } else if (i === 19) {
      // variant 8/9/a/b
      octets.push(hex[8 + ((Math.random() * 4) | 0)]!)
    } else {
      octets.push(hex[(Math.random() * 16) | 0]!)
    }
  }
  return octets.join("")
}
