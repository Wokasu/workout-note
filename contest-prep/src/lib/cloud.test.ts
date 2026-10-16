import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { CloudSync, canon, fromDocs, toDocs, type Db, type QuerySnap, type SyncStatus } from './cloud';

/** メモリ上の db。購読者には書き込みの後に非同期で通知する */
class FakeDb implements Db {
  docs = new Map<string, Record<string, unknown>>();
  writes: string[] = [];
  listeners = new Map<string, ((s: QuerySnap) => void)[]>();
  failNext: string | null = null;

  snap(collection: string): QuerySnap {
    return {
      docs: [...this.docs]
        .filter(([p]) => p.split('/')[0] === collection)
        // 保存領域はキーの順番を変えて返すことがある
        .map(([p, body]) => ({ id: p.split('/')[1], exists: true, data: () => Object.fromEntries(Object.entries(body).reverse()) })),
    };
  }
  notify(collection: string) {
    setTimeout(() => this.listeners.get(collection)?.forEach((fn) => fn(this.snap(collection))), 0);
  }
  /** 別の端末からの書き込み */
  remoteSet(path: string, body: Record<string, unknown>) {
    this.docs.set(path, body);
    this.notify(path.split('/')[0]);
  }
  doc(path: string) {
    return {
      set: async (data: Record<string, unknown>) => {
        if (this.failNext) {
          const code = this.failNext;
          this.failNext = null;
          throw { code, message: code };
        }
        this.writes.push(`set ${path}`);
        this.docs.set(path, JSON.parse(JSON.stringify(data)));
        this.notify(path.split('/')[0]);
      },
      delete: async () => {
        this.writes.push(`delete ${path}`);
        this.docs.delete(path);
        this.notify(path.split('/')[0]);
      },
    };
  }
  collection(path: string) {
    return {
      get: async () => this.snap(path),
      onSnapshot: (next: (s: QuerySnap) => void) => {
        const list = this.listeners.get(path) ?? [];
        list.push(next);
        this.listeners.set(path, list);
        this.notify(path);
        return () => this.listeners.set(path, (this.listeners.get(path) ?? []).filter((f) => f !== next));
      },
    };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5));

const sample: AppData = {
  profile: null,
  myFoods: [{ id: 'f1', name: 'チキン', base: 100, unit: 'g', p: 23, f: 2, c: 0 }],
  logs: [
    { id: 'a', date: '2026-09-30', slot: 1, name: '米', amount: '200g', p: 5, f: 0.6, c: 74 },
    { id: 'b', date: '2026-10-01', slot: 1, name: '卵', amount: '1個', p: 6, f: 5, c: 0.2 },
  ],
  body: [
    { date: '2026-10-01', weightKg: 80 },
    { date: '2025-12-31', weightKg: 82, waistCm: 85 },
  ],
};

function setup(db: FakeDb) {
  const received: AppData[] = [];
  const statuses: SyncStatus[] = [];
  const sync = new CloudSync(db, (d) => received.push(d), (s) => statuses.push(s));
  return { sync, received, statuses };
}

describe('docs', () => {
  it('splits by month and year and round-trips', () => {
    const docs = toDocs(sample);
    expect([...docs.keys()].sort()).toEqual(['body/2025', 'body/2026', 'logs/2026-09', 'logs/2026-10', 'prep/foods', 'prep/profile']);
    const back = fromDocs(docs);
    expect(back.body.map((r) => r.date)).toEqual(['2025-12-31', '2026-10-01']);
    expect(toDocs(back)).toEqual(docs);
  });

  it('compares regardless of key order', () => {
    expect(canon({ b: 1, a: [{ y: 2, x: undefined }] })).toBe(canon({ a: [{ y: 2 }], b: 1 }));
  });
});

describe('CloudSync', () => {
  it('moves local data into an empty store', async () => {
    const db = new FakeDb();
    const { sync } = setup(db);
    expect(await sync.start(sample)).toBe(true);
    await tick();
    expect(db.docs.size).toBe(6);
    expect(fromDocs(new Map([...db.docs].map(([p, b]) => [p, canon(b)]))).logs).toHaveLength(2);
  });

  it('prefers the store when it already has data, without writing back', async () => {
    const db = new FakeDb();
    for (const [p, body] of toDocs(sample)) db.docs.set(p, JSON.parse(body));
    const { sync, received } = setup(db);
    expect(await sync.start({ profile: null, myFoods: [], logs: [], body: [] })).toBe(false);
    await tick();
    expect(received[0].logs).toHaveLength(2);
    // 受け取ったデータをそのまま戻しても書き込みは起きない（キー順の違いも無視）
    sync.push(received[0]);
    await tick();
    expect(db.writes).toEqual([]);
  });

  it('writes only changed documents and deletes emptied ones', async () => {
    const db = new FakeDb();
    const { sync } = setup(db);
    await sync.start(sample);
    await tick();
    db.writes = [];
    sync.push({ ...sample, logs: sample.logs.slice(1) });
    await tick();
    expect(db.writes).toEqual(['delete logs/2026-09']);
  });

  it('applies changes from another device', async () => {
    const db = new FakeDb();
    const { sync, received } = setup(db);
    await sync.start(sample);
    await tick();
    received.length = 0;
    db.remoteSet('body/2026', { items: [{ date: '2026-10-01', weightKg: 79.5 }] });
    await tick();
    expect(received.at(-1)?.body.find((r) => r.date === '2026-10-01')?.weightKg).toBe(79.5);
  });

  it('keeps the newest local edit when edits overlap', async () => {
    const db = new FakeDb();
    const { sync } = setup(db);
    await sync.start(sample);
    await tick();
    const log = { id: 'c', date: '2026-10-02', slot: 2, name: 'パン', amount: '', p: 5, f: 2, c: 28 };
    sync.push({ ...sample, logs: [...sample.logs, log] });
    sync.push({ ...sample, logs: [...sample.logs, log, { ...log, id: 'd' }] });
    await tick();
    const stored = db.docs.get('logs/2026-10')!.items as { id: string }[];
    expect(stored.map((l) => l.id)).toEqual(['b', 'c', 'd']);
  });

  it('reports a failed write and can retry it', async () => {
    const db = new FakeDb();
    const { sync, statuses } = setup(db);
    await sync.start(sample);
    await tick();
    db.failNext = 'quota_exceeded';
    sync.push({ ...sample, myFoods: [] });
    await tick();
    expect(statuses.at(-1)).toBe('error');
    expect((db.docs.get('prep/foods')!.items as unknown[]).length).toBe(1);
    sync.retry();
    await tick();
    expect(statuses.at(-1)).toBe('synced');
    expect((db.docs.get('prep/foods')!.items as unknown[]).length).toBe(0);
  });
});
