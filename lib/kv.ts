import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/** Minimal JSON key-value store so the same crawl code runs against Netlify Blobs or a local folder. */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export const KEYS = {
  facility: (id: string) => `facility/${id}`,
  day: (date: string) => `day/${date}`,
  index: 'index',
};

/** Stores each key as <dir>/<key>.json */
export class FsKV implements KV {
  constructor(readonly dir: string) {}
  private path(key: string) {
    return join(this.dir, `${key}.json`);
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.path(key), 'utf8')) as T;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  }
  async set(key: string, value: unknown) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(value));
  }
  async list(prefix: string): Promise<string[]> {
    const root = join(this.dir, prefix);
    const out: string[] = [];
    const walk = async (d: string) => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch (e: any) {
        if (e?.code === 'ENOENT') return;
        throw e;
      }
      for (const e of entries) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith('.json')) out.push(relative(this.dir, p).slice(0, -5).split('\\').join('/'));
      }
    };
    await walk(root);
    return out;
  }
}
