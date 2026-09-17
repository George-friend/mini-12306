import { Router } from 'express';
import { z } from 'zod';
import { prisma, getIntSetting } from '../db';
import { ApiError, Errors, ok, wrap } from '../lib/http';
import { combineDateTime } from '../lib/datetime';
import { newChangeNo, newOrderNo, newOutTradeNo, newPaymentNo, newRefundNo } from '../lib/ids';
import { requireAuth } from '../middleware/auth';
import { lockSeats, confirmLockedSeats, restoreSoldSeats, availableOf } from '../services/inventory';
import { allocateSeatNos, TICKET_TYPE_DISCOUNT } from '../services/pricing';
import { quoteChange, quoteRefund } from '../services/ticket';
import { buildOrderView, loadOrder } from '../services/orderView';
import { paymentProvider } from '../providers/mock';

export const ticketRouter = Router();

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** 依据车票状态重算订单状态 */
async function recomputeOrderStatus(tx: Tx, orderId: number) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const live = items.filter((i) => !['CANCELLED', 'REFUNDED', 'CHANGED'].includes(i.ticketStatus));
  const refunded = items.filter((i) => i.ticketStatus === 'REFUNDED');
  const changed = items.filter((i) => i.ticketStatus === 'CHANGED');

  let status = 'PAID';
  if (live.length === 0 && refunded.length > 0) status = 'REFUNDED';
  else if (live.length === 0 && changed.length > 0) status = 'CHANGED';
  else if (refunded.length > 0 || changed.length > 0) status = 'PARTIAL_REFUNDED';
  await tx.order.update({ where: { id: orderId }, data: { status } });
}

/** 载入待退/待改车票（含订单、车次）并校验归属 */
async function loadItems(itemIds: number[], actor: { id: number; role: string }) {
  const items = await prisma.orderItem.findMany({
    where: { id: { in: itemIds } },
    include: { order: { include: { schedule: { include: { train: true } } } } },
  });
  if (items.length !== itemIds.length) throw Errors.notFound('车票不存在');
  for (const it of items) {
    if (it.ticketStatus !== 'TICKETED') throw new ApiError(5001, `车票「${it.passengerName}」当前状态不可办理（${it.ticketStatus}）`, 409);
    if (it.order.userId !== actor.id && actor.role === 'PASSENGER') throw Errors.forbidden('无权办理他人车票');
  }
  return items;
}

function departAtOf(item: { order: { schedule: { runDate: string; train: { departTime: string } } } }) {
  return combineDateTime(item.order.schedule.runDate, item.order.schedule.train.departTime);
}

/** GET /refunds/preview?orderItemIds=1,2 退票费试算 */
ticketRouter.get(
  '/refunds/preview',
  requireAuth,
  wrap(async (req, res) => {
    const ids = String(req.query.orderItemIds ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) throw new ApiError(1001, '请提供 orderItemIds', 400);

    const minFee = await getIntSetting('ticket.min_refund_fee_cents', 200);
    const items = await loadItems(ids, req.user!);
    const now = new Date();

    const list = items.map((it) => {
      const quote = quoteRefund(it.priceCents, departAtOf(it), now, minFee);
      return {
        orderItemId: it.id,
        orderNo: it.order.orderNo,
        passengerName: it.passengerName,
        seatClass: it.seatClass,
        priceCents: it.priceCents,
        priceYuan: (it.priceCents / 100).toFixed(2),
        departAt: departAtOf(it).toISOString(),
        ...quote,
        feeYuan: (quote.feeCents / 100).toFixed(2),
        refundYuan: (quote.refundCents / 100).toFixed(2),
      };
    });

    return ok(res, {
      list,
      totalFeeCents: list.reduce((s, i) => s + i.feeCents, 0),
      totalRefundCents: list.reduce((s, i) => s + i.refundCents, 0),
    });
  }),
);

