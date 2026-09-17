/**
 * 接口一致性核对：把「后端注册的路由」与「前端实际调用的路径」做双向比对，
 * 用于发现编译期查不出的问题（URL 拼错、少写一段路径、调用了不存在的接口）。
 *
 * 用法：node scripts/check-api-usage.mjs
 * 退出码：0 = 全部匹配；1 = 存在前端调用但后端没有的路径
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api', 'src', 'routes');
const webDir = path.join(root, 'apps', 'web', 'src');

/** 路由文件 → 挂载前缀（必须与 apps/api/src/index.ts 一致） */
const MOUNT = {
  'auth.ts': '/api/v1/auth',
  'passengers.ts': '/api/v1/passengers',
  'trains.ts': '/api/v1',
  'orders.ts': '/api/v1',
  'payments.ts': '/api/v1',
  'tickets.ts': '/api/v1',
  'clerk.ts': '/api/v1/clerk',
  'admin.ts': '/api/v1/admin',
  'mock.ts': '/api/v1/mock',
};

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/* ── 1. 解析后端路由 ─────────────────────────────────────────── */
const backendRoutes = [];
for (const [file, prefix] of Object.entries(MOUNT)) {
  const full = path.join(apiDir, file);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  const re = /(?:Router|router)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const sub = m[2] === '/' ? '' : m[2];
    backendRoutes.push({ method, pattern: `${prefix}${sub}`, file });
  }
}

/** 后端路由模式 → 正则（:param 视为任意单段） */
function toRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/:[\w]+/g, '[^/]+')}$`);
}
const backendMatchers = backendRoutes.map((r) => ({ ...r, re: toRegex(r.pattern) }));

/**
 * 把前端模板字符串解析成可比较的路径：
 *  - `${qs({...})}` 这类查询串构造直接丢弃
 *  - `${xxx}` 这类路径变量替换为 __P__ 占位
 * 用栈扫描处理嵌套花括号（正则的 [^}]* 会被对象字面量里的 } 提前截断）
 */
function resolveTemplate(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < raw.length && depth > 0) {
        if (raw[j] === '{') depth += 1;
        else if (raw[j] === '}') depth -= 1;
        j += 1;
      }
      const expr = raw.slice(i + 2, j - 1);
      out += /^\s*qs\s*\(/.test(expr) ? '' : '__P__';
      i = j;
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out.split('?')[0].split('#')[0];
}

/* ── 2. 解析前端调用 ─────────────────────────────────────────── */
const frontendCalls = [];
for (const file of walk(webDir, ['.ts', '.tsx'])) {
  const src = fs.readFileSync(file, 'utf8');
  // 形如 api.get<T>('/orders/' + x)、api.post(`/orders/${no}/pay`)，
  // 也支持链式换行写法：await api\n  .get<T>('...')
  // 用 [^(]* 跳过泛型参数（类型里可能含嵌套 <>，用 <[^>]*> 会漏抓）
  const re = /\bapi\s*\.\s*(get|post|put|patch|del)\b[^(]*\(\s*([`'"])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, method, , raw] = m;
    const verb = method === 'del' ? 'DELETE' : method.toUpperCase();
    const resolved = resolveTemplate(raw);
    frontendCalls.push({
      method: verb,
      raw,
      resolved: resolved.startsWith('/api/v1') ? resolved : `/api/v1${resolved}`,
      file: path.relative(root, file),
    });
  }
}

/* ── 3. 比对 ─────────────────────────────────────────────────── */
const problems = [];
const matched = new Set();

for (const call of frontendCalls) {
  const candidates = [call.resolved];
  if (call.resolved.endsWith('__P__')) candidates.push(call.resolved.slice(0, -'__P__'.length));

  const hit = backendMatchers.find(
    (r) => r.method === call.method && candidates.some((c) => r.re.test(c.replace(/__P__/g, 'x'))),
  );
  if (hit) {
    matched.add(hit.pattern);
  } else {
    problems.push(call);
  }
}

/* ── 4. 输出 ─────────────────────────────────────────────────── */
console.log('后端注册路由：', backendRoutes.length, '条');
for (const [file, prefix] of Object.entries(MOUNT)) {
  const n = backendRoutes.filter((r) => r.file === file).length;
  console.log(`  ${prefix.padEnd(22)} ${String(n).padStart(2)} 条   (${file})`);
}

console.log('\n前端调用点：', frontendCalls.length, '处');
const uniqueFrontend = new Set(frontendCalls.map((c) => `${c.method} ${c.resolved}`));
console.log('前端调用去重：', uniqueFrontend.size, '个「方法 + 路径」组合');

if (problems.length === 0) {
  console.log('\n✅ 前端调用的每一个接口都能在后端找到对应路由');
} else {
  console.log(`\n❌ 有 ${problems.length} 处前端调用在后端找不到匹配路由：`);
  for (const p of problems) {
    console.log(`  ${p.method} ${p.resolved}    ← ${p.file}  (原文: ${p.raw})`);
  }
}

const unused = backendRoutes.filter((r) => !matched.has(r.pattern));
console.log(`\nℹ️  后端已实现但前端暂未调用（${unused.length} 条，属正常，部分为 Mock 契约与扩展能力）：`);
for (const u of unused) console.log(`  ${u.method.padEnd(6)} ${u.pattern}`);

process.exit(problems.length === 0 ? 0 : 1);
