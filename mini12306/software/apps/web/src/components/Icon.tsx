/**
 * 自绘线性图标集（零依赖，统一 24×24 viewBox、stroke 用 currentColor）
 * 图标来源：项目内手工绘制，避免引入图标库带来的体积与离线依赖。
 */
export type IconName =
  | 'train'
  | 'ticket'
  | 'search'
  | 'calendar'
  | 'swap'
  | 'pin'
  | 'clock'
  | 'shield'
  | 'wallet'
  | 'user'
  | 'users'
  | 'chart'
  | 'settings'
  | 'bell'
  | 'check'
  | 'alert'
  | 'info'
  | 'route'
  | 'seat'
  | 'chevron-right'
  | 'arrow-right'
  | 'refresh'
  | 'window'
  | 'lock';

const PATHS: Record<IconName, string> = {
  train: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-3 6h14M9 21l2-4m4 4-2-4M5 21h14',
  ticket: 'M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Zm7-4v14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm4-3v4m8-4v4M4 10h16',
  swap: 'M4 8h13l-3-3m3 3-3 3M20 16H7l3-3m-3 3 3 3',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5V12l3.5 2',
  shield: 'M12 3l7 3v5.5c0 4.4-2.9 8.2-7 9.5-4.1-1.3-7-5.1-7-9.5V6l7-3Zm-2.5 9 2 2 4-4',
  wallet: 'M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h16m0 0v3h-4a1.5 1.5 0 0 1 0-3h4Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m2-16a3.5 3.5 0 0 1 0 7m2 9a6 6 0 0 0-3-5.2',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8.4 8.4 0 0 0-2-1.2L15.6 3h-4l-.4 2.5a8.4 8.4 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a8.4 8.4 0 0 0 2 1.2l.4 2.5h4l.4-2.5a8.4 8.4 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  bell: 'M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16Zm-8 3a2 2 0 0 0 4 0',
  check: 'M5 13l4.5 4.5L19 7',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v5m0 3v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v.5M12 11v6',
  route: 'M6 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12-11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 0v3.5a4 4 0 0 1-4 4H9a3 3 0 0 0-3 3',
  seat: 'M6 4v9a3 3 0 0 0 3 3h5a4 4 0 0 1 4 4M6 8h8a2 2 0 0 1 2 2v3',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-right': 'M5 12h13m-5-6 6 6-6 6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  window: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm0 4h16M8 7.5h.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Z',
};

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
