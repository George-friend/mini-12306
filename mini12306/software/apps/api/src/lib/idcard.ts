/** 身份证号校验（GB 11643-1999 校验位算法）与 Mock 风控名单 */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

/** Mock 风控名单（演示"实名核验被拒绝"场景，该证件号校验位合法） */
export const BLACKLIST_ID_CARDS = ['110101199003078881'];

/** 校验格式与校验位 */
export function validateIdCard(idCard: string): { valid: boolean; reason?: string } {
  const v = idCard.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(v)) return { valid: false, reason: '证件号必须为 18 位（末位可为 X）' };
  const birth = v.slice(6, 14);
  const y = Number(birth.slice(0, 4));
  const m = Number(birth.slice(4, 6));
  const d = Number(birth.slice(6, 8));
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return { valid: false, reason: '证件号中的出生日期不合法' };
  }
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(v[i]) * WEIGHTS[i];
  const expect = CHECK_CODES[sum % 11];
  if (expect !== v[17]) return { valid: false, reason: '证件号校验位不正确' };
  return { valid: true };
}

/** 从证件号推断出生日期（yyyy-MM-dd） */
export function birthDateFromIdCard(idCard: string): string {
  const b = idCard.trim().toUpperCase().slice(6, 14);
  return `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`;
}

/** 按出生日期计算周岁 */
export function ageFromIdCard(idCard: string, at: Date = new Date()): number {
  const birth = new Date(`${birthDateFromIdCard(idCard)}T00:00:00+08:00`);
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const mDiff = at.getUTCMonth() - birth.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** 校验手机号（中国大陆 11 位） */
export function validatePhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.trim());
}

/** 银行卡号 Luhn 校验 */
export function validateBankCard(cardNo: string): boolean {
  const v = cardNo.replace(/\s/g, '');
  if (!/^\d{12,19}$/.test(v)) return false;
  let sum = 0;
  let alt = false;
  for (let i = v.length - 1; i >= 0; i -= 1) {
    let n = Number(v[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
