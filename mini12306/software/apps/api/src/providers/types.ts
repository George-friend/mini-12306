import { prisma } from '../db';

/**
 * 第三方服务适配层（M8）
 * ─ 每个能力定义统一接口，Mock 实现与真实实现同构。
 * ─ 通过 PROVIDER_MODE 切换；本项目仅提供 mock 实现。
 */

export interface IdentityVerifyResult {
  success: boolean;
  requestId: string;
  code: string;
  message: string;
  elapsedMs: number;
}

export interface IdentityProvider {
  readonly name: string;
  verify(realName: string, idCardNo: string): Promise<IdentityVerifyResult>;
  verifyBankCard(input: { realName: string; idCardNo: string; phone: string; bankCardNo: string }): Promise<IdentityVerifyResult>;
}

export interface SmsSendResult {
  success: boolean;
  smsId: string;
  code: string;
  message: string;
  elapsedMs: number;
}

export interface SmsProvider {
  readonly name: string;
  send(phone: string, scene: string, code: string): Promise<SmsSendResult>;
}

export interface PayCreateResult {
  success: boolean;
  outTradeNo: string;
  tradeNo: string;
  payUrl: string;
  message: string;
}

export interface PayQueryResult {
  outTradeNo: string;
  tradeNo: string | null;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  amountCents: number;
}

export interface PaymentProvider {
  readonly name: string;
  create(input: { outTradeNo: string; amountCents: number; subject: string }): Promise<PayCreateResult>;
  query(outTradeNo: string): Promise<PayQueryResult>;
  refund(input: { outTradeNo: string; refundNo: string; amountCents: number; reason: string }): Promise<{ success: boolean; refundTradeNo: string; message: string }>;
  /** 回调验签 */
  verifyNotifySign(payload: Record<string, unknown>, sign: string): boolean;
}
