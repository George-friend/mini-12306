import { config } from '../config';
import { hmacSha256 } from '../lib/crypto';
import { BLACKLIST_ID_CARDS, validateBankCard, validateIdCard, validatePhone } from '../lib/idcard';
import { newRequestId, newSmsId, newTradeNo } from '../lib/ids';
import { prisma } from '../db';
import type { IdentityProvider, IdentityVerifyResult, PayCreateResult, PayQueryResult, PaymentProvider, SmsProvider, SmsSendResult } from './types';

/** Mock 侧调用耗时模拟（毫秒） */
function delay(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** ── 实名认证（Mock：身份证校验位 + 风控名单 + 姓名一致性规则）── */
export class MockIdentityProvider implements IdentityProvider {
  readonly name = 'mock-identity';

  async verify(realName: string, idCardNo: string): Promise<IdentityVerifyResult> {
    const started = Date.now();
    await delay(80);
    const requestId = newRequestId();
    const check = validateIdCard(idCardNo);

    let success = true;
    let code = 'PASS';
    let message = '实名核验通过';

    if (!check.valid) {
      success = false;
      code = 'ID_FORMAT_INVALID';
      message = check.reason ?? '证件号格式不正确';
    } else if (BLACKLIST_ID_CARDS.includes(idCardNo.trim().toUpperCase())) {
      success = false;
      code = 'RISK_REJECTED';
      message = '该证件已被风控拦截，无法办理业务';
    } else if (!realName || realName.trim().length < 2) {
      success = false;
      code = 'NAME_MISMATCH';
      message = '姓名与证件号不匹配（姓名至少 2 个汉字）';
    }

    return { success, requestId, code, message, elapsedMs: Date.now() - started };
  }

  async verifyBankCard(input: { realName: string; idCardNo: string; phone: string; bankCardNo: string }): Promise<IdentityVerifyResult> {
    const started = Date.now();
    await delay(60);
    const requestId = newRequestId();
    if (!validateBankCard(input.bankCardNo)) {
      return { success: false, requestId, code: 'BANK_CARD_INVALID', message: '银行卡号校验失败（Luhn 校验不通过）', elapsedMs: Date.now() - started };
    }
    if (!validatePhone(input.phone)) {
      return { success: false, requestId, code: 'PHONE_INVALID', message: '预留手机号格式不正确', elapsedMs: Date.now() - started };
    }
    const idCheck = validateIdCard(input.idCardNo);
    if (!idCheck.valid) {
      return { success: false, requestId, code: 'ID_FORMAT_INVALID', message: idCheck.reason ?? '证件号格式不正确', elapsedMs: Date.now() - started };
    }
    return { success: true, requestId, code: 'PASS', message: '银行卡四要素核验通过', elapsedMs: Date.now() - started };
  }
}

/** ── 短信（Mock：不真正发送，返回验证码便于演示）── */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock-sms';

  async send(phone: string, scene: string, code: string): Promise<SmsSendResult> {
    const started = Date.now();
    await delay(40);
    const smsId = newSmsId();
    // 演示环境把验证码打到控制台，等同于"收到短信"
    // eslint-disable-next-line no-console
    console.log(`[mock-sms] → ${phone} 场景=${scene} 验证码=${code}（有效期 5 分钟）`);
    return { success: true, smsId, code, message: '短信已发送（Mock 通道）', elapsedMs: Date.now() - started };
  }
}

/** ── 银行支付（Mock：本地收银台 + 异步回调 + 验签）── */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock-bank';

  private get secret(): string {
    return config.jwtSecret;
  }

  async create(input: { outTradeNo: string; amountCents: number; subject: string }): Promise<PayCreateResult> {
    await delay(30);
    const tradeNo = newTradeNo();
    await prisma.payment.updateMany({ where: { outTradeNo: input.outTradeNo }, data: { tradeNo } });
    return {
      success: true,
      outTradeNo: input.outTradeNo,
      tradeNo,
      payUrl: `/api/v1/mock/pay/cashier?outTradeNo=${input.outTradeNo}`,
      message: '支付单已创建，请前往 Mock 收银台完成支付',
    };
  }

  async query(outTradeNo: string): Promise<PayQueryResult> {
    const p = await prisma.payment.findUnique({ where: { outTradeNo } });
    if (!p) return { outTradeNo, tradeNo: null, status: 'CLOSED', amountCents: 0 };
    return { outTradeNo, tradeNo: p.tradeNo, status: p.status as PayQueryResult['status'], amountCents: p.amountCents };
  }

  async refund(input: { outTradeNo: string; refundNo: string; amountCents: number; reason: string }): Promise<{ success: boolean; refundTradeNo: string; message: string }> {
    await delay(40);
    return { success: true, refundTradeNo: `RF${newTradeNo()}`, message: `退款 ${(input.amountCents / 100).toFixed(2)} 元已受理（Mock 原路退回）` };
  }

  sign(payload: Record<string, unknown>): string {
    return hmacSha256(JSON.stringify(payload), this.secret);
  }

  verifyNotifySign(payload: Record<string, unknown>, sign: string): boolean {
    return this.sign(payload) === sign;
  }
}

export const identityProvider: IdentityProvider = new MockIdentityProvider();
export const smsProvider: SmsProvider = new MockSmsProvider();
export const paymentProvider = new MockPaymentProvider();
