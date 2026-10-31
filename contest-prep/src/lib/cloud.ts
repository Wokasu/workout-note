import type { AppData, BodyRecord, Food, FoodLog, MealSet, Profile } from '../types';

/**
 * claude.ai の公開ページで動いているときに使える保存領域（db）との同期。
 * 公開ページ以外（開発サーバーや GitHub Pages）では使えないので、ブラウザ内だけで動く。
 *
 * 保存のしかた（所有者だけが読み書きできるルールで公開する）：
 *   prep/profile   { profile }
 *   prep/foods     { items: Food[], sets: MealSet[] }  マイ食品といつものセット
 *   logs/YYYY-MM   { items: FoodLog[] }   1か月分の食事
 *   body/YYYY      { items: BodyRecord[] } 1年分の身体データ
 */

export interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface QuerySnap {
  docs: DocSnap[];
}
export interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
export interface CollRef {
  get(): Promise<QuerySnap>;
  onSnapshot(next: (snap: QuerySnap) => void, error?: (e: { code: string; message: string }) => void): () => void;
}
export interface Db {
  doc(path: string): DocRef;
  collection(path: string): CollRef;
}

/** window.claude.use(name)。公開ページの外では null */
export async function getCapability<T>(name: string): Promise<T | null> {
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!claude?.use) return null;
  try {
    return ((await claude.use(name)) as T | null) ?? null;
  } catch {
    return null;
  }
}

export const COLLECTIONS = ['prep', 'logs', 'body'] as const;

/** キーの順番によらず同じ内容なら同じ文字列にする */
export function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** アプリのデータを保存用のドキュメント（パス → 内容の文字列）に分ける */
export function toDocs(data: AppData): Map<string, string> {
  const docs = new Map<string, string>();
  docs.set('prep/profile', canon({ profile: data.profile }));
  docs.set('prep/foods', canon({ items: data.myFoods, sets: data.mealSets }));
  for (const [month, items] of group(data.logs, (l) => l.date.slice(0, 7))) docs.set(`logs/${month}`, canon({ items }));
  const body = [...data.body].sort((a, b) => a.date.localeCompare(b.date));
  for (const [year, items] of group(body, (r) => r.date.slice(0, 4))) docs.set(`body/${year}`, canon({ items }));
  return docs;
}

export function fromDocs(docs: Map<string, string>): AppData {
  const parse = (path: string) => (docs.has(path) ? (JSON.parse(docs.get(path)!) as Record<string, unknown>) : undefined);
  const itemsOf = <T>(prefix: string) =>
    [...docs.keys()]
      .filter((p) => p.startsWith(prefix))
      .sort()
      .flatMap((p) => ((parse(p)?.items as T[] | undefined) ?? []));
  return {
    profile: (parse('prep/profile')?.profile as Profile | null | undefined) ?? null,
    myFoods: (parse('prep/foods')?.items as Food[] | undefined) ?? [],
    mealSets: (parse('prep/foods')?.sets as MealSet[] | undefined) ?? [],
    logs: itemsOf<FoodLog>('logs/'),
    body: itemsOf<BodyRecord>('body/'),
  };
}

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'error';

/**
 * 端末のデータと保存領域をそろえる。
 * - 最初に保存領域を読み、空ならこの端末のデータを移す。データがあれば保存領域を正とする。
 * - 変更はドキュメント単位で、1つのドキュメントにつき1度に1件ずつ書く。
 * - 別の端末での変更は購読して取り込む。
 */
export class CloudSync {
  /** 端末側の今の状態 */
  private local = new Map<string, string>();
  /** 次に書く内容（null は削除） */
  private pending = new Map<string, string | null>();
  private inflight = new Set<string>();
  /** 書き込みに失敗したドキュメント */
  private failed = new Set<string>();
  private known = new Map<string, Set<string>>();
  private unsubs: (() => void)[] = [];
  private stopped = false;
  private errorMessage = '';

  constructor(
    private db: Db,
    private onData: (data: AppData) => void,
    private onStatus: (status: SyncStatus, message?: string) => void,
  ) {}