/** POST /refunds 提交退票 */
ticketRouter.post(
  '/refunds',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({ orderItemIds: z.array(z.number().int().positive()).min(1), reason: z.string().max(100).optional() })
      .parse(req.body);

    const minFee = await getIntSetting('ticket.min_refund_fee_cents', 200);
    const items = await loadItems(body.orderItemIds, req.user!);
    const now = new Date();

    // 1) 试算（任一张已发车都会抛 6001）
    const plans = items.map((it) => ({ item: it, quote: quoteRefund(it.priceCents, departAtOf(it), now, minFee) }));
    const totalFee = plans.reduce((s, p) => s + p.quote.feeCents, 0);
    const totalRefund = plans.reduce((s, p) => s + p.quote.refundCents, 0);

    // 2) 事务：占位为退款中 + 回补库存 + 生成退票单
    const refundNos: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const p of plans) {
        await restoreSoldSeats(tx, p.item.order.scheduleId, p.item.seatClass, 1);
        await tx.orderItem.update({ where: { id: p.item.id }, data: { ticketStatus: 'REFUNDING' } });
        const r = await tx.refund.create({
          data: {
            refundNo: newRefundNo(),
            orderItemId: p.item.id,
            departAt: departAtOf(p.item),
            hoursBeforeDepart: p.quote.hoursBeforeDepart,
            feeRateBp: p.quote.feeRateBp,
            feeCents: p.quote.feeCents,
            refundCents: p.quote.refundCents,
            reason: body.reason ?? '用户申请退票',
            status: 'APPLYING',
            operatorId: req.user!.id,
          },
        });
        refundNos.push(r.refundNo);
      }
    });

    // 3) 调用第三方退款（Mock 原路退回）
    const outTrade = await prisma.payment.findFirst({ where: { orderId: plans[0].item.orderId, type: 'PAY', status: 'SUCCESS' } });
    const providerResult = await paymentProvider.refund({
      outTradeNo: outTrade?.outTradeNo ?? 'UNKNOWN',
      refundNo: refundNos[0],
      amountCents: totalRefund,
      reason: body.reason ?? '用户申请退票',
    });

    // 4) 结果落库
    if (providerResult.success) {
      await prisma.$transaction(async (tx) => {
        for (const p of plans) {
          await tx.orderItem.update({ where: { id: p.item.id }, data: { ticketStatus: 'REFUNDED' } });
        }
        await tx.refund.updateMany({ where: { refundNo: { in: refundNos } }, data: { status: 'SUCCESS' } });
        for (const orderId of new Set(plans.map((p) => p.item.orderId))) {
          await recomputeOrderStatus(tx, orderId);
        }
        await tx.payment.create({
          data: {
            paymentNo: newPaymentNo(),
            orderId: plans[0].item.orderId,
            orderItemId: plans[0].item.id,
            type: 'REFUND',
            amountCents: totalRefund,
            method: 'MOCK_BANK',
            status: 'SUCCESS',
            outTradeNo: newOutTradeNo(),
            tradeNo: providerResult.refundTradeNo,
            paidAt: new Date(),
          },
        });
      });
    } else {
      // 补偿：回滚库存与车票状态
      await prisma.$transaction(async (tx) => {
        for (const p of plans) {
          await tx.orderItem.update({ where: { id: p.item.id }, data: { ticketStatus: 'TICKETED' } });
          await tx.seatInventory.updateMany({
            where: { scheduleId: p.item.order.scheduleId, seatClass: p.item.seatClass },
            data: { soldCount: { increment: 1 } },
          });
        }
        await tx.refund.updateMany({ where: { refundNo: { in: refundNos } }, data: { status: 'FAILED' } });
      });
      throw new ApiError(7001, `退款失败：${providerResult.message}`, 502);
    }

    const orderNos = [...new Set(plans.map((p) => p.item.order.orderNo))];
    const views = [];
    for (const no of orderNos) {
      const o = await loadOrder(no);
      if (o) views.push(buildOrderView(o));
    }

    return ok(
      res,
      {
        refundNos,
        totalFeeCents: totalFee,
        totalRefundCents: totalRefund,
        totalFeeYuan: (totalFee / 100).toFixed(2),
        totalRefundYuan: (totalRefund / 100).toFixed(2),
        providerMessage: providerResult.message,
        orders: views,
      },
      `退票成功，退款 ￥${(totalRefund / 100).toFixed(2)} 已原路退回`,
    );
  }),
);

