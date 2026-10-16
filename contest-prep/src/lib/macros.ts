import type { Macros } from '../types';

/** たんぱく質・炭水化物 4kcal/g、脂質 9kcal/g */
export function kcalOf(m: Macros): number {
  return Math.round(m.p * 4 + m.f * 9 + m.c * 4);
}

export function sumMacros(list: Macros[]): Macros {
  const t = list.reduce((s, m) => ({ p: s.p + m.p, f: s.f + m.f, c: s.c + m.c }), { p: 0, f: 0, c: 0 });
  const r = (v: number) => Math.round(v * 10) / 10;
  return { p: r(t.p), f: r(t.f), c: r(t.c) };
}

/** base 量あたりの PFC を amount 量に換算 */
export function scaleMacros(m: Macros, base: number, amount: number): Macros {
  const r = (v: number) => Math.round((v * amount * 10) / base) / 10;
  return { p: r(m.p), f: r(m.f), c: r(m.c) };
}
