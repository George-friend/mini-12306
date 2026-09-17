import { ApiError } from '../lib/http';

/**
 * 退票费与改签差价规则（BR-06 / BR-07 / BR-08 / §7）
 * Δt = 开车时间 − 申请时间（小时）
 *   Δt ≥ 192h（8 天）        → 免费
 *   48h ≤ Δt < 192h          → 5%
 *   24h ≤ Δt < 48h           → 10%
 *   Δt < 24h                 → 20%
 * 退票费向上取整到分；费率 > 0 时最低 2 元（参数可配）。
 */

export interface RefundQuote {
  hoursBeforeDepart: number;
  feeRateBp: number; // 基点：500 = 5%
  feeRateText: string;
  feeCents: number;
  refundCents: number;
}

export interface ChangeQuote {
  fromPriceCents: number;
  toPriceCents: number;
  diffCents: number; // 绝对差价
  diffType: 'PAY' | 'REFUND' | 'NONE';
  feeCents: number; // 退差时核收的手续费
  refundCents: number; // 退差时实际退还金额
  payableCents: number; // 补差时需支付金额
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function feeRateOf(hours: number): { bp: number; text: string } {
  if (hours >= 192) return { bp: 0, text: '免收（开车前 8 天以上）' };
  if (hours >= 48) return { bp: 500, text: '5%（开车前 48 小时以上）' };
  if (hours >= 24) return { bp: 1000, text: '10%（开车前 24 小时以上）' };
  return { bp: 2000, text: '20%（开车前不足 24 小时）' };
}

/** 退票费试算 */
export function quoteRefund(priceCents: number, departAt: Date, applyAt: Date, minFeeCents: number): RefundQuote {
  const hours = (departAt.getTime() - applyAt.getTime()) / 3600000;
  if (hours <= 0) throw new ApiError(6001, '列车已发车，不可办理退票', 400);

  const { bp, text } = feeRateOf(hours);
  let feeCents = Math.ceil((priceCents * bp) / 10000);
  if (bp > 0 && feeCents < minFeeCents) feeCents = minFeeCents;
  if (feeCents > priceCents) feeCents = priceCents;

  return {
    hoursBeforeDepart: round2(hours),
    feeRateBp: bp,
    feeRateText: text,
    feeCents,
    refundCents: priceCents - feeCents,
  };
}

/** 改签差价试算 */
export function quoteChange(
  fromPriceCents: number,
  toPriceCents: number,
  newDepartAt: Date,
  now: Date,
  minFeeCents: number,
): ChangeQuote {
  const diff = toPriceCents - fromPriceCents;
  if (diff > 0) {
    return {
      fromPriceCents,
      toPriceCents,
      diffCents: diff,
      diffType: 'PAY',
      feeCents: 0,
      refundCents: 0,
      payableCents: diff,
    };
  }
  if (diff < 0) {
    const q = quoteRefund(-diff, newDepartAt, now, minFeeCents);
    return {
      fromPriceCents,
      toPriceCents,
      diffCents: -diff,
      diffType: 'REFUND',
      feeCents: q.feeCents,
      refundCents: q.refundCents,
      payableCents: 0,
    };
  }
  return { fromPriceCents, toPriceCents, diffCents: 0, diffType: 'NONE', feeCents: 0, refundCents: 0, payableCents: 0 };
}
