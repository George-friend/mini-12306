/**
 * 真实浏览器 UI 冒烟测试（Chrome/Edge 无头 + CDP，零 npm 依赖）
 *
 * 用真实鼠标/键盘事件（Input.dispatchMouseEvent / Input.insertText）模拟用户操作，
 * 覆盖首页查询的正常路径与边界路径，并把关键页面截图落到 assets/ui/。
 *
 * 用法：
 *   node scripts/ui-check.mjs
 *   node scripts/ui-check.mjs --url http://127.0.0.1:5173
 *   node scripts/ui-check.mjs --headed
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const BASE = arg('url', 'http://127.0.0.1:4000');
const HEADED = argv.includes('--headed');
const PORT = 9222;
const SHOT_DIR = path.join(root, 'assets', 'ui');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/* ── 极简 CDP 客户端 ─────────────────────────────────────── */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  /** 真实鼠标点击（按下 + 抬起），坐标为视口坐标 */
  async mouseClick(x, y) {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }
  /** 定位元素中心并真实点击；元素被遮挡时返回遮挡者信息 */
  async clickSelector(selector, { index = 0, nthText = null } = {}) {
    const measure = () =>
      this.eval(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const list = ${nthText ? `all.filter(e => e.textContent.trim() === ${JSON.stringify(nthText)})` : 'all'};
        const el = list[${index}];
        if (!el) return { found: false, total: all.length };
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        return {
          found: true, total: all.length, x: cx, y: cy,
          covered: top !== el && !el.contains(top),
          coveredBy: top ? top.tagName + (top.className ? '.' + String(top.className).split(' ')[0] : '') : null,
          text: el.textContent.trim().slice(0, 40),
        };
      })()`);

    await this.eval(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const list = ${nthText ? `all.filter(e => e.textContent.trim() === ${JSON.stringify(nthText)})` : 'all'};
      list[${index}]?.scrollIntoView({ block: 'center' });
    })()`);
    await sleep(60);

    const info = await measure();
    if (!info.found) return info;
    await this.mouseClick(info.x, info.y);

    // 位移检测：若点击前后元素位置发生变化，说明页面在点击瞬间发生了重排/内部滚动，
    // 这种情况下 mousedown 与 mouseup 可能落在不同元素上，click 事件不会触发（真实用户也会踩到）。
    // 元素点击后消失（found=false）视为「已跳转」，不计为位移。
    await sleep(60);
    const after = await measure();
    info.shifted = after.found ? Math.round(Math.abs(after.x - info.x) + Math.abs(after.y - info.y)) : 0;
    return info;
  }
  async screenshot(name, { fullPage = true, dir = SHOT_DIR } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 15000, interval = 250, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > timeout) throw new Error(`等待「${label}」超时（${timeout}ms）`);
    await sleep(interval);
  }
}

let pass = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

/** 读取当前页面的关键状态 */
const PAGE_STATE = `(() => {
  const text = document.body.innerText;
  return {
    url: location.pathname + location.search,
    bodyLen: text.length,
    hasHero: text.includes('一次查询，直达目的地'),
    onTrainList: /车次/.test(text) && /历时|二等座|商务座|硬座|无票|有票/.test(text),
    emptyHint: /未查询到|暂无符合条件的车次|没有找到/.test(text),
    formError: (document.querySelector('[role=alert]') || {}).textContent || '',
    dropdown: (() => {
      const l = document.getElementById('home-from-listbox') || document.getElementById('home-to-listbox');
      if (!l) return { open: false, count: 0, options: [] };
      const opts = [...l.querySelectorAll('[role=option]')];
      return { open: true, count: opts.length, options: opts.map(o => o.textContent.trim()) };
    })(),
    trains: (() => {
      const nodes = [...document.querySelectorAll('*')].filter(e => /^[GDKTZ]\\d{2,4}$/.test(e.textContent.trim()));
      return nodes.slice(0, 8).map(e => e.textContent.trim());
    })(),
  };
})()`;