/** GET /refunds 退票记录 */
ticketRouter.get(
  '/refunds',
  requireAuth,
  wrap(async (req, res) => {
    const rows = await prisma.refund.findMany({
      where: req.user!.role === 'PASSENGER' ? { orderItem: { order: { userId: req.user!.id } } } : {},
      include: { orderItem: { include: { order: { include: { schedule: { include: { train: true } } } } } } },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return ok(res, {
      list: rows.map((r) => ({
        refundNo: r.refundNo,
        orderNo: r.orderItem.order.orderNo,
        passengerName: r.orderItem.passengerName,
        trainNo: r.orderItem.order.schedule.train.trainNo,
        runDate: r.orderItem.order.schedule.runDate,
        feeCents: r.feeCents,
        feeYuan: (r.feeCents / 100).toFixed(2),
        refundCents: r.refundCents,
        refundYuan: (r.refundCents / 100).toFixed(2),
        hoursBeforeDepart: r.hoursBeforeDepart,
        feeRateBp: r.feeRateBp,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    });
  }),
);

/** POST /changes/preview 改签试算 */
ticketRouter.post(
  '/changes/preview',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({ orderItemIds: z.array(z.number().int().positive()).min(1), toScheduleId: z.number().int().positive(), toSeatClass: z.string().min(2) })
      .parse(req.body);

    const minFee = await getIntSetting('ticket.min_refund_fee_cents', 200);
    const items = await loadItems(body.orderItemIds, req.user!);
    const target = await prisma.trainSchedule.findUnique({
      where: { id: body.toScheduleId },
      include: { train: true, inventory: true },
    });
    if (!target) throw Errors.notFound('目标运行计划不存在');
    if (target.status === 'CANCELLED') throw new ApiError(3002, '目标车次已停运', 400);

    const inv = target.inventory.find((i) => i.seatClass === body.toSeatClass);
    if (!inv) throw new ApiError(6003, '目标车次不发售所选席别', 400);
    const newDepartAt = combineDateTime(target.runDate, target.train.departTime);
    const now = new Date();

    const list = items.map((it) => {
      if (it.changeCount >= 1) throw new ApiError(6002, `车票「${it.passengerName}」已改签过一次，不可再次改签`, 400);
      const newPrice = Math.round(inv.priceCents * (TICKET_TYPE_DISCOUNT[it.ticketType] ?? 1));
      const q = quoteChange(it.priceCents, newPrice, newDepartAt, now, minFee);
      return {
        orderItemId: it.id,
        passengerName: it.passengerName,
        fromSeatClass: it.seatClass,
        toSeatClass: body.toSeatClass,
        ...q,
        fromPriceYuan: (it.priceCents / 100).toFixed(2),
        toPriceYuan: (newPrice / 100).toFixed(2),
        diffYuan: (q.diffCents / 100).toFixed(2),
        feeYuan: (q.feeCents / 100).toFixed(2),
        refundYuan: (q.refundCents / 100).toFixed(2),
        payableYuan: (q.payableCents / 100).toFixed(2),
      };
    });

    return ok(res, {
      toScheduleId: target.id,
      toTrainNo: target.train.trainNo,
      toRunDate: target.runDate,
      toDepartTime: target.train.departTime,
      toSeatClass: body.toSeatClass,
      targetAvailable: availableOf(inv),
      list,
      totalPayableCents: list.reduce((s, i) => s + i.payableCents, 0),
      totalRefundCents: list.reduce((s, i) => s + i.refundCents, 0),
      totalFeeCents: list.reduce((s, i) => s + i.feeCents, 0),
    });
  }),
);

/** POST /changes 提交改签（差价即时结算，简化处理） */
ticketRouter.post(
  '/changes',
  requireAuth,
  wrap(async (req, res) => {
    const body = z
      .object({ orderItemIds: z.array(z.number().int().positive()).min(1), toScheduleId: z.number().int().positive(), toSeatClass: z.string().min(2) })
      .parse(req.body);

    const minFee = await getIntSetting('ticket.min_refund_fee_cents', 200);
    const items = await loadItems(body.orderItemIds, req.user!);
    const target = await prisma.trainSchedule.findUnique({
      where: { id: body.toScheduleId },
      include: { train: { include: { fromStation: true, toStation: true } }, inventory: true },
    });
    if (!target) throw Errors.notFound('目标运行计划不存在');
    if (target.status === 'CANCELLED') throw new ApiError(3002, '目标车次已停运，无法改签', 400);

    const inv = target.inventory.find((i) => i.seatClass === body.toSeatClass);
    if (!inv) throw new ApiError(6003, '目标车次不发售所选席别', 400);
    if (availableOf(inv) < items.length) throw new ApiError(6003, `目标席别余票不足，当前仅剩 ${availableOf(inv)} 张`, 409);

    const newDepartAt = combineDateTime(target.runDate, target.train.departTime);
    const now = new Date();
    const plans = items.map((it) => {
      if (it.changeCount >= 1) throw new ApiError(6002, `车票「${it.passengerName}」已改签过一次，不可再次改签`, 400);
      const newPrice = Math.round(inv.priceCents * (TICKET_TYPE_DISCOUNT[it.ticketType] ?? 1));
      return { item: it, newPrice, quote: quoteChange(it.priceCents, newPrice, newDepartAt, now, minFee) };
    });

    const totalPayable = plans.reduce((s, p) => s + p.quote.payableCents, 0);
    const totalRefund = plans.reduce((s, p) => s + p.quote.refundCents, 0);
    const changeNos: string[] = [];
    let createdOrderNo = '';
    const originalOrderIds = [...new Set(plans.map((p) => p.item.orderId))];

    await prisma.$transaction(async (tx) => {
      // 释放旧席别库存
      for (const p of plans) {
        await restoreSoldSeats(tx, p.item.order.scheduleId, p.item.seatClass, 1);
      }
      // 占用新席别库存
      const locked = await lockSeats(tx, target.id, body.toSeatClass, plans.length);
      await confirmLockedSeats(tx, target.id, body.toSeatClass, plans.length);
      const seatNos = allocateSeatNos(body.toSeatClass, locked.soldCount + locked.lockedCount, plans.length);

      // 新订单（改签后票价合计）
      const createdOrder = await tx.order.create({
        data: {
          orderNo: newOrderNo(),
          userId: plans[0].item.order.userId,
          scheduleId: target.id,
          channel: plans[0].item.order.channel,
          passengerCount: plans.length,
          totalAmountCents: plans.reduce((s, p) => s + p.newPrice, 0),
          paidAmountCents: plans.reduce((s, p) => s + p.newPrice, 0),
          status: 'PAID',
          expireAt: now,
          paidAt: now,
          remark: `由订单 ${plans.map((p) => p.item.order.orderNo).join('、')} 改签生成`,
        },
      });
      createdOrderNo = createdOrder.orderNo;

      for (let i = 0; i < plans.length; i += 1) {
        const p = plans[i];
        // 旧票标记为已改签
        await tx.orderItem.update({
          where: { id: p.item.id },
          data: { ticketStatus: 'CHANGED', changeCount: { increment: 1 } },
        });
        // 生成新票
        const newItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            passengerId: p.item.passengerId,
            passengerName: p.item.passengerName,
            idCardSuffix: p.item.idCardSuffix,
            seatClass: body.toSeatClass,
            ticketType: p.item.ticketType,
            priceCents: p.newPrice,
            seatNo: seatNos[i],
            ticketStatus: 'TICKETED',
            changeCount: 1,
            changeSeq: p.item.changeSeq + 1,
          },
        });
        const change = await tx.change.create({
          data: {
            changeNo: newChangeNo(),
            orderItemId: p.item.id,
            newOrderItemId: newItem.id,
            fromScheduleId: p.item.order.scheduleId,
            toScheduleId: target.id,
            fromSeatClass: p.item.seatClass,
            toSeatClass: body.toSeatClass,
            fromPriceCents: p.item.priceCents,
            toPriceCents: p.newPrice,
            diffCents: p.quote.diffCents,
            diffType: p.quote.diffType,
            feeCents: p.quote.feeCents,
            status: 'SUCCESS',
            operatorId: req.user!.id,
          },
        });
        changeNos.push(change.changeNo);
      }

      // 差价流水
      if (totalPayable > 0) {
        await tx.payment.create({
          data: {
            paymentNo: newPaymentNo(),
            orderId: createdOrder.id,
            type: 'CHANGE_DIFF',
            amountCents: totalPayable,
            method: 'MOCK_BANK',
            status: 'SUCCESS',
            outTradeNo: newOutTradeNo(),
            tradeNo: `CD${Date.now()}`,
            paidAt: now,
          },
        });
      } else if (totalRefund > 0) {
        await tx.payment.create({
          data: {
            paymentNo: newPaymentNo(),
            orderId: createdOrder.id,
            type: 'REFUND',
            amountCents: totalRefund,
            method: 'MOCK_BANK',
            status: 'SUCCESS',
            outTradeNo: newOutTradeNo(),
            tradeNo: `CDR${Date.now()}`,
            paidAt: now,
          },
        });
      }

      for (const orderId of originalOrderIds) {
        await recomputeOrderStatus(tx, orderId);
      }
    });

    // 退差：调用第三方退款（Mock）
    let providerMessage = '无差价';
    if (totalRefund > 0) {
      const r = await paymentProvider.refund({
        outTradeNo: 'CHANGE_DIFF',
        refundNo: changeNos[0],
        amountCents: totalRefund,
        reason: '改签退还差价',
      });
      providerMessage = r.message;
    } else if (totalPayable > 0) {
      providerMessage = `已补收差价 ￥${(totalPayable / 100).toFixed(2)}（Mock 通道即时结算）`;
    }

    const fresh = await loadOrder(createdOrderNo);
    return ok(
      res,
      {
        changeNos,
        newOrderNo: createdOrderNo,
        totalPayableCents: totalPayable,
        totalPayableYuan: (totalPayable / 100).toFixed(2),
        totalRefundCents: totalRefund,
        totalRefundYuan: (totalRefund / 100).toFixed(2),
        providerMessage,
        newOrder: fresh ? buildOrderView(fresh) : null,
      },
      `改签成功（${target.train.trainNo} ${target.runDate} ${target.train.departTime}）`,
    );
  }),
);

