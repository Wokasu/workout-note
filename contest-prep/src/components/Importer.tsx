import { useMemo, useState } from 'react';
import { BODY_FIELDS, type BodyField, type BodyRecord } from '../types';
import { applyMapping, decodeText, prepareImport, type ImportResult, type Mapping, type Table } from '../lib/importer';
import { readHealthExport } from '../lib/health';
import { FIELD_BY_KEY, FIELD_DEFS, formatValue } from '../lib/fields';
import { formatJa } from '../lib/date';

type ColRole = '' | 'date' | 'time' | BodyField;

function rolesFrom(table: Table, m: Mapping): ColRole[] {
  return table.header.map((_, i) => {
    if (i === m.dateCol) return 'date';
    if (i === m.timeCol) return 'time';
    return BODY_FIELDS.find((k) => m.fields[k] === i) ?? '';
  });
}

function mappingFrom(roles: ColRole[]): Mapping {
  const fields: Mapping['fields'] = {};
  roles.forEach((r, i) => {
    if (r && r !== 'date' && r !== 'time' && fields[r] === undefined) fields[r] = i;
  });
  return { dateCol: roles.indexOf('date'), timeCol: roles.indexOf('time'), fields };
}

export function Importer({ onImport }: { onImport: (records: BodyRecord[]) => void }) {
  const [table, setTable] = useState<Table | null>(null);
  const [roles, setRoles] = useState<ColRole[]>([]);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [health, setHealth] = useState<(ImportResult & { rows: number }) | null>(null);

  const readFile = async (file: File) => {
    setError('');
    setDone('');
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip') || name.endsWith('.xml')) {
      setProgress(0);
      try {
        const result = await readHealthExport(file, setProgress);
        if (result.records.length === 0) setError('体重・体脂肪率・ウエストのデータが見つかりませんでした');
        else setHealth(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ファイルを読み込めませんでした');
      } finally {
        setProgress(null);
      }
      return;
    }
    const prepared = prepareImport(decodeText(await file.arrayBuffer()));
    if (!prepared || prepared.table.rows.length === 0) {
      setError('表として読み込めませんでした。CSV ファイルか確認してください。');
      return;
    }
    setTable(prepared.table);
    setRoles(rolesFrom(prepared.table, prepared.mapping));
  };

  const mapping = useMemo(() => mappingFrom(roles), [roles]);
  const result = useMemo(() => (table && mapping.dateCol >= 0 ? applyMapping(table, mapping) : null), [table, mapping]);

  const commit = (records: BodyRecord[] | undefined) => {
    if (!records || records.length === 0) return;
    onImport(records);
    setDone(`${records.length}日分（${formatJa(records[0].date)}〜${formatJa(records.at(-1)!.date)}）を取り込みました`);
    setTable(null);
    setHealth(null);
  };

  if (progress !== null) {
    return (
      <section className="card form">
        <h3>ヘルスケアのデータを読み込み中</h3>
        <div className="track">
          <div className="fill progress" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="muted">{Math.round(progress * 100)}% · ファイルが大きいと1分ほどかかります</p>
      </section>
    );
  }

  if (health) {
    const used = BODY_FIELDS.filter((k) => health.records.some((r) => r[k] !== undefined));
    return (
      <section className="card form">
        <h3>ヘルスケアから取り込む</h3>
        <p className="muted">
          {health.rows}件の測定から {health.records.length}日分（{formatJa(health.records[0].date)}〜{formatJa(health.records.at(-1)!.date)}
          ）を読み取りました。同じ日に複数回測っている場合は一番早い時刻の値を使います。
        </p>
        <Preview records={health.records} fields={used} />
        <div className="row">
          <button className="ghost grow" onClick={() => setHealth(null)}>
            やめる
          </button>
          <button className="primary grow" onClick={() => commit(health.records)}>
            取り込む
          </button>
        </div>
      </section>
    );
  }

  if (!table) {
    return (
      <section className="card form">
        <h3>体重・体組成のデータを取り込む</h3>
        <p className="muted">
          <b>iPhone のヘルスケア：</b>ヘルスケアアプリ右上のアイコン →「すべてのヘルスケアデータを書き出す」で作られる export.zip を選んでください（体重・体脂肪率・ウエスト）。
        </p>
        <p className="muted">
          <b>CSV：</b>ヘルスプラネットや、サイズを記録している表の CSV も取り込めます。同じ日の記録は上書きされます。
        </p>
        <label className="file">
          ファイルを選ぶ（zip / CSV）
          <input
            type="file"
            accept=".zip,.xml,.csv,.txt,.tsv,application/zip,text/csv,text/plain,text/xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = '';
            }}
          />
        </label>
        {error && <p className="status warn">{error}</p>}
        {done && <p className="status ok">{done}</p>}
      </section>
    );
  }

  const usedFields = BODY_FIELDS.filter((k) => mapping.fields[k] !== undefined);

  return (
    <section className="card form">
      <h3>列の対応を確認</h3>
      <p className="muted">自動で判定しました。違っていたら直してください（{table.rows.length}行）。</p>
      <div className="mapping">
        {table.header.map((h, i) => (
          <label key={i} className="map-row">
            <span className="map-col">
              {h || `列${i + 1}`}
              <small className="muted">{table.rows[0]?.[i] ?? ''}</small>
            </span>
            <select value={roles[i]} onChange={(e) => setRoles((r) => r.map((x, j) => (j === i ? (e.target.value as ColRole) : x)))}>
              <option value="">使わない</option>
              <option value="date">日付（日時）</option>
              <option value="time">時刻</option>
              {FIELD_DEFS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {mapping.dateCol < 0 && <p className="status warn">日付の列を選んでください</p>}
      {result && (
        <>
          <p className="muted">
            {result.records.length}日分を読み取りました
            {result.badRows > 0 && ` · 日付が読めない行 ${result.badRows}`}
            {result.outOfRange > 0 && ` · 範囲外の値 ${result.outOfRange}`}
            。同じ日に複数回測っている場合は一番早い時刻の値を使います。
          </p>
          <Preview records={result.records} fields={usedFields} />
        </>
      )}
      <div className="row">
        <button className="ghost grow" onClick={() => setTable(null)}>
          やめる
        </button>
        <button className="primary grow" onClick={() => commit(result?.records)} disabled={!result || result.records.length === 0}>
          取り込む
        </button>
      </div>
    </section>
  );
}

/** 取り込む記録の最新3日分 */
function Preview({ records, fields }: { records: BodyRecord[]; fields: BodyField[] }) {
  const preview = records.slice(-3).reverse();
  if (preview.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>日付</th>
            {fields.map((k) => (
              <th key={k}>{FIELD_BY_KEY[k].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((r) => (
            <tr key={r.date}>
              <td>{formatJa(r.date)}</td>
              {fields.map((k) => (
                <td key={k}>{r[k] !== undefined ? formatValue(k, r[k]!) : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
