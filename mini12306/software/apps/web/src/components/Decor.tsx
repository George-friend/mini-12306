/**
 * 装饰性 SVG：铁路主题视觉元素（全部本地自绘，无外部图片依赖，离线可用）
 * —— 铁轨透视、速度线、复兴号车头剪影、网格底纹
 */

/** Hero 底部：向消失点汇聚的铁轨 + 枕木 */
export function HeroRails({ className = '' }: { className?: string }) {
  const vanish = { x: 600, y: 26 };
  const left = { x: -120, y: 230 };
  const right = { x: 1320, y: 230 };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const sleepers = [0.06, 0.16, 0.28, 0.4, 0.52, 0.64, 0.75, 0.85, 0.93];

  return (
    <svg viewBox="0 0 1200 240" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="railFade" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="sleeperFade" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* 枕木 */}
      <g stroke="url(#sleeperFade)" strokeWidth="2">
        {sleepers.map((t) => {
          const y = lerp(left.y, vanish.y, t);
          const lx = lerp(left.x, vanish.x, t);
          const rx = lerp(right.x, vanish.x, t);
          return <line key={t} x1={lx} y1={y} x2={rx} y2={y} />;
        })}
      </g>

      {/* 两条钢轨 */}
      <g stroke="url(#railFade)" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d={`M${left.x} ${left.y} L${vanish.x} ${vanish.y}`} />
        <path d={`M${right.x} ${right.y} L${vanish.x} ${vanish.y}`} />
      </g>

      {/* 远处的地平线光晕 */}
      <ellipse cx={vanish.x} cy={vanish.y} rx="260" ry="34" fill="#ffffff" opacity="0.10" />
      <ellipse cx={vanish.x} cy={vanish.y} rx="120" ry="16" fill="#ffffff" opacity="0.14" />
    </svg>
  );
}

/** 复兴号车头侧影（装饰用） */
export function TrainSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 120" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="trainBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.10" />
        </linearGradient>
      </defs>

      {/* 车身 */}
      <path
        d="M396 26 H150 C90 26 44 42 12 62 C44 82 90 96 150 96 H396 Z"
        fill="url(#trainBody)"
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      {/* 车窗带 */}
      <g fill="#ffffff" opacity="0.32">
        {[186, 226, 266, 306, 346].map((x) => (
          <rect key={x} x={x} y={40} width={28} height={20} rx={4} />
        ))}
      </g>
      {/* 驾驶室风挡 */}
      <path d="M120 36 C96 42 74 50 58 62 C74 74 96 82 120 88 Z" fill="#ffffff" opacity="0.22" />
      {/* 中国红腰带 */}
      <rect x="64" y="70" width="332" height="7" rx="3.5" fill="#e5484d" opacity="0.75" />
      {/* 转向架 */}
      <g fill="#0b3a86" opacity="0.5">
        <rect x="150" y="96" width="58" height="12" rx="5" />
        <rect x="300" y="96" width="58" height="12" rx="5" />
      </g>
      {/* 速度线 */}
      <g stroke="#ffffff" strokeLinecap="round" opacity="0.35">
        <line x1="8" y1="34" x2="52" y2="34" strokeWidth="2" />
        <line x1="0" y1="48" x2="34" y2="48" strokeWidth="2" />
        <line x1="16" y1="76" x2="70" y2="76" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** 斜向速度线纹理（用于 Hero 与卡片背景） */
export function SpeedLines({ className = '', opacity = 0.12 }: { className?: string; opacity?: number }) {
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="none" className={className} style={{ opacity }} aria-hidden="true">
      <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round">
        {Array.from({ length: 14 }).map((_, i) => {
          const x = -40 + i * 34;
          const y = 200 - i * 6;
          return <line key={i} x1={x} y1={y} x2={x + 90} y2={y - 110} opacity={0.35 + (i % 4) * 0.16} />;
        })}
      </g>
    </svg>
  );
}

/** 站台指示牌风格的角标（蓝底白字方块） */
export function SignBadge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 h-6 text-[11px] font-medium tracking-wider text-white/90 ring-1 ring-inset ring-white/20 ${className}`}>
      {children}
    </span>
  );
}

/** 品牌标记：白色复兴号剪影（放在蓝色圆形/圆角底上） */
export function TrainMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M5 21c0-4.6 2.8-8.7 6.4-10 1.6-.6 3.3-.8 5-.7l7.6.5c1.3.1 2.2 1.3 1.9 2.6l-2 8.6c-.2.9-1 1.5-1.9 1.5H6.8C5.8 23.5 5 22.7 5 21.7V21Z"
        fill="currentColor"
        opacity=".95"
      />
      <path d="M11.5 12.6c1.5-.8 3.1-1.2 4.8-1l4.7.3-1.3 5.3H9.6l1.9-4.6Z" fill="#1f6feb" opacity=".45" />
      <circle cx="11" cy="21.6" r="2.1" fill="#0b3a86" />
      <circle cx="21.5" cy="21.6" r="2.1" fill="#0b3a86" />
      <rect x="9.5" y="25.2" width="12" height="1.8" rx=".9" fill="currentColor" opacity=".85" />
    </svg>
  );
}