/** GET /changes 改签记录 */
ticketRouter.get(
  '/changes',
  requireAuth,
  wrap(async (req, res) => {
    const rows = await prisma.change.findMany({
      where: req.user!.role === 'PASSENGER' ? { orderItem: { order: { userId: req.user!.id } } } : {},
      include: { orderItem: { include: { order: { include: { schedule: { include: { train: true } } } } } }, newOrderItem: true },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return ok(res, {
      list: rows.map((c) => ({
        changeNo: c.changeNo,
        orderNo: c.orderItem.order.orderNo,
        passengerName: c.orderItem.passengerName,
        fromTrainNo: c.orderItem.order.schedule.train.trainNo,
        fromRunDate: c.orderItem.order.schedule.runDate,
        fromSeatClass: c.fromSeatClass,
        toSeatClass: c.toSeatClass,
        fromPriceCents: c.fromPriceCents,
        toPriceCents: c.toPriceCents,
        diffCents: c.diffCents,
        diffYuan: (c.diffCents / 100).toFixed(2),
        diffType: c.diffType,
        feeCents: c.feeCents,
        status: c.status,
        newSeatNo: c.newOrderItem?.seatNo ?? null,
        createdAt: c.createdAt,
      })),
    });
  }),
);

/** 生成新订单号（避免与路由内变量名冲突） */
