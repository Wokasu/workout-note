import { useMemo, useState } from 'react';
import { BODY_FIELDS, type BodyField, type BodyRecord } from '../types';
import { applyMapping, decodeText, prepareImport, type Mapping, type Table } from '../lib/importer';
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

  const readFile = async (file: File) => {
    setError('');
    setDone('');
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

  const commit = () => {
    if (!result || result.records.length === 0) return;
    onImport(result.records);
    const first = result.records[0].date;
    const last = result.records.at(-1)!.date;
    setDone(`${result.records.length}日分（${formatJa(first)}〜${formatJa(last)}）を取り込みました`);
    setTable(null);
  };

  if (!table) {
    return (
      <section className="card form">
        <h3>体組成計のデータを取り込む</h3>
        <p className="muted">
          ヘルスプラネット（タニタ）からダウンロードした CSV を選んでください。他のアプリやスプレッドシートの CSV（ウエストなどのサイズ）も取り込めます。同じ日の記録は上書きされます。
        </p>
        <label className="file">
          CSV ファイルを選ぶ
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
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

  const preview = result?.records.slice(-3).reverse() ?? [];
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
          {preview.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>日付</th>
                    {usedFields.map((k) => (
                      <th key={k}>{FIELD_BY_KEY[k].label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.date}>
                      <td>{formatJa(r.date)}</td>
                      {usedFields.map((k) => (
                        <td key={k}>{r[k] !== undefined ? formatValue(k, r[k]!) : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="row">
        <button className="ghost grow" onClick={() => setTable(null)}>
          やめる
        </button>
        <button className="primary grow" onClick={commit} disabled={!result || result.records.length === 0}>
          取り込む
        </button>
      </div>
    </section>
  );
}
