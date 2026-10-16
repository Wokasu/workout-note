import type { BodyField } from '../types';
import { applyMapping, type ImportResult, type Table } from './importer';

/**
 * iPhone の「ヘルスケア」→ プロフィール → すべてのヘルスケアデータを書き出す、で作られる
 * export.zip（中身は export.xml。日本語環境では「書き出したデータ.xml」）を読む。
 * 数百MB になることもあるので、zip を展開しながら必要な行だけ拾う。
 */

const TYPES: Record<string, BodyField> = {
  HKQuantityTypeIdentifierBodyMass: 'weightKg',
  HKQuantityTypeIdentifierBodyFatPercentage: 'bodyFatPct',
  HKQuantityTypeIdentifierWaistCircumference: 'waistCm',
};

const COLUMNS: BodyField[] = ['weightKg', 'bodyFatPct', 'waistCm'];

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

/** 単位をそろえる（lb→kg、in→cm、体脂肪率は 0.153 のような割合で入っている） */
function convert(field: BodyField, value: number, unit: string): number | null {
  if (field === 'weightKg') {
    if (unit === 'kg') return value;
    if (unit === 'lb') return value * 0.45359237;
    if (unit === 'g') return value / 1000;
    return null;
  }
  if (field === 'bodyFatPct') return value <= 1 ? value * 100 : value;
  if (unit === 'cm') return value;
  if (unit === 'in') return value * 2.54;
  if (unit === 'm') return value * 100;
  return null;
}

export interface HealthRow {
  dateTime: string;
  field: BodyField;
  value: number;
}

/** <Record .../> タグ1つを読む。対象外なら null */
export function parseRecordTag(tag: string): HealthRow | null {
  const type = attr(tag, 'type');
  const field = type ? TYPES[type] : undefined;
  if (!field) return null;
  const raw = Number(attr(tag, 'value'));
  const start = attr(tag, 'startDate');
  if (!Number.isFinite(raw) || !start) return null;
  const value = convert(field, raw, attr(tag, 'unit') ?? '');
  if (value === null) return null;
  // "2026-10-16 07:12:00 +0900" の日付と時刻（書き出した端末の現地時刻）を使う
  return { dateTime: start.slice(0, 16), field, value: Math.round(value * 100) / 100 };
}

/** XML の文字列チャンクから対象の Record を拾う（タグがチャンクをまたいでもよい） */
export async function scanRecords(chunks: AsyncIterable<string>): Promise<HealthRow[]> {
  const rows: HealthRow[] = [];
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    let pos = 0;
    for (;;) {
      const start = buf.indexOf('<Record ', pos);
      if (start === -1) {
        // 次のチャンクとつながる可能性のある末尾だけ残す
        pos = Math.max(pos, buf.length - 8);
        break;
      }
      const end = buf.indexOf('>', start);
      if (end === -1) {
        pos = start;
        break;
      }
      const tag = buf.slice(start, end + 1);
      if (tag.includes('HKQuantityTypeIdentifier')) {
        const row = parseRecordTag(tag);
        if (row) rows.push(row);
      }
      pos = end + 1;
    }
    buf = buf.slice(pos);
  }
  return rows;
}

/** 読み取った行を、同じ日は朝の値を優先して1日1件にまとめる */
export function rowsToRecords(rows: HealthRow[]): ImportResult {
  const table: Table = {
    header: ['日時', ...COLUMNS],
    rows: rows.map((r) => [r.dateTime, ...COLUMNS.map((c) => (c === r.field ? String(r.value) : ''))]),
  };
  const fields = Object.fromEntries(COLUMNS.map((c, i) => [c, i + 1]));
  return applyMapping(table, { dateCol: 0, timeCol: -1, fields });
}

async function* textChunks(stream: ReadableStream<Uint8Array>, onBytes?: (n: number) => void): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onBytes?.(value.length);
    yield value;
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

async function readBytes(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

/** zip の中央ディレクトリからファイル一覧を読む */
export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = await readBytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('zip ファイルとして読めませんでした');
  let count = tail.getUint16(eocd + 10, true);
  let dirSize = tail.getUint32(eocd + 12, true);
  let dirOffset = tail.getUint32(eocd + 16, true);

  // 4GB を超える zip（ZIP64）
  if (dirOffset === 0xffffffff && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = Number(tail.getBigUint64(eocd - 12, true));
    const rec = await readBytes(file, z64, z64 + 56);
    count = Number(rec.getBigUint64(32, true));
    dirSize = Number(rec.getBigUint64(40, true));
    dirOffset = Number(rec.getBigUint64(48, true));
  }

  const dir = await readBytes(file, dirOffset, dirOffset + dirSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= dir.byteLength; i++) {
    if (dir.getUint32(p, true) !== 0x02014b50) break;
    const method = dir.getUint16(p + 10, true);
    let compressedSize = dir.getUint32(p + 20, true);
    let size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    let localOffset = dir.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));

    // ZIP64 拡張フィールド（0xffffffff の項目だけが順に入っている）
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dir.getUint16(e, true);
      const len = dir.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(dir.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(dir.getBigUint64(q, true));
          q += 8;
        }
        if (localOffset === 0xffffffff) localOffset = Number(dir.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** export.xml にあたるファイル（cda などを除いた一番大きい xml） */
export function pickExportXml(entries: ZipEntry[]): ZipEntry | undefined {
  return entries
    .filter((e) => e.name.toLowerCase().endsWith('.xml') && !e.name.includes('export_cda') && !e.name.includes('/workout-routes/'))
    .sort((a, b) => b.size - a.size)[0];
}

async function entryStream(file: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const local = await readBytes(file, entry.localOffset, entry.localOffset + 30);
  const dataStart = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const raw = file.slice(dataStart, dataStart + entry.compressedSize).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream('deflate-raw'));
  throw new Error('対応していない圧縮形式です');
}

/**
 * ヘルスケアの書き出しファイル（export.zip か、展開した xml）を読む。
 * onProgress には 0〜1 の進み具合を渡す。
 */
export async function readHealthExport(file: File, onProgress?: (ratio: number) => void): Promise<ImportResult & { rows: number }> {
  let stream: ReadableStream<Uint8Array>;
  let total: number;
  if (file.name.toLowerCase().endsWith('.zip')) {
    const entry = pickExportXml(await listZip(file));
    if (!entry) throw new Error('zip の中にヘルスケアのデータ（xml）が見つかりませんでした');
    stream = await entryStream(file, entry);
    total = entry.size;
  } else {
    stream = file.stream();
    total = file.size;
  }
  let read = 0;
  // 文字数とバイト数は一致しないが、進み具合の目安には十分
  const rows = await scanRecords(textChunks(stream, (n) => onProgress?.(Math.min(1, (read += n) / total))));
  return { ...rowsToRecords(rows), rows: rows.length };
}
