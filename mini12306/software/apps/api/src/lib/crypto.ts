import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

const KEY = Buffer.from(config.idCardAesKey, 'hex');

/** AES-256-GCM 加密证件号，输出 base64(iv | tag | ciphertext) */
export function encryptIdCard(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 解密证件号 */
export function decryptIdCard(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** 证件号脱敏展示：前 3 位 + 11 个 * + 后 4 位 */
export function maskIdCard(idCard: string): string {
  if (idCard.length < 7) return '****';
  return `${idCard.slice(0, 3)}${'*'.repeat(Math.max(0, idCard.length - 7))}${idCard.slice(-4)}`;
}

/** 手机号脱敏 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 证件号的确定性摘要（HMAC-SHA256），用于唯一性校验与按证件检索 */
export function hashIdCard(idCard: string): string {
  return crypto.createHmac('sha256', KEY).update(idCard.trim().toUpperCase()).digest('hex');
}

/** 供 Mock 支付回调验签使用 */
export function hmacSha256(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
