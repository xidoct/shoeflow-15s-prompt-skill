import { references } from './core/references.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { LlmStoryboardProvider } from './core/llm-provider.mjs';
import * as prompts from './core/storyboard-prompts.mjs';
import { compile } from './core/compile.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const tasks = path.join(root, 'tasks');
await fs.mkdir(tasks, { recursive: true });
const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > 32 * 1024 * 1024) throw new Error('参考图与文案合计超过32MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      const files = (await fs.readdir(tasks)).filter(name => /^[a-f0-9-]+\.json$/.test(name));
      const list = [];
      for (const name of files) { try { const task = JSON.parse(await fs.readFile(path.join(tasks, name), 'utf8')); list.push({ id: task.id, createdAt: task.createdAt, title: task.script.slice(0, 45), count: task.batches.length }); } catch {} }
      return send(res, 200, list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && match) return send(res, 200, JSON.parse(await fs.readFile(path.join(tasks, match[1] + '.json'), 'utf8')));
    if (req.method === 'POST' && ['/api/generate', '/api/compile'].includes(url.pathname)) {
      const input = await body(req);
      if (!String(input.script || '').trim()) throw new Error('请输入口播文案');
      const media = references(input.references);
      const hasMedia = media.products.length > 0 || Boolean(media.avatar);
      const options = hasMedia ? { ...input.options, productCount: media.products.length, avatar: Boolean(media.avatar) } : input.options;
      let board = input.board;
      if (url.pathname === '/api/generate') {
        const contract = '每次生成上限固定为15秒，每个分镜为2至15秒整数。按自然口播估时，长对白拆分；不要凑满15秒，不遗漏或改写文案。';
        board = await new LlmStoryboardProvider(input.llm).createStoryboard(input.script, [...Object.values(prompts), contract].join('\n\n'), media);
      }
      const result = compile(board, options);
      const task = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), script: input.script, options, references: media, ...result };
      // Never persist LLM configuration or credentials.
      const file = path.join(tasks, task.id + '.json');
      await fs.writeFile(file + '.tmp', JSON.stringify(task, null, 2), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
      return send(res, 200, task);
    }
    const file = ({ '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' })[url.pathname];
    if (req.method !== 'GET' || !file) return send(res, 404, { error: '未找到' });
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(await fs.readFile(path.join(root, 'web', file)));
  } catch (error) { send(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 4174), '127.0.0.1', () => console.log('ShoeFlow 提示词工作台：http://127.0.0.1:' + (process.env.PORT || 4174)));
