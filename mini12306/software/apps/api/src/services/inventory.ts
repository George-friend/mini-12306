import type { Prisma } from '@prisma/client';
import { ApiError, Errors } from '../lib/http';

type Tx = Prisma.TransactionClient;

/**
 * 库存服务（M4 核心）
 * ─ 余票 = 总定员 − 已售 − 已锁定
 * ─ 任何扣减都在事务内以「乐观锁（version）+ 条件更新」完成，受影响行数为 0 即为并发冲突
 */

export function availableOf(inv: { totalCount: number; soldCount: number; lockedCount: number }): number {
  return inv.totalCount - inv.soldCount - inv.lockedCount;
}

/** 读取余票（不存在该席别返回 null） */
export async function readInventory(tx: Tx | { seatInventory: any }, scheduleId: number, seatClass: string) {
  return tx.seatInventory.findFirst({ where: { scheduleId, seatClass } });
}

/** 锁定余票（下单）。失败抛 4001 余票不足 / 4002 并发冲突 */
export async function lockSeats(tx: Tx, scheduleId: number, seatClass: string, count: number) {
  const inv = await tx.seatInventory.findFirst({ where: { scheduleId, seatClass } });
  if (!inv) throw new ApiError(4001, `该车次不发售「${seatClass}」席别`, 409);

  const available = availableOf(inv);
  if (available < count) {
    throw new ApiError(4001, `余票不足，当前仅剩 ${available} 张`, 409);
  }

  const updated = await tx.seatInventory.updateMany({
    where: { id: inv.id, version: inv.version },
    data: { lockedCount: { increment: count }, version: { increment: 1 } },
  });
  if (updated.count === 0) throw Errors.conflict('库存并发冲突，请重新提交');
  return inv;
}

/** 释放锁定（订单取消 / 超时） */
export async function releaseLockedSeats(tx: Tx, scheduleId: number, seatClass: string, count: number) {
  const inv = await tx.seatInventory.findFirst({ where: { scheduleId, seatClass } });
  if (!inv) return;
  const release = Math.min(count, inv.lockedCount);
  if (release <= 0) return;
  await tx.seatInventory.updateMany({
    where: { id: inv.id, version: inv.version },
    data: { lockedCount: { decrement: release }, version: { increment: 1 } },
  });
}

/** 锁定转已售（支付成功） */
export async function confirmLockedSeats(tx: Tx, scheduleId: number, seatClass: string, count: number) {
  const inv = await tx.seatInventory.findFirst({ where: { scheduleId, seatClass } });
  if (!inv) throw Errors.internal('库存记录缺失，无法确认出票');
  const locked = Math.min(count, inv.lockedCount);
  await tx.seatInventory.updateMany({
    where: { id: inv.id, version: inv.version },
    data: { lockedCount: { decrement: locked }, soldCount: { increment: count }, version: { increment: 1 } },
  });
}

/** 退票回补已售 */
export async function restoreSoldSeats(tx: Tx, scheduleId: number, seatClass: string, count: number) {
  const inv = await tx.seatInventory.findFirst({ where: { scheduleId, seatClass } });
  if (!inv) return;
  await tx.seatInventory.updateMany({
    where: { id: inv.id, version: inv.version },
    data: { soldCount: { decrement: Math.min(count, inv.soldCount) }, version: { increment: 1 } },
  });
}

/** 改签释放旧席别（已售 → 释放） */
export async function swapSeats(tx: Tx, from: { scheduleId: number; seatClass: string; count: number }, to: { scheduleId: number; seatClass: string; count: number }) {
  await restoreSoldSeats(tx, from.scheduleId, from.seatClass, from.count);
  await lockSeats(tx, to.scheduleId, to.seatClass, to.count);
  await confirmLockedSeats(tx, to.scheduleId, to.seatClass, to.count);
}
