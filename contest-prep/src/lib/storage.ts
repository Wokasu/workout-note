import { useEffect, useRef, useState } from 'react';
import type { AppData, Profile } from '../types';
import { CloudSync, getCapability, type Db, type SyncStatus } from './cloud';

const KEY = 'contest-prep:v1';

export const EMPTY: AppData = { profile: null, logs: [], body: [], myFoods: [] };

/** 後から増えた設定項目の初期値（古い保存データを読むときに補う） */
const PROFILE_DEFAULTS: Pick<Profile, 'bodyFatSource'> = {
  bodyFatSource: 'auto',
};

/** 以前の版にあった設定項目（目標を体脂肪率で決めるモード）を取り除く */
function withoutRemoved(p: Profile & { targetMode?: unknown; targetBodyFatPct?: unknown }): Profile {
  const { targetMode: _mode, targetBodyFatPct: _bf, ...rest } = p;
  return rest;
}

/** 保存データやバックアップを読み込む（壊れた項目は空にする） */
export function normalizeData(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  return {
    profile: d.profile ? withoutRemoved({ ...PROFILE_DEFAULTS, ...d.profile }) : null,
    logs: Array.isArray(d.logs) ? d.logs : [],
    body: Array.isArray(d.body) ? d.body : [],
    myFoods: Array.isArray(d.myFoods) ? d.myFoods : [],
  };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeData(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export interface SyncState {
  status: SyncStatus;
  message?: string;
  /** この端末にあったデータを保存領域へ移した */
  migrated?: boolean;
  retry?: () => void;
}

/**
 * アプリのデータ。ブラウザにも控えを置き（すぐ表示するため）、
 * claude.ai の公開ページでは保存領域と同期する。
 */
export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  const [sync, setSync] = useState<SyncState>({ status: 'local' });
  const engine = useRef<CloudSync | null>(null);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // ストレージが使えない環境（プライベートモード等）ではメモリ上だけで動かす
    }
    engine.current?.push(data);
  }, [data]);

  useEffect(() => {
    let active = true;
    let cloud: CloudSync | null = null;
    void (async () => {
      const db = await getCapability<Db>('db');
      if (!db || !active) return;
      cloud = new CloudSync(
        db,
        (d) => setData(normalizeData(d)),
        (status, message) => setSync((s) => ({ ...s, status, message })),
      );
      const migrated = await cloud.start(latest.current);
      if (!active) {
        cloud.stop();
        return;
      }
      engine.current = cloud;
      // 読み込み中にこの端末で記録したぶんも移す（保存領域が空だったときだけ）
      if (migrated) cloud.push(latest.current);
      setSync((s) => ({ ...s, migrated, retry: () => cloud?.retry() }));
    })();
    return () => {
      active = false;
      cloud?.stop();
      engine.current = null;
    };
  }, []);

  return [data, setData, sync] as const;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
