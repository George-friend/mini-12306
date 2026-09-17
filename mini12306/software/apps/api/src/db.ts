import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** 读取整型系统参数（带兜底默认值，避免参数缺失导致业务中断） */
export async function getIntSetting(key: string, fallback: number): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

/** 读取布尔型系统参数 */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value === 'true' || row.value === '1';
}
