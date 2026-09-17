import { prisma } from '../db';
import { combineDateTime, cnDateTimeString } from '../lib/datetime';
import { SEAT_CLASS_LABEL, TICKET_TYPE_LABEL } from './pricing';

/** 订单视图（订单 + 车票 + 支付 + 退改），供旅客端 / 售票端 / 管理端复用 */

export const ORDER_STATUS_TEXT: Record<string, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  PARTIAL_REFUNDED: '部分退票',
  REFUNDED: '已退票',
  CHANGED: '已改签',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
  CLOSED: '已完成',
};

export const TICKET_STATUS_TEXT: Record<string, string> = {
  LOCKED: '待支付',
  TICKETED: '已出票',
  REFUNDING: '退票中',
  REFUNDED: '已退票',
  CHANGED: '已改签',
  USED: '已乘车',
  CANCELLED: '已取消',
};

export const PAYMENT_STATUS_TEXT: Record<string, string> = {
  PENDING: '待支付',
  SUCCESS: '成功',
  FAILED: '失败',
  CLOSED: '已关闭',
};

export type OrderWithRelations = Awaited<ReturnType<typeof loadOrder>>;

export async function loadOrder(orderNo: string) {
  return prisma.order.findUnique({
    where: { orderNo },
    include: {
      user: true,
      schedule: { include: { train: { include: { fromStation: true, toStation: true } } } },
      items: { include: { refunds: true, changesOld: true }, orderBy: { id: 'asc' } },
      payments: { orderBy: { id: 'asc' } },
    },
  });
}

export function buildOrderView(order: NonNullable<OrderWithRelations>, options: { withUser?: boolean } = {}) {
  const train = order.schedule.train;
  const departAt = combineDateTime(order.schedule.runDate, train.departTime);
  const now = Date.now();
  const minutesToDepart = Math.round((departAt.getTime() - now) / 60000);

  return {
    orderNo: order.orderNo,
    channel: order.channel,
    status: order.status,
    statusText: ORDER_STATUS_TEXT[order.status] ?? order.status,
    passengerCount: order.passengerCount,
    totalAmountCents: order.totalAmountCents,
    totalAmountYuan: (order.totalAmountCents / 100).toFixed(2),
    paidAmountCents: order.paidAmountCents,
    paidAmountYuan: (order.paidAmountCents / 100).toFixed(2),
    expireAt: order.expireAt,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    canPay: order.status === 'PENDING_PAYMENT' && order.expireAt.getTime() > now,
    canCancel: order.status === 'PENDING_PAYMENT',
    minutesToDepart,
    canRefund: order.status === 'PAID' || order.status === 'PARTIAL_REFUNDED',
    remark: order.remark,
    user: options.withUser ? { id: order.user.id, username: order.user.username, realName: order.user.realName, phone: order.user.phone } : undefined,
    train: {
      trainNo: train.trainNo,
      trainType: train.trainType,
      fromStation: train.fromStation.name,
      toStation: train.toStation.name,
      runDate: order.schedule.runDate,
      departTime: train.departTime,
      arriveTime: train.arriveTime,
      departDateTime: departAt.toISOString(),
      departDateTimeText: cnDateTimeString(departAt),
      scheduleId: order.scheduleId,
      scheduleStatus: order.schedule.status,
      scheduleStatusText: order.schedule.status === 'CANCELLED' ? '停运' : order.schedule.status === 'DELAYED' ? `晚点${order.schedule.delayMinutes}分` : '正点',
    },
    items: order.items
      .filter((it) => !it.isDeleted)
      .map((it) => ({
        id: it.id,
        passengerId: it.passengerId,
        passengerName: it.passengerName,
        idCardMasked: `**************${it.idCardSuffix}`,
        seatClass: it.seatClass,
        seatClassLabel: SEAT_CLASS_LABEL[it.seatClass] ?? it.seatClass,
        ticketType: it.ticketType,
        ticketTypeLabel: TICKET_TYPE_LABEL[it.ticketType] ?? it.ticketType,
        priceCents: it.priceCents,
        priceYuan: (it.priceCents / 100).toFixed(2),
        seatNo: it.seatNo,
        ticketStatus: it.ticketStatus,
        ticketStatusText: TICKET_STATUS_TEXT[it.ticketStatus] ?? it.ticketStatus,
        changeCount: it.changeCount,
        refunds: it.refunds.map((r) => ({
          refundNo: r.refundNo,
          feeCents: r.feeCents,
          refundCents: r.refundCents,
          status: r.status,
          createdAt: r.createdAt,
        })),
      })),
    payments: order.payments.map((p) => ({
      paymentNo: p.paymentNo,
      type: p.type,
      amountCents: p.amountCents,
      amountYuan: (p.amountCents / 100).toFixed(2),
      method: p.method,
      status: p.status,
      statusText: PAYMENT_STATUS_TEXT[p.status] ?? p.status,
      tradeNo: p.tradeNo,
      paidAt: p.paidAt,
      failReason: p.failReason,
      createdAt: p.createdAt,
    })),
  };
}
