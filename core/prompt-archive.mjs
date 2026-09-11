import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Archive text only, never credentials or reference media payloads.
export async function savePromptRecord(dir, name, record, secrets = []) {
  if (!/^(storyboard|batch-\d+-prompt)\.json$/.test(name)) throw new Error('提示词文件名无效');
  const scrub = value => {
    if (typeof value === 'string') {
      for (const secret of secrets || []) if (secret) value = value.split(secret).join('[已隐藏 Key]');
      return value;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  await fs.mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `.${name}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(scrub(record), null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, path.join(dir, name));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readPromptArchive(dir) {
  let storyboard;
  try { storyboard = JSON.parse(await fs.readFile(path.join(dir, 'storyboard.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const names = (await fs.readdir(dir)).filter(name => /^batch-\d+-prompt\.json$/.test(name)).sort();
  const batches = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))));
  return { storyboard, batches };
}
