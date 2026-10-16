import { useEffect, useState } from 'react';
import type { AppData } from '../types';

const KEY = 'contest-prep:v1';

export const EMPTY: AppData = { profile: null, logs: [], body: [], myFoods: [] };

/** 保存データやバックアップを読み込む（壊れた項目は空にする） */
export function normalizeData(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  return {
    profile: d.profile ?? null,
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

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // ストレージが使えない環境（プライベートモード等）ではメモリ上だけで動かす
    }
  }, [data]);
  return [data, setData] as const;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
