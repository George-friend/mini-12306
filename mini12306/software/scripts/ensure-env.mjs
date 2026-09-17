/**
 * 初始化辅助脚本：若 apps/api/.env 不存在，则从 .env.example 复制一份。
 * 这样 .env（含本地演示密钥）可以不进版本库，而 setup 仍能一步跑通。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'apps', 'api', '.env');
const example = path.join(root, 'apps', 'api', '.env.example');

if (fs.existsSync(target)) {
  console.log('[env] apps/api/.env 已存在，跳过');
} else if (fs.existsSync(example)) {
  fs.copyFileSync(example, target);
  console.log('[env] 已从 .env.example 生成 apps/api/.env');
} else {
  console.error('[env] 未找到 apps/api/.env.example，请手动创建 apps/api/.env');
  process.exit(1);
}
