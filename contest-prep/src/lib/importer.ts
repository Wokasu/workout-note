import { BODY_FIELDS, type BodyField, type BodyRecord } from '../types';
import { FIELD_BY_KEY, FIELD_DEFS } from './fields';

/** UTF-8 として読めなければ Shift_JIS（日本のアプリの CSV に多い）として読む */
export function decodeText(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('shift_jis').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

/** 全角英数・記号を半角にそろえる */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

/** CSV / TSV をセルの二次元配列にする（ダブルクォート対応） */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export interface DateTime {
  date: string;
  /** 0時からの分。時刻がなければ null */
  minutes: number | null;
}

/**
 * 2026/10/16 7:12、2026-10-16T07:12、2026年10月16日、202610160712（ヘルスプラネット API 形式）などを読む
 */
export function parseDateTime(raw: string): DateTime | null {
  const s = toHalfWidth(raw).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?$/);
  if (!m) m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT]*(\d{1,2})\s*[:時]\s*(\d{1,2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    date: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutes: hh !== undefined ? Number(hh) * 60 + Number(mm) : null,
  };
}

function parseTime(raw: string): number | null {
  const m = toHalfWidth(raw).match(/(\d{1,2})\s*[:時]\s*(\d{1,2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 「65.3kg」「65,3」などから数値を取り出す。空欄や「-」は null */
export function parseNumber(raw: string): number | null {
  const s = toHalfWidth(raw).replace(/,/g, '.').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function normalizeHeader(h: string): string {
  return toHalfWidth(h).toLowerCase().replace(/[\s()（）［］[\]]/g, '');
}

const DATE_WORDS = ['日付', '測定日', '日時', '年月日', 'date'];
const TIME_WORDS = ['時刻', '時間', 'time'];

export function matchField(header: string): BodyField | null {
  const h = normalizeHeader(header);
  for (const def of FIELD_DEFS) {
    if (def.excludes?.some((w) => h.includes(w))) continue;
    if (def.keywords.some((w) => h.includes(w.toLowerCase()))) return def.key;
  }
  return null;
}

export interface Mapping {
  dateCol: number;
  /** 日付とは別の列に時刻がある場合（なければ -1） */
  timeCol: number;
  fields: Partial<Record<BodyField, number>>;
}

export interface Table {
  header: string[];
  rows: string[][];
}

/** 先頭に説明行などがあっても、日付と測定項目の両方を含む行をヘッダーとして探す */
export function findTable(cells: string[][]): Table | null {
  for (let i = 0; i < Math.min(cells.length, 20); i++) {
    const row = cells[i];
    const hasDate = row.some((c) => DATE_WORDS.some((w) => normalizeHeader(c).includes(w)));
    const hasField = row.some((c) => matchField(c) !== null);
    if (hasDate && hasField) return { header: row, rows: cells.slice(i + 1) };
  }
  if (cells.length < 2) return null;
  return { header: cells[0], rows: cells.slice(1) };
}

export function autoMap(header: string[]): Mapping {
  const norm = header.map(normalizeHeader);
  let dateCol = norm.findIndex((h) => DATE_WORDS.some((w) => h.includes(w)));
  const timeCol = norm.findIndex((h, i) => i !== dateCol && TIME_WORDS.some((w) => h.includes(w)) && !h.includes('日'));
  if (dateCol === -1) dateCol = 0;
  const fields: Mapping['fields'] = {};
  header.forEach((h, i) => {
    if (i === dateCol || i === timeCol) return;
    const key = matchField(h);
    if (key && fields[key] === undefined) fields[key] = i;
  });
  return { dateCol, timeCol, fields };
}

/**
 * 「日付, タグ, 値」の縦長形式（ヘルスプラネット API のデータを書き出したもの）を
 * 1日1行の横長形式に変換する。該当しなければ null。
 */
export function pivotLongFormat(table: Table): Table | null {
  const norm = table.header.map(normalizeHeader);
  const tagCol = norm.findIndex((h) => h === 'tag' || h.includes('タグ') || h.includes('項目'));
  const valueCol = norm.findIndex((h) => h === 'keydata' || h === 'value' || h.includes('値') || h.includes('測定値'));
  const dateCol = norm.findIndex((h) => DATE_WORDS.some((w) => h.includes(w)));
  if (tagCol === -1 || valueCol === -1 || dateCol === -1) return null;

  const tagToField = new Map(FIELD_DEFS.filter((f) => f.tag).map((f) => [f.tag!, f.key]));
  const fieldOf = (tag: string) => tagToField.get(tag.trim()) ?? matchField(tag);
  const used = [...new Set(table.rows.map((r) => fieldOf(r[tagCol] ?? '')).filter((k): k is BodyField => k !== null))];
  if (used.length === 0) return null;

  const byDate = new Map<string, string[]>();
  for (const r of table.rows) {
    const key = fieldOf(r[tagCol] ?? '');
    if (!key) continue;
    const dt = r[dateCol];
    const row = byDate.get(dt) ?? [dt, ...used.map(() => '')];
    row[used.indexOf(key) + 1] = r[valueCol] ?? '';
    byDate.set(dt, row);
  }
  return {
    header: ['日時', ...used.map((k) => FIELD_BY_KEY[k].label)],
    rows: [...byDate.values()],
  };
}

export interface ImportResult {
  records: BodyRecord[];
  /** 日付が読めなかった行 */
  badRows: number;
  /** 範囲外で捨てた値 */
  outOfRange: number;
}

/**
 * マッピングに従って1日1件の記録にする。
 * 同じ日に複数回測っている場合は、項目ごとに一番早い時刻の値（朝の測定）を使う。
 */
export function applyMapping(table: Table, mapping: Mapping): ImportResult {
  const byDate = new Map<string, { rec: BodyRecord; at: Partial<Record<BodyField, number>> }>();
  let badRows = 0;
  let outOfRange = 0;

  for (const row of table.rows) {
    const dt = parseDateTime(row[mapping.dateCol] ?? '');
    if (!dt) {
      badRows++;
      continue;
    }
    const minutes = (mapping.timeCol >= 0 ? parseTime(row[mapping.timeCol] ?? '') : null) ?? dt.minutes ?? 24 * 60;
    const entry = byDate.get(dt.date) ?? { rec: { date: dt.date }, at: {} };
    for (const key of BODY_FIELDS) {
      const col = mapping.fields[key];
      if (col === undefined) continue;
      const v = parseNumber(row[col] ?? '');
      if (v === null) continue;
      const def = FIELD_BY_KEY[key];
      if (v < def.min || v > def.max) {
        outOfRange++;
        continue;
      }
      const prevAt = entry.at[key];
      if (prevAt === undefined || minutes < prevAt) {
        entry.rec[key] = v;
        entry.at[key] = minutes;
      }
    }
    byDate.set(dt.date, entry);
  }

  const records = [...byDate.values()]
    .map((e) => e.rec)
    .filter((r) => Object.keys(r).length > 1)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { records, badRows, outOfRange };
}

/** 既存の記録に取り込んだ値を上書きでマージする（取り込みにない項目は残す） */
export function mergeBody(existing: BodyRecord[], incoming: BodyRecord[]): BodyRecord[] {
  const map = new Map(existing.map((r) => [r.date, { ...r }]));
  for (const r of incoming) map.set(r.date, { ...map.get(r.date), ...r });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** ファイルの中身から取り込み用の表とマッピング案を作る */
export function prepareImport(text: string): { table: Table; mapping: Mapping } | null {
  const found = findTable(parseCsv(text));
  if (!found) return null;
  const table = pivotLongFormat(found) ?? found;
  return { table, mapping: autoMap(table.header) };
}
