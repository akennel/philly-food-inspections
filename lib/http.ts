/** Small polite HTTP client: concurrency cap, spacing between requests, timeouts, validated retries. */
export interface HttpOptions {
  concurrency?: number;
  /** Minimum gap between request starts, in ms */
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

export class HttpClient {
  private active = 0;
  private waiting: (() => void)[] = [];
  private lastStart = 0;
  readonly opts: Required<HttpOptions>;
  requests = 0;

  constructor(opts: HttpOptions = {}) {
    this.opts = {
      concurrency: opts.concurrency ?? 3,
      minIntervalMs: opts.minIntervalMs ?? 250,
      timeoutMs: opts.timeoutMs ?? 20_000,
      retries: opts.retries ?? 3,
      userAgent: opts.userAgent ?? 'PhillyFoodInspectionsMap/1.0',
    };
  }

  private async acquire() {
    if (this.active >= this.opts.concurrency) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    const wait = this.lastStart + this.opts.minIntervalMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.opts.minIntervalMs);
    if (wait > 0) await sleep(wait);
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }

  /** GET (or POST with init) returning text; retries when the response fails `validate`. */
  async text(url: string, validate?: (body: string) => boolean, init: RequestInit = {}): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      await this.acquire();
      try {
        this.requests++;
        const res = await fetch(url, {
          ...init,
          headers: { 'User-Agent': this.opts.userAgent, ...(init.headers ?? {}) },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        if (validate && !validate(body)) throw new Error(`Unexpected response for ${url}`);
        return body;
      } catch (e) {
        lastErr = e;
      } finally {
        this.release();
      }
    }
    throw lastErr;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over items with a concurrency cap; collects results and errors. Stops starting new work after `deadline`. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  deadline?: number,
): Promise<{ results: R[]; errors: { item: T; error: unknown }[]; skipped: T[] }> {
  const results: R[] = [];
  const errors: { item: T; error: unknown }[] = [];
  const skipped: T[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      if (deadline && Date.now() > deadline) {
        skipped.push(item);
        continue;
      }
      try {
        results.push(await fn(item));
      } catch (error) {
        errors.push({ item, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { results, errors, skipped };
}