  /** 保存領域を読み込んで同期を始める。この端末のデータを移したら true */
  async start(localData: AppData): Promise<boolean> {
    this.onStatus('connecting');
    const server = new Map<string, string>();
    try {
      const snaps = await Promise.all(COLLECTIONS.map((c) => this.db.collection(c).get()));
      snaps.forEach((snap, i) => {
        const paths = new Set<string>();
        for (const d of snap.docs) {
          if (!d.exists) continue;
          const path = `${COLLECTIONS[i]}/${d.id}`;
          server.set(path, canon(d.data()));
          paths.add(path);
        }
        this.known.set(COLLECTIONS[i], paths);
      });
    } catch (e) {
      this.fail(e);
      return false;
    }
    if (this.stopped) return false;

    const migrate = server.size === 0;
    if (migrate) {
      this.push(localData);
    } else {
      this.local = server;
      this.onData(fromDocs(server));
    }

    for (const c of COLLECTIONS) {
      this.unsubs.push(
        this.db.collection(c).onSnapshot(
          (snap) => this.onRemote(c, snap),
          (e) => this.fail(e),
        ),
      );
    }
    this.updateStatus();
    return migrate;
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** 端末側でデータが変わったら呼ぶ。変わったドキュメントだけ書く */
  push(data: AppData): void {
    if (this.stopped) return;
    const next = toDocs(data);
    for (const path of new Set([...next.keys(), ...this.local.keys()])) {
      const body = next.get(path) ?? null;
      if (body !== (this.local.get(path) ?? null)) this.schedule(path, body);
    }
    this.local = next;
  }

  /** 失敗した書き込みをやり直す */
  retry(): void {
    const paths = [...this.failed];
    this.failed.clear();
    this.errorMessage = '';
    for (const p of paths) this.schedule(p, this.local.get(p) ?? null);
    this.updateStatus();
  }

  private schedule(path: string, body: string | null): void {
    this.pending.set(path, body);
    void this.flush(path);
  }

  private async flush(path: string): Promise<void> {
    if (this.inflight.has(path) || !this.pending.has(path) || this.stopped) return;
    const body = this.pending.get(path)!;
    this.pending.delete(path);
    this.inflight.add(path);
    this.updateStatus();
    try {
      await this.write(path, body);
      this.failed.delete(path);
    } catch (e) {
      this.failed.add(path);
      this.fail(e);
    } finally {
      this.inflight.delete(path);
    }
    if (this.pending.has(path)) await this.flush(path);
    else this.updateStatus();
  }

  private async write(path: string, body: string | null, retried = false): Promise<void> {
    const ref = this.db.doc(path);
    try {
      if (body === null) await ref.delete();
      else await ref.set(JSON.parse(body) as Record<string, unknown>);
    } catch (e) {
      // 一時的な不調は少し待って1回だけやり直す
      if (!retried && (e as { code?: string })?.code === 'unavailable') {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
        return this.write(path, body, true);
      }
      throw e;
    }
  }

  private onRemote(collection: string, snap: QuerySnap): void {
    if (this.stopped) return;
    const seen = new Set<string>();
    let changed = false;
    for (const d of snap.docs) {
      if (!d.exists) continue;
      const path = `${collection}/${d.id}`;
      seen.add(path);
      changed = this.applyRemote(path, canon(d.data())) || changed;
    }
    for (const path of this.known.get(collection) ?? []) {
      if (!seen.has(path)) changed = this.applyRemote(path, null) || changed;
    }
    this.known.set(collection, seen);
    if (changed) this.onData(fromDocs(this.local));
  }

  private applyRemote(path: string, body: string | null): boolean {
    // この端末から書いている途中のドキュメントは、端末側を正とする
    if (this.pending.has(path) || this.inflight.has(path) || this.failed.has(path)) return false;
    if ((this.local.get(path) ?? null) === body) return false;
    if (body === null) this.local.delete(path);
    else this.local.set(path, body);
    return true;
  }

  private fail(e: unknown): void {
    const err = e as { code?: string; message?: string };
    this.errorMessage =
      err?.code === 'quota_exceeded'
        ? '保存領域の上限に達しました。古い記録を消すと保存できるようになります。'
        : err?.code === 'revoked' || err?.code === 'not_granted'
          ? '保存領域に接続できなくなりました。ページを開き直してください。'
          : `保存できませんでした（${err?.code ?? 'error'}）。`;
    this.updateStatus();
  }

  private updateStatus(): void {
    if (this.errorMessage) this.onStatus('error', this.errorMessage);
    else if (this.inflight.size > 0 || this.pending.size > 0) this.onStatus('saving');
    else this.onStatus('synced');
  }
}
