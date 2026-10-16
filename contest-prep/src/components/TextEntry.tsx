import { useEffect, useRef, useState } from 'react';
import type { Food, Macros } from '../types';
import { buildPrompt, itemsFromReply, parseLocally, type ParsedItem } from '../lib/mealText';
import { getCapability } from '../lib/cloud';
import { kcalOf, scaleMacros } from '../lib/macros';

type SampleJson = (input: string, options?: { modelTier?: 'quick' | 'default'; signal?: AbortSignal }) => Promise<unknown>;
type SampleFn = { json: SampleJson };

interface Row extends ParsedItem {
  checked: boolean;
  save: boolean;
  /** 判定したときの量と PFC（重さを変えたときの換算元） */
  origin: { grams: number | null } & Macros;
}

interface Props {
  myFoods: Food[];
  onAdd: (items: { name: string; amount: string; p: number; f: number; c: number }[]) => void;
  onAddFood: (food: Omit<Food, 'id'>) => void;
}

function toRows(items: ParsedItem[]): Row[] {
  return items.map((i) => ({ ...i, checked: true, save: false, origin: { grams: i.grams, p: i.p, f: i.f, c: i.c } }));
}

const ERROR_COPY: Record<string, string> = {
  rate_limited: 'Claude の利用が混み合っているか上限に近いため、少し時間をおいて試してください。',
  session_expired: 'claude.ai にもう一度ログインしてから試してください。',
  invalid_json: 'うまく読み取れませんでした。書き方を変えてもう一度試してください。',
  empty_completion: 'うまく読み取れませんでした。書き方を変えてもう一度試してください。',
  refused: 'この内容は推定できませんでした。書き方を変えてみてください。',
};
const UNAVAILABLE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

