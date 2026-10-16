import { useEffect, useState } from 'react';
import type { AppData } from '../types';

const KEY = 'oshi-diet:v1';

const EMPTY: AppData = { profile: null, meals: [], weights: [] };

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      profile: parsed.profile ?? null,
      meals: Array.isArray(parsed.meals) ? parsed.meals : [],
      weights: Array.isArray(parsed.weights) ? parsed.weights : [],
    };
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
