/**
 * 生成报告用的占位图片（工作照片等）。
 * 做法：写一个 HTML 占位页 → 用 Chrome/Edge 无头模式截图 → 输出 PNG。
 * 这样占位图带文字说明，替换时覆盖同名文件即可。
 *
 * 用法：node scripts/make-placeholders.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'report', '实验一-项目选题与结对编程', '截图');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('未找到 Chrome / Edge，无法生成占位图');
  process.exit(1);
}

const targets = [
  { file: '工作照片-占位-01.png', title: '结对编程工作照（全景）', hint: '请替换为本组实测照片：两人同桌、屏幕可见、拍到键盘操作方与审查方' },
  { file: '工作照片-占位-02.png', title: '结对编程工作照（屏幕特写）', hint: '请替换为本组实测照片：屏幕上的设计图 / 文档 / 代码界面' },
];

const html = (title, hint) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:600px;display:flex;align-items:center;justify-content:center;
       font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;background:#f8fafc}
  .box{width:1080px;height:480px;border:3px dashed #94a3b8;border-radius:20px;
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
       background:repeating-linear-gradient(45deg,#f1f5f9 0 18px,#f8fafc 18px 36px)}
  .badge{background:#e2e8f0;color:#475569;font-size:15px;padding:6px 16px;border-radius:999px;letter-spacing:.1em}
  h1{font-size:34px;color:#334155;font-weight:600}
  p{font-size:16px;color:#64748b;max-width:760px;text-align:center;line-height:1.7}
</style></head><body>
  <div class="box">
    <span class="badge">图片占位 PLACEHOLDER</span>
    <h1>${title}</h1>
    <p>${hint}</p>
    <p style="color:#94a3b8;font-size:14px">替换方式：把真实照片保存为同名文件覆盖本目录下的该图片即可</p>
  </div>
</body></html>`;

const tmp = path.join(os.tmpdir(), 'mini12306-placeholder.html');

for (const t of targets) {
  fs.writeFileSync(tmp, html(t.title, t.hint), 'utf8');
  const out = path.join(outDir, t.file);
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--window-size=1200,600',
      `--screenshot=${out}`,
      `file:///${tmp.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore', timeout: 60000 },
  );
  if (fs.existsSync(out)) {
    console.log(`✅ ${t.file}  ${Math.round(fs.statSync(out).size / 1024)} KB`);
  } else {
    console.error(`❌ ${t.file} 生成失败（exit=${r.status}）`);
  }
}

fs.rmSync(tmp, { force: true });