/** 「鶏胸肉一枚」「なか卯、親子丼 大盛り」のような文章から食事を記録する */
export function TextEntry({ myFoods, onAdd, onAddFood }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<'local' | 'quick' | 'default' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sample, setSample] = useState<SampleFn | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    // sample 自体が関数なので、setState に渡すときは関数で包む（そのまま渡すと更新関数として呼ばれる）
    void getCapability<SampleFn>('sample').then((s) => active && setSample(() => s));
    return () => {
      active = false;
      ctl.current?.abort();
    };
  }, []);

  const askClaude = async (tier: 'quick' | 'default') => {
    if (!sample) return;
    ctl.current?.abort();
    const controller = new AbortController();
    ctl.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const items = itemsFromReply(await sample.json(buildPrompt(text, myFoods), { modelTier: tier, signal: controller.signal }));
      if (items.length === 0) setMessage(ERROR_COPY.invalid_json);
      else {
        setRows(toRows(items));
        setSource(tier);
      }
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'upstream_error';
      if (code === 'cancelled') return;
      if (UNAVAILABLE.includes(code)) {
        setSample(null);
        setMessage('Claude に問い合わせられないため、登録済みの食品だけ判定できます。「PFC を直接入力」も使えます。');
      } else {
        setMessage(ERROR_COPY[code] ?? '通信がうまくいきませんでした。もう一度試してください。');
      }
    } finally {
      if (ctl.current === controller) setBusy(false);
    }
  };

  const judge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setMessage('');
    const local = parseLocally(text, myFoods);
    if (local) {
      setRows(toRows(local));
      setSource('local');
    } else if (sample) {
      void askClaude('quick');
    } else {
      setRows(null);
      setMessage('登録にない食品が含まれています。claude.ai のページで開くと Claude が推定します。ここでは「PFC を直接入力」を使ってください。');
    }
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const changeGrams = (i: number, value: string) => {
    const row = rows![i];
    const g = Number(value);
    if (!(g > 0) || row.origin.grams === null) return update(i, { amount: value ? `${value}g` : '' });
    update(i, { grams: g, amount: `${g}g`, ...scaleMacros(row.origin, row.origin.grams, g) });
  };

  const changeMacro = (i: number, key: 'p' | 'f' | 'c', value: string) => {
    const v = Number(value);
    update(i, { [key]: Number.isFinite(v) && v >= 0 ? v : 0 });
  };

  const addAll = () => {
    if (!rows) return;
    const chosen = rows.filter((r) => r.checked);
    onAdd(chosen.map(({ name, amount, p, f, c }) => ({ name, amount, p, f, c })));
    for (const r of chosen.filter((x) => x.save)) {
      if (r.grams) onAddFood({ name: r.name, base: r.grams, unit: 'g', p: r.p, f: r.f, c: r.c });
      else {
        const m = r.amount.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
        onAddFood({ name: r.name, base: m ? Number(m[1]) : 1, unit: m ? m[2] : '食', p: r.p, f: r.f, c: r.c });
      }
    }
    setMessage(`${chosen.length}品を追加しました`);
    setRows(null);
    setText('');
  };

  const chosen = rows?.filter((r) => r.checked) ?? [];
  const total = chosen.reduce((s, r) => ({ p: s.p + r.p, f: s.f + r.f, c: s.c + r.c }), { p: 0, f: 0, c: 0 });

  return (
    <div className="form text-entry">
      <form className="form" onSubmit={judge}>
        <textarea
          id="meal-text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'例：鶏胸肉一枚、ご飯大盛り\n例：なか卯、親子丼 大盛り'}
        />
        <div className="row">
          <button type="submit" className="primary grow" disabled={!text.trim() || busy}>
            {busy ? 'Claude が推定しています…' : '判定する'}
          </button>
          {busy && (
            <button type="button" className="ghost" onClick={() => ctl.current?.abort()}>
              やめる
            </button>
          )}
        </div>
      </form>
      {message && <p className={`status ${message.includes('追加しました') ? 'ok' : 'warn'}`}>{message}</p>}

      {rows && (
        <div className="parsed">
          <div className="parsed-source muted">
            {source === 'local' ? '登録済みの食品から判定しました' : 'Claude の推定です。公表値と違うことがあるので確かめてから追加してください'}
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`parsed-item ${r.checked ? '' : 'off'}`}>
              <div className="parsed-top">
                <input type="checkbox" checked={r.checked} onChange={(e) => update(i, { checked: e.target.checked })} aria-label={`${r.name}を追加する`} />
                <input className="grow" value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="食品名" />
                <span className="num">{kcalOf(r)} kcal</span>
              </div>
              <div className="parsed-macros">
                <label>
                  量{r.origin.grams !== null ? ' (g)' : ''}
                  {r.origin.grams !== null ? (
                    <input type="number" inputMode="decimal" value={r.grams ?? ''} onChange={(e) => changeGrams(i, e.target.value)} />
                  ) : (
                    <input value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} />
                  )}
                </label>
                {(['p', 'f', 'c'] as const).map((k) => (
                  <label key={k}>
                    {k.toUpperCase()}
                    <input type="number" inputMode="decimal" value={r[k]} onChange={(e) => changeMacro(i, k, e.target.value)} />
                  </label>
                ))}
              </div>
              {r.note && <div className="muted parsed-note">{r.note}</div>}
              {r.source === 'claude' && (
                <label className="check small">
                  <input type="checkbox" checked={r.save} onChange={(e) => update(i, { save: e.target.checked })} />
                  マイ食品に保存（次からすぐ判定）
                </label>
              )}
            </div>
          ))}
          <button className="primary wide" onClick={addAll} disabled={chosen.length === 0}>
            {chosen.length}品を追加（{kcalOf(total)} kcal）
          </button>
          {sample && source !== 'default' && (
            <button className="ghost wide" onClick={() => void askClaude(source === 'local' ? 'quick' : 'default')} disabled={busy}>
              {source === 'local' ? 'Claude に推定してもらう' : '詳しく推定し直す（遅め）'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
