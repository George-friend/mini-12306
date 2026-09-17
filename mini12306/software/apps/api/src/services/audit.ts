import type { Request } from 'express';
import { prisma } from '../db';

/** 审计日志（BR-20：管理员的写操作必须留痕） */
export async function writeAudit(
  req: Request,
  action: string,
  targetType: string,
  targetId?: string | number | null,
  detail?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id ?? null,
        actorName: req.user?.username ?? null,
        actorRole: req.user?.role ?? null,
        action,
        targetType,
        targetId: targetId === undefined || targetId === null ? null : String(targetId),
        detail: detail === undefined ? null : JSON.stringify(detail),
        ip: (req.headers['x-forwarded-for'] as string) ?? req.ip ?? null,
      },
    });
  } catch (e) {
    // 审计失败不影响主流程
    // eslint-disable-next-line no-console
    console.error('[audit] 写入失败', e);
  }
}
