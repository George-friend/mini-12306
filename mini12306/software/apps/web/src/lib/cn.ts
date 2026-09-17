/** 极简 className 合并工具（避免为一个小功能引入额外依赖） */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
