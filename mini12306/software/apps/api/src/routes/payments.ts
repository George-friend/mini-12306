import { Router } from 'express';
import { prisma } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { confirmLockedSeats } from '../services/inventory';
import { loadOrder, buildOrderView } from '../services/orderView';
import { paymentProvider } from '../providers/mock';

export const paymentRouter = Router();

/** 支付成功结算（幂等）：库存锁定转已售、订单转已支付、车票转已出票 */
export async function settlePaySuccess(outTradeNo: string, tradeNo?: string | null) {
  const payment = await prisma.payment.findUnique({
    where: { outTradeNo },
    include: { order: { include: { items: true } } },
  });
  if (!payment) throw Errors.notFound('支付单不存在');
  if (payment.status === 'SUCCESS') return { alreadySettled: true, orderNo: payment.order.orderNo };

  const order = payment.order;
  if (order.status !== 'PENDING_PAYMENT') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failReason: `订单状态为 ${order.status}，无法完成支付` },
    });
    throw new ApiError(5002, `订单当前状态为「${order.status}」，无法完成支付`, 410);
  }

  await prisma.$transaction(async (tx) => {
    const seatClass = order.items[0]?.seatClass;
    if (seatClass) await confirmLockedSeats(tx, order.scheduleId, seatClass, order.items.length);
    await tx.orderItem.updateMany({ where: { orderId: order.id, ticketStatus: 'LOCKED' }, data: { ticketStatus: 'TICKETED' } });
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date(), paidAmountCents: payment.amountCents },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESS', tradeNo: tradeNo ?? payment.tradeNo, paidAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorName: 'mock-bank',
        actorRole: 'SYSTEM',
        action: 'PAYMENT_SUCCESS',
        targetType: 'order',
        targetId: order.orderNo,
        detail: JSON.stringify({ outTradeNo, amountCents: payment.amountCents }),
      },
    });
  });

  return { alreadySettled: false, orderNo: order.orderNo };
}

/** 支付失败处理 */
export async function settlePayFailed(outTradeNo: string, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { outTradeNo } });
  if (!payment) throw Errors.notFound('支付单不存在');
  if (payment.status === 'SUCCESS') return { skipped: true };
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failReason: reason } });
  return { skipped: false };
}

/** POST /payments/callback Mock 银行异步回调（验签） */
paymentRouter.post(
  '/payments/callback',
  wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const sign = String(body.sign ?? '');
    const payload = {
      outTradeNo: String(body.outTradeNo ?? ''),
      tradeNo: String(body.tradeNo ?? ''),
      amountCents: Number(body.amountCents ?? 0),
      status: String(body.status ?? ''),
    };

    if (!paymentProvider.verifyNotifySign(payload, sign)) {
      throw new ApiError(7002, '支付回调签名校验失败', 400);
    }
    if (!payload.outTradeNo) throw new ApiError(1001, '缺少 outTradeNo', 400);

    const record = await prisma.payment.findUnique({ where: { outTradeNo: payload.outTradeNo } });
    if (!record) throw Errors.notFound('支付单不存在');
    if (record.amountCents !== payload.amountCents) throw new ApiError(7002, '回调金额与支付单不一致', 400);

    if (payload.status === 'SUCCESS') {
      const r = await settlePaySuccess(payload.outTradeNo, payload.tradeNo);
      return ok(res, r, r.alreadySettled ? '重复回调，已幂等处理' : '支付成功，车票已出票');
    }
    const f = await settlePayFailed(payload.outTradeNo, `银行返回状态：${payload.status}`);
    return ok(res, f, '支付失败已记录');
  }),
);

/** GET /payments/:orderNo 支付状态查询（前端轮询） */
paymentRouter.get(
  '/payments/:orderNo',
  requireAuth,
  wrap(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { orderNo: req.params.orderNo }, include: { payments: { orderBy: { id: 'desc' } } } });
    if (!order) throw Errors.notFound('订单不存在');
    if (order.userId !== req.user!.id && req.user!.role === 'PASSENGER') throw Errors.forbidden('无权查看他人订单');
    const latest = order.payments[0];
    return ok(res, {
      orderNo: order.orderNo,
      orderStatus: order.status,
      expired: order.status === 'PENDING_PAYMENT' && order.expireAt.getTime() <= Date.now(),
      expireAt: order.expireAt,
      payment: latest
        ? { paymentNo: latest.paymentNo, outTradeNo: latest.outTradeNo, status: latest.status, amountCents: latest.amountCents, tradeNo: latest.tradeNo, paidAt: latest.paidAt, failReason: latest.failReason }
        : null,
    });
  }),
);

/** POST /payments/:orderNo/sync 主动向银行查单（补偿机制） */
paymentRouter.post(
  '/payments/:orderNo/sync',
  requireAuth,
  wrap(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { orderNo: req.params.orderNo }, include: { payments: { orderBy: { id: 'desc' } } } });
    if (!order) throw Errors.notFound('订单不存在');
    const latest = order.payments.find((p) => p.type === 'PAY');
    if (!latest) throw new ApiError(1001, '该订单尚未发起支付', 400);

    const remote = await paymentProvider.query(latest.outTradeNo);
    if (remote.status === 'SUCCESS' && latest.status !== 'SUCCESS') {
      const r = await settlePaySuccess(latest.outTradeNo, remote.tradeNo);
      return ok(res, { remote: remote.status, settled: true, orderNo: r.orderNo }, '查单发现已支付，已补记出票');
    }
    return ok(res, { remote: remote.status, settled: false, orderNo: order.orderNo }, '银行侧状态：' + remote.status);
  }),
);

/**
 * POST /payments/:orderNo/simulate
 * 演示辅助：一键模拟银行收银台结果（内部生成签名回调，走完整回调链路）
 * body: { action: 'SUCCESS' | 'FAILED' | 'CLOSE' }
 */
paymentRouter.post(
  '/payments/:orderNo/simulate',
  requireAuth,
  wrap(async (req, res) => {
    const action = String((req.body as { action?: string }).action ?? 'SUCCESS').toUpperCase();
    const order = await prisma.order.findUnique({ where: { orderNo: req.params.orderNo }, include: { payments: { orderBy: { id: 'desc' } } } });
    if (!order) throw Errors.notFound('订单不存在');
    if (order.userId !== req.user!.id && req.user!.role === 'PASSENGER') throw Errors.forbidden('无权操作他人订单');
    const latest = order.payments.find((p) => p.type === 'PAY');
    if (!latest) throw new ApiError(1001, '该订单尚未发起支付', 400);

    const payload = {
      outTradeNo: latest.outTradeNo,
      tradeNo: latest.tradeNo ?? `TN${Date.now()}`,
      amountCents: latest.amountCents,
      status: action === 'SUCCESS' ? 'SUCCESS' : action === 'FAILED' ? 'FAILED' : 'CLOSED',
    };
    const sign = paymentProvider.sign(payload);

    const result = await fetch(`http://127.0.0.1:${process.env.PORT ?? 4000}/api/v1/payments/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sign }),
    }).then((r) => r.json() as Promise<{ code: number; message: string; data: unknown }>);

    const fresh = await loadOrder(order.orderNo);
    return ok(res, { callback: result, order: buildOrderView(fresh!) }, result.message);
  }),
);

export { optionalAuth };