async function main() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('未找到 Chrome / Edge');
  const userDataDir = path.join(root, '.ui-check-profile');
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log(`浏览器：${exe}`);
  console.log(`目标  ：${BASE}\n`);

  const child = spawn(
    exe,
    [
      HEADED ? '--headless=false' : '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1440,1000',
      '--hide-scrollbars',
      'about:blank',
    ].filter(Boolean),
    { stdio: 'ignore' },
  );

  let target = null;
  await waitFor(
    async () => {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
        target = list.find((t) => t.type === 'page');
        return !!target?.webSocketDebuggerUrl;
      } catch {
        return false;
      }
    },
    { timeout: 25000, label: 'Chrome 调试端口' },
  );

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = new CDP(ws);
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const reload = async () => {
    await cdp.send('Page.navigate', { url: `${BASE}/` });
    await waitFor(() => cdp.eval("document.querySelector('#root') && document.querySelector('#root').children.length > 0"), { label: 'React 渲染' });
    await sleep(900);
  };

  /* ── 场景 1：首页基础渲染 ───────────────────────────── */
  console.log('=== 场景 1：首页基础渲染 ===');
  await reload();
  let st = await cdp.eval(PAGE_STATE);
  check('Hero 区渲染', st.hasHero, `bodyLen=${st.bodyLen}`);
  check('「查询车次」按钮存在且可点', (await cdp.eval(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='查询车次')`)) === true);
  const shotHome = await cdp.screenshot('01-home');

  /* ── 场景 2：车站下拉候选（真实鼠标聚焦） ────────────── */
  console.log('\n=== 场景 2：车站下拉候选 ===');
  const fromBox = await cdp.eval(`(() => { const e = document.querySelector('#home-from'); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, value: e.value }; })()`);
  await cdp.mouseClick(fromBox.x, fromBox.y);
  await sleep(600);
  st = await cdp.eval(PAGE_STATE);
  check('聚焦出发站后下拉展开', st.dropdown.open === true, `初始值=${fromBox.value}`);
  check('下拉候选项充足（≥ 8，可覆盖全部 16 个车站）', st.dropdown.count >= 8, `实际 ${st.dropdown.count} 项：${JSON.stringify(st.dropdown.options)}`);
  const shotDropdown = await cdp.screenshot('02-station-dropdown');

  /* ── 场景 3：下拉展开状态下直接点「查询车次」 ────────── */
  console.log('\n=== 场景 3：下拉展开时点击「查询车次」 ===');
  await reload();
  const box2 = await cdp.eval(`(() => { const e = document.querySelector('#home-from'); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
  await cdp.mouseClick(box2.x, box2.y); // 先让下拉展开
  await sleep(500);
  const btnClick = await cdp.clickSelector('button', { nthText: '查询车次' });
  check('按钮未被下拉遮挡', !btnClick.covered, `命中元素：${btnClick.coveredBy}`);
  check('点击期间按钮无位移（避免 mousedown/mouseup 失配）', btnClick.shifted === 0, `位移 ${btnClick.shifted}px`);

  await sleep(1600);
  st = await cdp.eval(PAGE_STATE);
  check('下拉展开时点击仍能跳转', st.url.startsWith('/trains'), `url=${st.url}`);
  check('车次列表有真实车次', st.trains.length > 0, `识别到：${JSON.stringify(st.trains)}｜${st.emptyHint ? '页面提示无结果' : ''}`);

  /* ── 场景 4：改车站（走下拉选择）后查询 ─────────────── */
  console.log('\n=== 场景 4：通过下拉改选车站后查询 ===');
  await reload();
  const toBox = await cdp.eval(`(() => { const e = document.querySelector('#home-to'); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, value: e.value }; })()`);
  await cdp.mouseClick(toBox.x, toBox.y);
  await sleep(400);
  // 真实用户行为：Ctrl+A 全选后直接输入（覆盖原有站名，而不是追加）
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp.send('Input.insertText', { text: '杭州' });
  await sleep(700);
  const pick = await cdp.eval(`(() => {
    const l = document.getElementById('home-to-listbox');
    if (!l) return { ok: false, reason: '下拉未展开' };
    const opts = [...l.querySelectorAll('[role=option]')];
    if (!opts.length) return { ok: false, reason: '无候选项', text: l.innerText.trim().slice(0, 80) };
    const target = opts.find(o => o.textContent.includes('杭州')) || opts[0];
    const r = target.getBoundingClientRect();
    return { ok: true, x: r.left + r.width/2, y: r.top + r.height/2, text: target.textContent.trim(), count: opts.length };
  })()`);
  check('输入「杭州」后下拉给出候选', pick.ok === true, JSON.stringify(pick));
  if (pick.ok) {
    await cdp.mouseClick(pick.x, pick.y);
    await sleep(400);
    const val = await cdp.eval(`document.querySelector('#home-to').value`);
    check('点击候选后输入框回填车站名', val === '杭州东', `值=${val}`);
  }
  await cdp.clickSelector('button', { nthText: '查询车次' });
  await sleep(1800);
  st = await cdp.eval(PAGE_STATE);
  check('改选车站后查询成功跳转', st.url.startsWith('/trains') && decodeURIComponent(st.url).includes('杭州'), st.url);
  check('新线路能查到车次', st.trains.length > 0, `识别到：${JSON.stringify(st.trains)}`);

  /* ── 场景 4b：输入不存在的车站应给出友好提示而不是静默消失 ── */
  console.log('\n=== 场景 4b：无匹配车站时的提示 ===');
  await reload();
  const toBox2 = await cdp.eval(`(() => { const e = document.querySelector('#home-to'); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
  await cdp.mouseClick(toBox2.x, toBox2.y);
  await sleep(300);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp.send('Input.insertText', { text: '不存在的车站' });
  await sleep(600);
  const noMatch = await cdp.eval(`(() => {
    const l = document.getElementById('home-to-listbox');
    return { open: !!l, text: l ? l.innerText.trim() : '', hasReset: !!(l && [...l.querySelectorAll('button')].some(b => b.textContent.includes('查看全部'))) };
  })()`);
  check('无匹配时下拉仍然展开并给出提示', noMatch.open && noMatch.text.includes('未找到'), JSON.stringify(noMatch).slice(0, 160));
  check('提示中提供「查看全部车站」入口', noMatch.hasReset === true);
  if (noMatch.hasReset) {
    const resetBtn = await cdp.eval(`(() => {
      const l = document.getElementById('home-to-listbox');
      const b = [...l.querySelectorAll('button')].find(x => x.textContent.includes('查看全部'));
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`);
    await cdp.mouseClick(resetBtn.x, resetBtn.y);
    await sleep(600);
    const restored = await cdp.eval(`(() => {
      const l = document.getElementById('home-to-listbox');
      return { open: !!l, options: l ? l.querySelectorAll('[role=option]').length : 0, text: l ? l.innerText.trim().slice(0, 60) : '' };
    })()`);
    check('点击后恢复展示全部车站', restored.options >= 8, `状态=${JSON.stringify(restored)}`);
  }
  // 清空输入并提交，应给出「请填写」提示而不是无反应
  await cdp.clickSelector('button', { nthText: '查询车次' });
  await sleep(800);
  st = await cdp.eval(PAGE_STATE);
  check('站名非法时提交给出可见提示', st.formError.length > 0, `提示=「${st.formError}」 url=${st.url}`);

  /* ── 场景 4c：城市名检索（北京 → 上海，应自动展开为同城全部车站） ── */
  console.log('\n=== 场景 4c：城市名检索 ===');
  await reload();
  const typeInto = async (sel, text) => {
    const box = await cdp.eval(`(() => { const e = document.querySelector('${sel}'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await cdp.mouseClick(box.x, box.y);
    await sleep(200);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text });
    await sleep(400);
  };
  await typeInto('#home-from', '北京');
  await typeInto('#home-to', '上海');
  await cdp.clickSelector('button', { nthText: '查询车次' });
  await sleep(1800);
  st = await cdp.eval(PAGE_STATE);
  check('输入城市名「北京 → 上海」能查到车次', st.url.startsWith('/trains') && st.trains.length > 0, `url=${st.url} 车次=${JSON.stringify(st.trains)}`);
  const cityLabel = await cdp.eval(`document.body.innerText.includes('北京南') && document.body.innerText.includes('上海虹桥')`);
  check('结果页展示同城车站展开结果', cityLabel === true);
  const shotCity = await cdp.screenshot('04-city-search');

  /* ── 场景 5：同一车站应给出提示而不是静默 ───────────── */
  console.log('\n=== 场景 5：出发站 = 到达站（应给出可见提示） ===');
  await reload();
  await cdp.eval(`(() => {
    const setVal = (sel, v) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal('#home-from', '北京南');
    setVal('#home-to', '北京南');
  })()`);
  await sleep(300);
  await cdp.clickSelector('button', { nthText: '查询车次' });
  await sleep(900);
  st = await cdp.eval(PAGE_STATE);
  check('同站查询被拦截且提示可见', st.formError.includes('不能相同'), `提示=「${st.formError}」 url=${st.url}`);

  /* ── 场景 6：热门线路卡片 ───────────────────────────── */
  console.log('\n=== 场景 6：热门线路卡片 ===');
  await reload();
  const hot = await cdp.clickSelector('[data-testid="hot-route"]');
  await sleep(1600);
  st = await cdp.eval(PAGE_STATE);
  check('点击热门线路可跳转查询', st.url.startsWith('/trains'), `url=${st.url}｜卡片=${hot.text ?? ''}`);
  const shotList = await cdp.screenshot('03-train-list');

  /* ── 场景 7：控制台错误 ─────────────────────────────── */
  console.log('\n=== 场景 7：控制台与页面异常 ===');
  const real = errors.filter((e) => e && !/favicon|React DevTools|Download the React/i.test(e));
  check('无控制台错误 / 页面异常', real.length === 0, real.slice(0, 3).join(' | '));

  /* ── 页面画廊 / 报告截图：按角色登录后逐页截图 ──────────── */
  const shotGoto = async (url) => {
    await cdp.send('Page.navigate', { url: `${BASE}${url}` });
    await waitFor(() => cdp.eval("document.querySelector('#root') && document.querySelector('#root').children.length > 0"), { label: '渲染' });
    await sleep(1100);
  };
  const loginAs = async (username, password) => {
    await shotGoto('/login');
    await cdp.eval(`(() => {
      const setVal = (sel, v) => {
        const el = document.querySelector(sel);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = document.querySelectorAll('input');
      setVal('#' + inputs[0].id, ${JSON.stringify(username)});
      setVal('#' + inputs[1].id, ${JSON.stringify(password)});
    })()`);
    await sleep(300);
    await cdp.clickSelector('button', { nthText: '登录' });
    await sleep(1600);
  };

  if (argv.includes('--gallery')) {
    console.log('\n=== 页面画廊 ===');
    const goto = shotGoto;

    // 未登录页面
    await goto('/');
    await cdp.screenshot('gallery-01-home');
    await goto('/trains?from=%E5%8C%97%E4%BA%AC%E5%8D%97&to=%E4%B8%8A%E6%B5%B7%E8%99%B9%E6%A1%A5&date=' + new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10));
    await cdp.screenshot('gallery-02-train-list');
    await goto('/login');
    await cdp.screenshot('gallery-03-login');
    await goto('/register');
    await cdp.screenshot('gallery-04-register');
    await goto('/announcements');
    await cdp.screenshot('gallery-05-announcements');

    // 旅客
    await loginAs('passenger01', 'Pass@123456');
    await goto('/orders');
    await cdp.screenshot('gallery-06-orders');
    await goto('/passengers');
    await cdp.screenshot('gallery-07-passengers');
    await goto('/profile');
    await cdp.screenshot('gallery-08-profile');

    // 管理员
    await loginAs('admin01', 'Admin@123456');
    await goto('/admin');
    await cdp.screenshot('gallery-09-admin-dashboard');
    await goto('/admin/trains');
    await cdp.screenshot('gallery-10-admin-trains');
    await goto('/admin/schedules');
    await cdp.screenshot('gallery-11-admin-schedules');
    await goto('/admin/settings');
    await cdp.screenshot('gallery-12-admin-settings');
    await goto('/clerk');
    await cdp.screenshot('gallery-13-clerk-counter');
    console.log('  已生成 13 张页面截图到 assets/ui/');
  }

  /* ── 报告截图：视口尺寸（不用整页长图），直接写入实验报告截图目录 ── */
  if (argv.includes('--report-shots')) {
    console.log('\n=== 报告截图（视口尺寸 1440×900）===');
    const shotDir = path.join(root, 'report', '实验一-项目选题与结对编程', '截图');
    const trainUrl =
      '/trains?from=%E5%8C%97%E4%BA%AC%E5%8D%97&to=%E4%B8%8A%E6%B5%B7%E8%99%B9%E6%A1%A5&date=' +
      new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10);
    const take = async (name, url, opts = {}) => {
      await shotGoto(url);
      if (opts.before) await opts.before();
      const f = await cdp.screenshot(name, { fullPage: false, dir: shotDir });
      console.log(`  ${path.basename(f)}`);
    };

    // 旅客端（未登录）
    await take('UI原型-01-首页', '/');
    await take('UI原型-02-车次列表', trainUrl);
    await take('UI原型-03-实名注册', '/register');
    await take('UI原型-04-公告列表', '/announcements');
    await take('UI原型-10-车站选择器-全部16站', '/', {
      before: async () => {
        const box = await cdp.eval(`(() => { const e = document.querySelector('#home-from'); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
        await cdp.mouseClick(box.x, box.y);
        await sleep(600);
      },
    });

    // 旅客端（已登录）
    await loginAs('passenger01', 'Pass@123456');
    await take('UI原型-05-我的订单', '/orders');
    await take('UI原型-06-乘车人管理', '/passengers');

    // 管理端
    await loginAs('admin01', 'Admin@123456');
    await take('UI原型-07-管理后台-运营概览', '/admin');
    await take('UI原型-08-管理后台-运行日与库存', '/admin/schedules');
    await take('UI原型-09-售票窗口', '/clerk');
    console.log(`  已生成 10 张报告截图到 ${path.relative(root, shotDir)}`);
  }

  console.log('\n=== 截图 ===');
  [shotHome, shotDropdown, shotCity, shotList].forEach((f) => console.log(`  ${path.relative(root, f)}`));
  console.log(`\n================ 结果 ================`);
  console.log(`  通过 ${pass} 项，失败 ${failures.length} 项`);
  failures.forEach((f) => console.log(`    - ${f}`));

  ws.close();
  child.kill();
  await sleep(500);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('UI 检查异常：', e.message);
  process.exit(1);
});
