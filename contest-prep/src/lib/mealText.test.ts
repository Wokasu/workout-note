import { describe, expect, it } from 'vitest';
import type { Food } from '../types';
import { buildPrompt, itemsFromReply, normalize, parseLocally } from './mealText';

const one = (text: string, myFoods: Food[] = []) => {
  const items = parseLocally(text, myFoods);
  return items && items.length === 1 ? items[0] : items;
};

describe('parseLocally', () => {
  it('reads a chicken breast as 300g skinless', () => {
    expect(one('鶏胸肉一枚')).toMatchObject({
      name: '鶏むね肉（皮なし・生）',
      amount: '300g',
      grams: 300,
      p: 69.9,
      f: 5.7,
      note: '1枚=300gとして計算・皮なしとして計算',
    });
    expect(one('とりむね肉 250g')).toMatchObject({ amount: '250g', grams: 250 });
    expect(one('胸肉 半分')).toMatchObject({ amount: '150g' });
  });

  it('handles counts, bowls and size words', () => {
    expect(one('卵２個')).toMatchObject({ name: '全卵（M玉）', amount: '2個', p: 12.2 });
    expect(one('ご飯大盛り')).toMatchObject({ name: '白米（炊飯後）', amount: '225g', note: '1杯=150gとして計算・大盛り（1.5倍）' });
    expect(one('ご飯 茶碗二杯')).toMatchObject({ amount: '300g' });
    expect(one('ご飯2杯')).toMatchObject({ amount: '300g' });
    expect(one('アーモンド20粒')).toMatchObject({ amount: '20粒', p: 4.8 });
    expect(one('オリーブオイル小さじ1')).toMatchObject({ name: 'オリーブオイル（大さじ1）', amount: '小さじ1', f: 4 });
    expect(one('ブロッコリー')).toMatchObject({ amount: '100g', note: '量の指定がないため100gとして計算' });
    expect(one('ブロッコリー3房')).toMatchObject({ amount: '45g' });
    expect(one('鮭')).toMatchObject({ amount: '80g' });
  });

  it('splits several items', () => {
    const items = parseLocally('鶏むね肉1枚、ご飯150g\nブロッコリー100g', [])!;
    expect(items.map((i) => i.amount)).toEqual(['300g', '150g', '100g']);
    expect(parseLocally('ささみ2本とゆで卵1個', [])!.map((i) => i.name)).toEqual(['鶏ささみ（生）', '全卵（M玉）']);
  });

  it('leaves unknown dishes to Claude', () => {
    expect(parseLocally('なか卯、親子丼 大盛り', [])).toBeNull();
    expect(parseLocally('鶏むね肉の唐揚げ', [])).toBeNull();
    expect(parseLocally('鶏むね肉 皮付き 1枚', [])).toBeNull();
    expect(parseLocally('鶏胸肉1枚、ラーメン', [])).toBeNull();
    expect(parseLocally('豚もも肉100g', [])).toBeNull();
  });

  it('uses saved foods, even with commas in the name', () => {
    const mine: Food[] = [{ id: 'm1', name: 'なか卯 親子丼（大盛り）', base: 1, unit: '杯', p: 30, f: 20, c: 120 }];
    expect(one('なか卯、親子丼 大盛り', mine)).toMatchObject({ name: 'なか卯 親子丼（大盛り）', amount: '1杯', p: 30 });
  });

  it('normalizes full-width and kanji numbers before units', () => {
    expect(normalize('ささみ　三本')).toBe('ささみ 3本');
    expect(normalize('卵十二個')).toBe('卵12個');
    expect(normalize('一口')).toBe('一口');
  });
});

describe('claude reply', () => {
  it('keeps valid items and coerces numbers', () => {
    const items = itemsFromReply({
      items: [
        { name: 'なか卯 親子丼（大盛り）', amount: '1杯', grams: null, p: '31.24', f: 20, c: 130, note: '公表値' },
        { name: '空', p: 0, f: 0, c: 0 },
        { amount: '名前なし', p: 1 },
      ],
    });
    expect(items).toEqual([{ name: 'なか卯 親子丼（大盛り）', amount: '1杯', grams: null, p: 31.2, f: 20, c: 130, note: '公表値', source: 'claude' }]);
    expect(itemsFromReply('nope')).toEqual([]);
  });

  it('puts the text and reference foods in the prompt', () => {
    const prompt = buildPrompt('なか卯、親子丼 大盛り', []);
    expect(prompt).toContain('なか卯、親子丼 大盛り');
    expect(prompt).toContain('鶏むね肉（皮なし・生）: 100gあたり P23.3 F1.9 C0.1');
  });
});

describe('new staples', () => {
  it('reads bread, pasta, noodles and nuts', () => {
    expect(one('食パン2枚')).toMatchObject({ name: '食パン（6枚切り1枚）', amount: '2枚' });
    expect(one('パスタ 250g')).toMatchObject({ name: 'パスタ（ゆで）', amount: '250g' });
    expect(one('パスタ（乾）100g')).toMatchObject({ name: 'パスタ（乾麺）', amount: '100g' });
    expect(one('うどん1玉')).toMatchObject({ name: 'うどん（ゆで）', amount: '230g' });
    expect(one('くるみ20g')).toMatchObject({ name: 'くるみ', amount: '20g' });
    expect(one('ピーナッツバター大さじ1')).toMatchObject({ amount: '1大さじ', f: 8.6 });
    expect(parseLocally('焼きそば', [])).toBeNull();
    expect(parseLocally('パン粉 10g', [])).toBeNull();
  });
});
