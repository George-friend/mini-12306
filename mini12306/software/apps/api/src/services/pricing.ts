/** 席别、票价与座位号规则（简化但可解释的模型，详见 docs） */

export type SeatClass = 'BUSINESS' | 'FIRST' | 'SECOND' | 'SOFT_SLEEPER' | 'HARD_SLEEPER' | 'HARD_SEAT' | 'STANDING';
export type TicketType = 'ADULT' | 'CHILD' | 'STUDENT';

export const SEAT_CLASS_LABEL: Record<string, string> = {
  BUSINESS: '商务座',
  FIRST: '一等座',
  SECOND: '二等座',
  SOFT_SLEEPER: '软卧',
  HARD_SLEEPER: '硬卧',
  HARD_SEAT: '硬座',
  STANDING: '无座',
};

export const TICKET_TYPE_LABEL: Record<string, string> = {
  ADULT: '成人票',
  CHILD: '儿童票',
  STUDENT: '学生票',
};

/** 席别价格系数 */
export const SEAT_CLASS_FACTOR: Record<string, number> = {
  BUSINESS: 3.0,
  FIRST: 1.6,
  SECOND: 1.0,
  SOFT_SLEEPER: 1.9,
  HARD_SLEEPER: 1.2,
  HARD_SEAT: 0.8,
  STANDING: 1.0,
};

/** 票种折扣 */
export const TICKET_TYPE_DISCOUNT: Record<string, number> = {
  ADULT: 1.0,
  CHILD: 0.5,
  STUDENT: 0.75,
};

/** 里程系数（递远递增的简化处理） */
export function mileageFactor(km: number): number {
  if (km <= 200) return 0.9;
  if (km <= 500) return 1.0;
  if (km <= 1000) return 1.1;
  return 1.2;
}

/** 不同车次类型发售的席别 */
export function seatClassesForTrainType(trainType: string): SeatClass[] {
  if (trainType === 'G' || trainType === 'D') return ['BUSINESS', 'FIRST', 'SECOND', 'STANDING'];
  return ['SOFT_SLEEPER', 'HARD_SLEEPER', 'HARD_SEAT'];
}

/** 各席别定员（用于生成运行日库存） */
export const SEAT_CLASS_CAPACITY: Record<string, number> = {
  BUSINESS: 20,
  FIRST: 60,
  SECOND: 400,
  SOFT_SLEEPER: 36,
  HARD_SLEEPER: 66,
  HARD_SEAT: 480,
  STANDING: 120,
};

/** 票价 = 基准价 × 席别系数 × 里程系数 × 票种折扣（四舍五入到分） */
export function computePrice(basePriceCents: number, seatClass: string, ticketType: string, mileageKm: number): number {
  const f = SEAT_CLASS_FACTOR[seatClass] ?? 1;
  const d = TICKET_TYPE_DISCOUNT[ticketType] ?? 1;
  return Math.round(basePriceCents * f * mileageFactor(mileageKm) * d);
}

/** 学生票仅限二等座 / 硬座 */
export function studentAllowed(seatClass: string): boolean {
  return seatClass === 'SECOND' || seatClass === 'HARD_SEAT';
}

/** 儿童票需有成人同行（同订单内至少一名成人） */
export function childNeedsAdult(ticketTypes: string[]): boolean {
  const hasChild = ticketTypes.includes('CHILD');
  const hasAdult = ticketTypes.includes('ADULT');
  return hasChild && !hasAdult;
}

/** ── 座位号分配（顺序分配，同订单连号）── */
const LETTERS: Record<string, string[]> = {
  BUSINESS: ['A', 'C', 'F'],
  FIRST: ['A', 'C', 'D', 'F'],
  SECOND: ['A', 'B', 'C', 'D', 'F'],
};

const PER_CARRIAGE: Record<string, number> = {
  BUSINESS: 51,
  FIRST: 68,
  SECOND: 85,
  HARD_SEAT: 118,
  HARD_SLEEPER: 66,
  SOFT_SLEEPER: 36,
};

export function allocateSeatNos(seatClass: string, startIndex: number, count: number): string[] {
  if (seatClass === 'STANDING') return Array.from({ length: count }, () => '无座');
  const result: string[] = [];
  const per = PER_CARRIAGE[seatClass] ?? 100;

  for (let k = 0; k < count; k += 1) {
    const idx = startIndex + k;
    const carriage = Math.floor(idx / per) + 1;
    const within = idx % per;

    if (seatClass === 'HARD_SEAT') {
      result.push(`${String(carriage).padStart(2, '0')}车${String(within + 1).padStart(3, '0')}号`);
    } else if (seatClass === 'HARD_SLEEPER') {
      const berth = ['上铺', '中铺', '下铺'][within % 3];
      result.push(`${String(carriage).padStart(2, '0')}车${String(Math.floor(within / 3) + 1).padStart(2, '0')}号${berth}`);
    } else if (seatClass === 'SOFT_SLEEPER') {
      const berth = ['上铺', '下铺'][within % 2];
      result.push(`${String(carriage).padStart(2, '0')}车${String(Math.floor(within / 2) + 1).padStart(2, '0')}号${berth}`);
    } else {
      const letters = LETTERS[seatClass] ?? LETTERS.SECOND;
      const perRow = letters.length;
      const row = Math.floor(within / perRow) + 1;
      const letter = letters[within % perRow];
      result.push(`${String(carriage).padStart(2, '0')}车${String(row).padStart(2, '0')}${letter}`);
    }
  }
  return result;
}

/** 分转元显示 */
export function fen2yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
