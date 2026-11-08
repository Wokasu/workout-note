/* 競馬AI ブラウザ版エンジン（Python 版 keiba_ai の JavaScript 移植）
 *
 * Python 版との違いは能力モデルだけ:
 *   Python 版 = LightGBM、ブラウザ版 = 条件付きロジット（レース内ソフトマックスの線形モデル。Benter の方法）
 * 特徴量・市場との合成・2着3着の確率・期待値とケリーの買い目・ウォークフォワード検証は同じ計算。
 * DOM を使わないので Web Worker でも Node でも動く。
 */
(function (root) {
  "use strict";

  const BET_TYPES = ["win", "quinella", "wide", "exacta"];
  const BET_LABEL = { win: "単勝", quinella: "馬連", wide: "ワイド", exacta: "馬単" };
  const LEAGUE_LABEL = { jra: "中央", nankan: "南関東" };
  const NANKAN_COURSES = new Set(["浦和", "船橋", "大井", "川崎"]);
  const PAYBACK_BY_LEAGUE = {
    jra: { win: 0.8, quinella: 0.775, wide: 0.775, exacta: 0.75 },
    nankan: { win: 0.8, quinella: 0.75, wide: 0.75, exacta: 0.75 },
  };
  const CLASS_SCALE = {
    jra: { 新馬: 1, 未勝利: 1, "1勝": 2, "2勝": 3, "3勝": 4, OP: 5, L: 5, G3: 6, G2: 7, G1: 8 },
    nankan: { 新馬: 1, 未格付: 1, C3: 2, C2: 3, C1: 4, B3: 5, B2: 6, B1: 7, A2: 8, A1: 9, OP: 10, S3: 11, S2: 12, S1: 13, Jpn3: 13, Jpn2: 14, Jpn1: 15 },
  };
  const CARD_COLUMNS = ["race_id", "date", "course", "surface", "distance", "going", "race_class", "field_size", "horse_id",
    "horse_name", "frame", "number", "sex", "age", "weight_carried", "jockey_id", "trainer_id", "body_weight",
    "body_weight_diff", "win_odds", "popularity"];
  const NUMERIC = ["distance", "race_class", "field_size", "frame", "number", "age", "weight_carried", "body_weight",
    "body_weight_diff", "win_odds", "popularity", "finish_pos", "time_sec", "last3f"];
  const RELATIVE = ["h_fp_mean5", "h_fp_last", "h_tb_mean5", "h_l3f_rank_mean5", "h_top3_rate", "h_best_tb5",
    "h_same_surface_fp", "h_same_dist_fp", "h_same_course_fp", "j_win_rate", "j_top3_rate", "t_win_rate",
    "t_top3_rate", "h_prev_pop_resid", "weight_carried"];

  const fin = Number.isFinite;
  const nan = NaN;

  /* ================= CSV ================= */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const header = (rows.shift() || []).map((h) => h.trim().replace(/^﻿/, ""));
    return { header, rows };
  }
  function toCSV(header, objs) {
    const esc = (v) => { const s = v == null || (typeof v === "number" && !fin(v)) ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [header.join(",")].concat(objs.map((o) => header.map((h) => esc(o[h])).join(","))).join("\n") + "\n";
  }
  function dayNumber(s) {
    const m = String(s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!m) return nan;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  function dayToStr(d) { return new Date(d * 86400000).toISOString().slice(0, 10); }

  function loadResults(text, league) {
    const { header, rows } = parseCSV(text);
    const missing = CARD_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) throw new Error("必要な列がありません: " + missing.join(", "));
    const ix = Object.fromEntries(header.map((h, i) => [h, i]));
    const out = [];
    for (const r of rows) {
      const g = (c) => (ix[c] == null ? "" : (r[ix[c]] ?? "").trim());
      const o = {};
      for (const c of ["race_id", "course", "surface", "going", "sex", "horse_id", "horse_name", "jockey_id", "trainer_id"]) o[c] = g(c);
      o.day = dayNumber(g("date"));
      if (!fin(o.day) || !o.race_id) continue;
      o.date = dayToStr(o.day); o.year = +o.date.slice(0, 4);
      const lg = g("league").toLowerCase();
      o.league = lg || (NANKAN_COURSES.has(o.course) ? "nankan" : "jra");
      for (const c of NUMERIC) {
        const v = g(c);
        o[c] = v === "" ? nan : Number(v);
      }
      if (!fin(o.race_class)) {
        const raw = g("race_class"), sc = CLASS_SCALE[o.league] || CLASS_SCALE[league] || {};
        o.race_class = sc[raw] ?? nan;
      }
      out.push(o);
    }
    if (!out.length) throw new Error("読み込める行がありません（date と race_id を確認してください）");
    return out;
  }
  function normalizeCombo(type, combo) {
    let parts = String(combo).replace(/→/g, "-").replace(/>/g, "-").split("-").map((x) => x.trim()).filter(Boolean).map(Number);
    if (type === "quinella" || type === "wide") parts = parts.sort((a, b) => a - b);
    return parts.join("-");
  }
  function loadPayouts(text) {
    const { header, rows } = parseCSV(text), ix = Object.fromEntries(header.map((h, i) => [h, i]));
    for (const c of ["race_id", "bet_type", "combination", "payout"]) if (ix[c] == null) throw new Error("payouts.csv に列 " + c + " がありません");
    const m = new Map();
    for (const r of rows) {
      const rid = r[ix.race_id].trim(), t = r[ix.bet_type].trim();
      if (!m.has(rid)) m.set(rid, new Map());
      m.get(rid).set(t + "|" + normalizeCombo(t, r[ix.combination]), Number(r[ix.payout]));
    }
    return m;
  }
  function loadOdds(text) {
    const { header, rows } = parseCSV(text), ix = Object.fromEntries(header.map((h, i) => [h, i]));
    for (const c of ["race_id", "bet_type", "combination", "odds"]) if (ix[c] == null) throw new Error("odds.csv に列 " + c + " がありません");
    const o = {};
    for (const r of rows) {
      const rid = r[ix.race_id].trim(), t = r[ix.bet_type].trim();
      ((o[rid] ||= {})[t] ||= {})[normalizeCombo(t, r[ix.combination])] = Number(String(r[ix.odds]).split("-")[0]);
    }
    return o;
  }
  const LABEL_TO_TYPE = { 単勝: "win", 馬連: "quinella", 馬複: "quinella", ワイド: "wide", 馬単: "exacta", win: "win", quinella: "quinella", wide: "wide", exacta: "exacta" };
  function parseOddsText(text, raceIds) {
    const out = {}; let current = raceIds.length === 1 ? raceIds[0] : null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim().replace(/，/g, ",").replace(/　/g, " ");
      if (!line) continue;
      if (line.startsWith("#")) { current = line.replace(/^#+/, "").trim(); continue; }
      if (/^race_id/i.test(line)) continue;
      let toks = line.split(/[\s,]+/).filter(Boolean), rid = current;
      if (toks.length && !(toks[0] in LABEL_TO_TYPE)) { rid = toks[0]; toks = toks.slice(1); }
      if (toks.length < 3 || !(toks[0] in LABEL_TO_TYPE)) throw new Error(`オッズの行が読めません: 「${raw}」（例: 馬連 3-7 12.5）`);
      if (rid == null) throw new Error("出馬表に複数のレースがあるので、「# race_id」の行でどのレースか書いてください");
      const t = LABEL_TO_TYPE[toks[0]], odds = Number(toks[2].replace(/〜/g, "-").split("-")[0]);
      if (!fin(odds)) throw new Error(`オッズが数字ではありません: 「${raw}」`);
      ((out[rid] ||= {})[t] ||= {})[normalizeCombo(t, toks[1])] = odds;
    }
    return out;
  }

  /* ================= 特徴量（features.py と同じ計算） ================= */
  function groupBy(n, keyOf) {
    const m = new Map();
    for (let i = 0; i < n; i++) { const k = keyOf(i); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(i); }
    return m;
  }
  function rankPct(vals) { // pandas rank(pct=True), method=average、NaN は無視
    const idx = []; for (let i = 0; i < vals.length; i++) if (fin(vals[i])) idx.push(i);
    idx.sort((a, b) => vals[a] - vals[b]);
    const out = new Array(vals.length).fill(nan), n = idx.length;
    for (let s = 0; s < n;) {
      let e = s; while (e + 1 < n && Math.abs(vals[idx[e + 1]] - vals[idx[s]]) < 1e-9) e++; // 計算誤差の差は同順位
      const r = (s + e + 2) / 2 / n;
      for (let k = s; k <= e; k++) out[idx[k]] = r;
      s = e + 1;
    }
    return out;
  }
  function meanFinite(a) { let s = 0, c = 0; for (const v of a) if (fin(v)) { s += v; c++; } return c ? s / c : nan; }

  function buildFeatures(input) {
    const R = input.slice().sort((a, b) => a.day - b.day || (a.race_id < b.race_id ? -1 : a.race_id > b.race_id ? 1 : 0) || a.number - b.number);
    const n = R.length, F = {};
    const col = (name) => (F[name] = new Float64Array(n).fill(nan));
    const fp = col("fp_pct"), isWin = col("is_win"), isTop3 = col("is_top3"), tb = col("time_behind"),
      l3 = col("l3f_rank"), popr = col("pop_resid");
    const races = groupBy(n, (i) => R[i].race_id);
    for (const idx of races.values()) {
      const fsCount = Math.max(2, idx.filter((i) => fin(R[i].finish_pos)).length);
      let wt = Infinity; for (const i of idx) if (fin(R[i].time_sec) && R[i].time_sec < wt) wt = R[i].time_sec;
      const ranks = rankPct(idx.map((i) => R[i].last3f));
      idx.forEach((i, k) => {
        const f = R[i].finish_pos;
        if (fin(f)) { fp[i] = (f - 1) / (fsCount - 1); isWin[i] = f === 1 ? 1 : 0; isTop3[i] = f <= 3 ? 1 : 0; }
        if (fin(R[i].time_sec) && fin(wt)) tb[i] = Math.min(R[i].time_sec - wt, 5);
        l3[i] = ranks[k];
        popr[i] = (R[i].popularity - f) / fsCount;
      });
    }
    // 馬ごとの過去走
    const names = ["h_runs", "h_fp_last", "h_fp_last2", "h_fp_mean5", "h_tb_mean5", "h_best_tb5", "h_l3f_rank_mean5",
      "h_prev_pop_resid", "h_win_rate", "h_top3_rate", "h_days_since", "h_dist_change", "h_class_change",
      "h_weight_carried_change", "h_league_switch", "h_from_jra", "h_runs_in_league", "h_same_surface_fp",
      "h_same_dist_fp", "h_same_course_fp"];
    for (const nm of names) col(nm);
    const lastN = (seq, k, arr, w, fn) => { const v = []; for (let j = Math.max(0, k - w); j < k; j++) if (fin(arr[seq[j]])) v.push(arr[seq[j]]); return v.length ? fn(v) : nan; };
    const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length, min = (v) => Math.min(...v);
    for (const seq of groupBy(n, (i) => R[i].horse_id).values()) {
      let wins = 0, top3 = 0, fromJra = 0;
      const bySurf = new Map(), byDist = new Map(), byCourse = new Map(), byLeague = new Map();
      const upd = (m, k, v) => { if (!fin(v)) return; const o = m.get(k) || { s: 0, c: 0 }; o.s += v; o.c++; m.set(k, o); };
      const get = (m, k) => { const o = m.get(k); return o && o.c ? o.s / o.c : nan; };
      seq.forEach((i, k) => {
        const r = R[i], p = k ? R[seq[k - 1]] : null;
        F.h_runs[i] = k;
        F.h_fp_last[i] = k >= 1 ? fp[seq[k - 1]] : nan;
        F.h_fp_last2[i] = k >= 2 ? fp[seq[k - 2]] : nan;
        F.h_fp_mean5[i] = lastN(seq, k, fp, 5, mean);
        F.h_tb_mean5[i] = lastN(seq, k, tb, 5, mean);
        F.h_best_tb5[i] = lastN(seq, k, tb, 5, min);
        F.h_l3f_rank_mean5[i] = lastN(seq, k, l3, 5, mean);
        F.h_prev_pop_resid[i] = lastN(seq, k, popr, 3, mean);
        F.h_win_rate[i] = k ? wins / k : nan;
        F.h_top3_rate[i] = k ? top3 / k : nan;
        if (p) {
          F.h_days_since[i] = r.day - p.day;
          F.h_dist_change[i] = r.distance - p.distance;
          F.h_class_change[i] = p.league === r.league ? r.race_class - p.race_class : nan;
          F.h_weight_carried_change[i] = r.weight_carried - p.weight_carried;
        }
        F.h_league_switch[i] = p && p.league !== r.league ? 1 : 0;
        F.h_from_jra[i] = fromJra;
        F.h_runs_in_league[i] = byLeague.get(r.league) || 0;
        const band = Math.floor(r.distance / 400);
        F.h_same_surface_fp[i] = get(bySurf, r.surface);
        F.h_same_dist_fp[i] = get(byDist, band);
        F.h_same_course_fp[i] = get(byCourse, r.course);
        // この走の結果を「次走以降の過去」に足す
        if (fin(isWin[i])) wins += isWin[i];
        if (fin(isTop3[i])) top3 += isTop3[i];
        if (r.league === "jra") fromJra = 1;
        byLeague.set(r.league, (byLeague.get(r.league) || 0) + 1);
        upd(bySurf, r.surface, fp[i]); upd(byDist, band, fp[i]); upd(byCourse, r.course, fp[i]);
      });
    }
    // 騎手・調教師（前日までの累積。少ない数は全体平均へ縮める）
    for (const [idCol, pre] of [["jockey_id", "j"], ["trainer_id", "t"]]) {
      const wr = col(pre + "_win_rate"), tr = col(pre + "_top3_rate"), rides = col(pre + "_rides");
      for (const seq of groupBy(n, (i) => R[i][idCol]).values()) {
        // seq は日付順。日ごとにまとめて、その日の前までの累積を当てる
        let cw = 0, ct = 0, cn = 0, k = 0;
        while (k < seq.length) {
          const d = R[seq[k]].day; let e = k; while (e < seq.length && R[seq[e]].day === d) e++;
          for (let j = k; j < e; j++) {
            const i = seq[j];
            wr[i] = (cw + 0.07 * 30) / (cn + 30); tr[i] = (ct + 0.21 * 30) / (cn + 30); rides[i] = cn;
          }
          for (let j = k; j < e; j++) { const i = seq[j]; if (fin(isWin[i])) { cw += isWin[i]; ct += isTop3[i]; cn++; } }
          k = e;
        }
      }
    }
    const fpct = col("frame_pct"), wc = col("weight_carried");
    for (let i = 0; i < n; i++) { fpct[i] = R[i].number / R[i].field_size; wc[i] = R[i].weight_carried; }
    for (const c of RELATIVE) {
      const rk = col(c + "_rank"), df = col(c + "_diff"), src = F[c];
      for (const idx of races.values()) {
        const vals = idx.map((i) => src[i]), rr = rankPct(vals), m = meanFinite(vals);
        idx.forEach((i, k) => { rk[i] = rr[k]; df[i] = src[i] - m; });
      }
    }
    return { rows: R, F, races };
  }

  /* ================= 能力モデル（条件付きロジット） ================= */
  // レース内で全馬同じ値の列は効かないので、馬ごとに違う列だけを使う
  const LIN_BASE = ["age", "weight_carried", "body_weight", "body_weight_diff", "frame_pct",
    "h_fp_last", "h_fp_last2", "h_fp_mean5", "h_tb_mean5", "h_best_tb5", "h_l3f_rank_mean5", "h_prev_pop_resid",
    "h_win_rate", "h_top3_rate", "h_class_change", "h_weight_carried_change", "h_same_surface_fp", "h_same_dist_fp",
    "h_same_course_fp", "h_league_switch", "h_from_jra", "j_win_rate", "j_top3_rate", "t_win_rate", "t_top3_rate"];
  const LIN_DERIVED = ["log_runs", "log_days", "log_runs_league", "log_j_rides", "log_t_rides", "dist_change_400",
    "abs_dist_change_400", "no_history", "sex_f", "sex_g", "sq_fp_mean5", "sq_tb_mean5", "layoff_long"];

  function modelSpec(D, idx) {
    const courses = new Map();
    for (const i of idx) courses.set(D.rows[i].course, (courses.get(D.rows[i].course) || 0) + 1);
    const top = [...courses].filter(([, c]) => c >= 200).map(([k]) => k).sort();
    const names = [...LIN_BASE, ...LIN_DERIVED, ...RELATIVE.map((c) => c + "_rank"),
      ...top.map((c) => "frame@" + c), "frame_x_short"];
    return { names, courses: top };
  }
  function rawValue(D, i, name) {
    const F = D.F, r = D.rows[i];
    if (name in F) return F[name][i];
    switch (name) {
      case "log_runs": return Math.log1p(F.h_runs[i]);
      case "log_days": return fin(F.h_days_since[i]) ? Math.log1p(Math.max(0, F.h_days_since[i])) : nan;
      case "layoff_long": return fin(F.h_days_since[i]) ? (F.h_days_since[i] > 90 ? 1 : 0) : nan;
      case "log_runs_league": return Math.log1p(F.h_runs_in_league[i]);
      case "log_j_rides": return Math.log1p(F.j_rides[i]);
      case "log_t_rides": return Math.log1p(F.t_rides[i]);
      case "dist_change_400": return F.h_dist_change[i] / 400;
      case "abs_dist_change_400": return Math.abs(F.h_dist_change[i]) / 400;
      case "no_history": return F.h_runs[i] === 0 ? 1 : 0;
      case "sex_f": return r.sex === "牝" ? 1 : 0;
      case "sex_g": return r.sex === "セ" ? 1 : 0;
      case "sq_fp_mean5": return F.h_fp_mean5[i] ** 2;
      case "sq_tb_mean5": return F.h_tb_mean5[i] ** 2;
      case "frame_x_short": return r.distance <= 1400 ? F.frame_pct[i] : 0;
    }
    if (name.startsWith("frame@")) return r.course === name.slice(6) ? F.frame_pct[i] : 0;
    return nan;
  }
  function design(D, idx, spec, fitStats) {
    const p = spec.names.length, X = new Float32Array(idx.length * p);
    if (fitStats) {
      spec.mean = new Array(p).fill(0); spec.std = new Array(p).fill(1);
      for (let j = 0; j < p; j++) {
        let s = 0, ss = 0, c = 0;
        for (const i of idx) { const v = rawValue(D, i, spec.names[j]); if (fin(v)) { s += v; ss += v * v; c++; } }
        const m = c ? s / c : 0, sd = c ? Math.sqrt(Math.max(ss / c - m * m, 0)) : 0;
        spec.mean[j] = m; spec.std[j] = sd > 1e-9 ? sd : 1;
      }
    }
    idx.forEach((i, r) => {
      for (let j = 0; j < p; j++) {
        const v = rawValue(D, i, spec.names[j]);
        X[r * p + j] = fin(v) ? (v - spec.mean[j]) / spec.std[j] : 0; // 欠けは平均で埋める
      }
    });
    return X;
  }
  // idx（行番号）をレースごとの区切りにする
  function raceSlices(D, idx) {
    const out = []; let s = 0;
    for (let k = 1; k <= idx.length; k++) {
      if (k === idx.length || D.rows[idx[k]].race_id !== D.rows[idx[s]].race_id) { out.push([s, k]); s = k; }
    }
    return out;
  }
  function scores(X, p, w, m) { const s = new Float64Array(m); for (let r = 0; r < m; r++) { let v = 0; const o = r * p; for (let j = 0; j < p; j++) v += X[o + j] * w[j]; s[r] = v; } return s; }
  function softmaxSlices(s, slices) {
    const out = new Float64Array(s.length);
    for (const [a, b] of slices) {
      let mx = -Infinity; for (let k = a; k < b; k++) mx = Math.max(mx, s[k]);
      let z = 0; for (let k = a; k < b; k++) { out[k] = Math.exp(s[k] - mx); z += out[k]; }
      for (let k = a; k < b; k++) out[k] /= z;
    }
    return out;
  }
  function winnerIndex(D, idx, a, b) { for (let k = a; k < b; k++) if (D.rows[idx[k]].finish_pos === 1) return k; return -1; }

  function fitLogit(D, idx, spec, progress) {
    // 時間順の最後 15% を早期打ち切りの確認用に使う
    const days = idx.map((i) => D.rows[i].day).sort((a, b) => a - b), cut = days[Math.floor(days.length * 0.85)];
    const tr = idx.filter((i) => D.rows[i].day < cut), va = idx.filter((i) => D.rows[i].day >= cut);
    const p = spec.names.length;
    const Xt = design(D, tr, spec, true), Xv = design(D, va, spec, false);
    const st = raceSlices(D, tr).map(([a, b]) => [a, b, winnerIndex(D, tr, a, b)]).filter((x) => x[2] >= 0);
    const sv = raceSlices(D, va).map(([a, b]) => [a, b, winnerIndex(D, va, a, b)]).filter((x) => x[2] >= 0);
    if (st.length < 50) throw new Error("学習に使えるレースが少なすぎます（勝ち馬のあるレースが50未満）");
    const lambda = 1e-3, lr = 0.05, b1 = 0.9, b2 = 0.999;
    let w = new Float64Array(p), m1 = new Float64Array(p), m2 = new Float64Array(p), best = w.slice(), bestLoss = Infinity, bad = 0;
    const nll = (X, sl, w) => {
      const s = scores(X, p, w, X.length / p); let L = 0;
      for (const [a, b, win] of sl) { let mx = -Infinity; for (let k = a; k < b; k++) mx = Math.max(mx, s[k]); let z = 0; for (let k = a; k < b; k++) z += Math.exp(s[k] - mx); L += Math.log(z) + mx - s[win]; }
      return L / sl.length;
    };
    for (let it = 1; it <= 400; it++) {
      const s = scores(Xt, p, w, tr.length), g = new Float64Array(p);
      for (const [a, b, win] of st) {
        let mx = -Infinity; for (let k = a; k < b; k++) mx = Math.max(mx, s[k]);
        let z = 0; for (let k = a; k < b; k++) z += Math.exp(s[k] - mx);
        for (let k = a; k < b; k++) {
          const q = Math.exp(s[k] - mx) / z - (k === win ? 1 : 0), o = k * p;
          if (q !== 0) for (let j = 0; j < p; j++) g[j] += q * Xt[o + j];
        }
      }
      for (let j = 0; j < p; j++) {
        const gj = g[j] / st.length + lambda * w[j];
        m1[j] = b1 * m1[j] + (1 - b1) * gj; m2[j] = b2 * m2[j] + (1 - b2) * gj * gj;
        w[j] -= lr * (m1[j] / (1 - b1 ** it)) / (Math.sqrt(m2[j] / (1 - b2 ** it)) + 1e-8);
      }
      if (it % 5 === 0) {
        const L = sv.length ? nll(Xv, sv, w) : nll(Xt, st, w);
        if (L < bestLoss - 1e-5) { bestLoss = L; best = w.slice(); bad = 0; } else if (++bad >= 8) break;
        if (progress && it % 25 === 0) progress(`能力モデルを学習中…（${it}回目）`);
      }
    }
    spec.w = Array.from(best);
    return spec;
  }
  function modelProb(D, idx, spec) {
    const X = design(D, idx, spec, false), s = scores(X, spec.names.length, spec.w, idx.length);
    return softmaxSlices(s, raceSlices(D, idx));
  }
  function marketProb(D, idx) {
    const sl = raceSlices(D, idx), out = new Float64Array(idx.length);
    for (const [a, b] of sl) {
      let z = 0;
      for (let k = a; k < b; k++) { const o = D.rows[idx[k]].win_odds; out[k] = 1 / (fin(o) ? Math.max(o, 1) : 999); z += out[k]; }
      for (let k = a; k < b; k++) out[k] /= z;
    }
    return out;
  }
  function nelderMead(f, x0, iters = 200) {
    let pts = [x0, [x0[0] + 0.3, x0[1]], [x0[0], x0[1] + 0.3]].map((x) => ({ x, v: f(x) }));
    for (let it = 0; it < iters; it++) {
      pts.sort((a, b) => a.v - b.v);
      const [B, G, W] = pts, c = [(B.x[0] + G.x[0]) / 2, (B.x[1] + G.x[1]) / 2];
      const at = (t) => [c[0] + t * (W.x[0] - c[0]), c[1] + t * (W.x[1] - c[1])];
      const r = at(-1), vr = f(r);
      if (vr < B.v) { const e = at(-2), ve = f(e); pts[2] = ve < vr ? { x: e, v: ve } : { x: r, v: vr }; }
      else if (vr < G.v) pts[2] = { x: r, v: vr };
      else {
        const k = at(0.5), vk = f(k);
        if (vk < W.v) pts[2] = { x: k, v: vk };
        else pts = [B, ...[G, W].map((P) => { const x = [(P.x[0] + B.x[0]) / 2, (P.x[1] + B.x[1]) / 2]; return { x, v: f(x) }; })];
      }
      if (Math.abs(pts[0].v - pts[2].v) < 1e-9) break;
    }
    pts.sort((a, b) => a.v - b.v);
    return pts[0].x;
  }
  function fitBlend(D, idx, spec) {
    const sl = raceSlices(D, idx), lm = modelProb(D, idx, spec), lq = marketProb(D, idx);
    const LM = lm.map((v) => Math.log(Math.max(v, 1e-6))), LQ = lq.map((v) => Math.log(Math.max(v, 1e-6)));
    const wins = sl.map(([a, b]) => winnerIndex(D, idx, a, b));
    const f = ([a, b]) => {
      let L = 0;
      sl.forEach(([s, e], r) => {
        const w = wins[r]; if (w < 0) return;
        let mx = -Infinity; for (let k = s; k < e; k++) mx = Math.max(mx, a * LM[k] + b * LQ[k]);
        let z = 0; for (let k = s; k < e; k++) z += Math.exp(a * LM[k] + b * LQ[k] - mx);
        L += Math.log(z) + mx - (a * LM[w] + b * LQ[w]);
      });
      return L;
    };
    const [a, b] = nelderMead(f, [0.5, 0.5]);
    return { a, b };
  }
  function trainModel(D, trainIdx, calibIdx, progress) {
    const spec = modelSpec(D, trainIdx);
    fitLogit(D, trainIdx, spec, progress);
    progress && progress("オッズとの合成係数を決めています…");
    const { a, b } = fitBlend(D, calibIdx, spec);
    return { kind: "logit", version: 1, ...spec, a, b, g2: 0.81, g3: 0.65 };
  }
  // 各行に model_p / market_p / p を付ける
  function predictIdx(D, idx, model) {
    const sl = raceSlices(D, idx), mp = modelProb(D, idx, model), qp = marketProb(D, idx), p = new Float64Array(idx.length);
    for (const [a, b] of sl) {
      const allOdds = idx.slice(a, b).every((i) => fin(D.rows[i].win_odds));
      if (!allOdds) { for (let k = a; k < b; k++) p[k] = mp[k]; continue; }
      let mx = -Infinity; const z = [];
      for (let k = a; k < b; k++) { const v = model.a * Math.log(Math.max(mp[k], 1e-6)) + model.b * Math.log(Math.max(qp[k], 1e-6)); z.push(v); mx = Math.max(mx, v); }
      let s = 0; z.forEach((v, j) => { p[a + j] = Math.exp(v - mx); s += p[a + j]; });
      for (let k = a; k < b; k++) p[k] /= s;
    }
    return { slices: sl, model_p: mp, market_p: qp, p };
  }
  function importance(model) {
    return model.names.map((n, j) => ({ name: n, weight: model.w[j] }))
      .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)).slice(0, 12);
  }

  /* ================= 組み合わせの確率（probs.py） ================= */
  function comboProbs(pIn, g2 = 0.81, g3 = 0.65) {
    const n = pIn.length, tot = pIn.reduce((a, b) => a + b, 0), p = pIn.map((v) => v / tot);
    const M = () => Array.from({ length: n }, () => new Float64Array(n));
    const ex = M(), m12 = M(), m13 = M(), m23 = M(), wide = M(), quinella = M(), place3 = new Float64Array(n);
    const q2 = p.map((v) => v ** g2), q3 = p.map((v) => v ** g3);
    const s2 = q2.reduce((a, b) => a + b, 0), s3 = q3.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      ex[i][j] = p[i] * q2[j] / (s2 - q2[i]);
      const d3 = s3 - q3[i] - q3[j];
      if (!(d3 > 0)) continue;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const t = ex[i][j] * q3[k] / d3;
        m12[i][j] += t; m13[i][k] += t; m23[j][k] += t; place3[i] += t; place3[j] += t; place3[k] += t;
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      quinella[i][j] = ex[i][j] + ex[j][i];
      wide[i][j] = m12[i][j] + m12[j][i] + m13[i][j] + m13[j][i] + m23[i][j] + m23[j][i];
    }
    return { win: p, exacta: ex, quinella, wide, place3 };
  }

  /* ================= 買い目（strategy.py） ================= */
  function defaultConfig(league = "jra") {
    return {
      league, bankroll: 100000, kelly: 0.15, max_race: 0.03, unit: 100, bets: BET_TYPES.slice(),
      min_ev: { win: 1.15, quinella: 1.2, wide: 1.15, exacta: 1.3 },
      min_prob: { win: 0.05, quinella: 0.02, wide: 0.05, exacta: 0.015 },
      max_odds: { win: 30, quinella: 80, wide: 30, exacta: 150 },
      min_honmei_p: 0.06, min_taikou_p: 0.04, est_odds_haircut: 0.85, g2: 0.81, g3: 0.65,
    };
  }
  function mergeConfig(c) {
    const d = defaultConfig(c && c.league);
    if (!c) return d;
    for (const k of ["bankroll", "kelly", "max_race"]) if (fin(+c[k])) d[k] = +c[k];
    if (Array.isArray(c.bets)) d.bets = c.bets.slice();
    for (const t of BET_TYPES) if (c.min_ev && fin(+c.min_ev[t])) d.min_ev[t] = +c.min_ev[t];
    return d;
  }
  function estimateOdds(winOdds, g2, g3, payback) {
    const inv = winOdds.map((o) => 1 / Math.max(o, 1)), cp = comboProbs(inv, g2, g3), out = {};
    for (const t of ["quinella", "wide", "exacta"]) {
      out[t] = cp[t].map((row) => Array.from(row, (v) => Math.round(Math.min(Math.max(payback[t] / v, 1), 9999) * 10) / 10));
    }
    return out;
  }
  // race = [{number, p, win_odds, ...}]、odds = {quinella: {"3-7": 12.3}, ...}
  function recommend(race, cfg, odds) {
    race = race.filter((h) => fin(h.p)).sort((a, b) => a.number - b.number);
    const n = race.length, num = race.map((h) => h.number);
    if (n < 2) return null;
    const cp = comboProbs(race.map((h) => h.p), cfg.g2, cfg.g3), winO = race.map((h) => h.win_odds);
    const payback = PAYBACK_BY_LEAGUE[cfg.league] || PAYBACK_BY_LEAGUE.jra;
    const est = estimateOdds(winO.map((o) => (fin(o) ? o : 999)), cfg.g2, cfg.g3, payback);
    const pos = new Map(num.map((x, i) => [x, i]));
    const P = {}, O = {}, E = {};
    P.win = cp.win.map(() => null); // 行 = ◎
    const mk = (f) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
    P.win = mk((i) => cp.win[i]); O.win = mk((i) => winO[i]); E.win = mk(() => false);
    for (const t of ["quinella", "wide", "exacta"]) {
      P[t] = mk((i, j) => cp[t][i][j]);
      O[t] = mk((i, j) => est[t][i][j] * cfg.est_odds_haircut); E[t] = mk(() => true);
      const table = odds && odds[t];
      if (table) for (const [combo, o] of Object.entries(table)) {
        const [a, b] = combo.split("-").map(Number);
        if (!pos.has(a) || !pos.has(b)) continue;
        const i = pos.get(a), j = pos.get(b);
        O[t][i][j] = o; E[t][i][j] = false;
        if (t !== "exacta") { O[t][j][i] = o; E[t][j][i] = false; }
      }
    }
    const stakes = {}, score = mk(() => 0);
    for (const t of BET_TYPES) {
      stakes[t] = mk(() => 0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const p = P[t][i][j], o = O[t][i][j], ev = p * o;
        const ok = cfg.bets.includes(t) && ev >= cfg.min_ev[t] && p >= cfg.min_prob[t] && o <= cfg.max_odds[t] && fin(o) && o > 1;
        if (!ok) continue;
        const f = Math.max(0, (p * o - 1) / (o - 1)) * cfg.kelly, s = f * cfg.bankroll;
        stakes[t][i][j] = s; score[i][j] += s * (ev - 1);
      }
    }
    let bi = -1, bj = -1, best = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j || cp.win[i] < cfg.min_honmei_p || cp.win[j] < cfg.min_taikou_p) continue;
      if (score[i][j] > best) { best = score[i][j]; bi = i; bj = j; }
    }
    const table = race.map((h, i) => ({ ...h, place3_p: cp.place3[i], win_ev: cp.win[i] * winO[i] }));
    // 買い目の候補: 実オッズがこの倍率（need）以上なら買える組。券種ごとに的中率の高い順に3つ
    const candidates = [];
    for (const t of BET_TYPES) {
      if (!cfg.bets.includes(t)) continue;
      const seen = new Set(), list = [];
      const hp = cfg.min_honmei_p, tp = cfg.min_taikou_p;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j || (t === "win" && j !== (i ? 0 : 1))) continue; // 単勝は馬ごとに1回
        const w = cp.win, p = P[t][i][j];
        const okPair = t === "win" ? w[i] >= hp
          : t === "exacta" ? w[i] >= hp && w[j] >= tp
          : Math.min(w[i], w[j]) >= tp && Math.max(w[i], w[j]) >= hp; // 馬連・ワイドはどちらが◎でもよい
        if (!okPair || p < cfg.min_prob[t]) continue;
        const need = cfg.min_ev[t] / p;
        if (need > cfg.max_odds[t]) continue;
        const combo = t === "win" ? String(num[i]) : t === "exacta" ? `${num[i]}-${num[j]}` : [num[i], num[j]].sort((a, b) => a - b).join("-");
        if (seen.has(combo)) continue; seen.add(combo);
        list.push({ type: t, label: BET_LABEL[t], combo, prob: p, odds: O[t][i][j], estimated: E[t][i][j], need, ev: p * O[t][i][j] });
      }
      list.sort((a, b) => b.prob - a.prob); // オッズを入れ直しても並びが変わらないよう、的中率の順
      candidates.push(...list.slice(0, 3));
    }
    if (bi < 0) {
      const order = cp.win.map((v, i) => i).sort((a, b) => cp.win[b] - cp.win[a]);
      return { honmei: num[order[0]], taikou: num[order[1]], bets: [], table, candidates };
    }
    const bets = [];
    for (const t of BET_TYPES) {
      const s = stakes[t][bi][bj]; if (s <= 0) continue;
      const combo = t === "win" ? String(num[bi]) : t === "exacta" ? `${num[bi]}-${num[bj]}` : [num[bi], num[bj]].sort((a, b) => a - b).join("-");
      bets.push({ type: t, label: BET_LABEL[t], combo, prob: P[t][bi][bj], odds: O[t][bi][bj], ev: P[t][bi][bj] * O[t][bi][bj], stake: s, estimated: E[t][bi][bj] });
    }
    const total = bets.reduce((a, b) => a + b.stake, 0), cap = cfg.bankroll * cfg.max_race, scale = total > 0 ? Math.min(1, cap / total) : 1;
    for (const b of bets) b.stake = Math.max(1, Math.round(b.stake * scale / cfg.unit)) * cfg.unit;
    return { honmei: num[bi], taikou: num[bj], bets, table, candidates };
  }

  /* ================= 検証（backtest.py） ================= */
  function settle(bet, race, pay) {
    const top = race.filter((h) => fin(h.finish_pos)).sort((a, b) => a.finish_pos - b.finish_pos).map((h) => h.number);
    const nums = bet.combo.split("-").map(Number);
    let hit = false;
    if (bet.type === "win") hit = top.length >= 1 && nums[0] === top[0];
    else if (bet.type === "quinella") hit = top.length >= 2 && new Set([top[0], top[1]]).has(nums[0]) && new Set([top[0], top[1]]).has(nums[1]);
    else if (bet.type === "exacta") hit = top.length >= 2 && nums[0] === top[0] && nums[1] === top[1];
    else hit = top.length >= 3 && nums.every((x) => top.slice(0, 3).includes(x));
    if (!hit) return 0;
    const per100 = pay && pay.get(bet.type + "|" + bet.combo);
    return (fin(per100) ? per100 : bet.odds * 100) * bet.stake / 100;
  }
  function raceHorses(D, idx, pr, a, b) {
    const out = [];
    for (let k = a; k < b; k++) {
      const r = D.rows[idx[k]];
      out.push({ number: r.number, frame: r.frame, name: r.horse_name, win_odds: r.win_odds, finish_pos: r.finish_pos,
        p: pr.p[k], model_p: pr.model_p[k], market_p: pr.market_p[k] });
    }
    return out;
  }
  function leagueIdx(D, league, filter) {
    const out = [];
    for (let i = 0; i < D.rows.length; i++) { const r = D.rows[i]; if (r.league === league && filter(r, i)) out.push(i); }
    return out;
  }
  function walkForward(D, payouts, odds, cfg, progress) {
    const fin_ = (r) => fin(r.finish_pos);
    const years = [...new Set(D.rows.filter((r) => r.league === cfg.league).map((r) => r.year))].sort();
    const bets = [], preds = [], logs = [];
    for (const y of years.slice(2)) {
      const tr = leagueIdx(D, cfg.league, (r) => fin_(r) && r.year <= y - 2);
      const ca = leagueIdx(D, cfg.league, (r) => fin_(r) && r.year === y - 1);
      const te = leagueIdx(D, cfg.league, (r) => r.year === y && fin(r.win_odds));
      if (!tr.length || !ca.length || !te.length) continue;
      progress && progress(`${y}年を検証中…（${y - 2}年までで学習）`);
      const model = trainModel(D, tr, ca, progress);
      const pr = predictIdx(D, te, model);
      let ll = { m: 0, q: 0, p: 0, c: 0 };
      for (const [a, b] of pr.slices) {
        const race = raceHorses(D, te, pr, a, b), rid = D.rows[te[a]].race_id;
        const w = race.findIndex((h) => h.finish_pos === 1);
        if (w >= 0) { ll.m += Math.log(Math.max(race[w].model_p, 1e-12)); ll.q += Math.log(Math.max(race[w].market_p, 1e-12)); ll.p += Math.log(Math.max(race[w].p, 1e-12)); ll.c++; }
        preds.push({ race_id: rid, horses: race });
        if (race.filter((h) => fin(h.finish_pos)).length < 3) continue;
        const rec = recommend(race, cfg, odds[rid]);
        if (!rec) continue;
        for (const b of rec.bets) bets.push({ race_id: rid, day: D.rows[te[a]].day, year: y, ...b, ret: settle(b, race, payouts.get(rid)) });
      }
      logs.push(`[${y}] 合成係数 a(モデル)=${model.a.toFixed(2)} b(市場)=${model.b.toFixed(2)}  勝ち馬の平均対数尤度 モデル${(ll.m / ll.c).toFixed(3)} 市場${(ll.q / ll.c).toFixed(3)} 合成${(ll.p / ll.c).toFixed(3)}`);
    }
    return { bets, preds, logs };
  }
  function summaryData(bets, preds) {
    const out = { races: preds.length, bought_races: 0, by_type: [], ev_bands: [], by_year: [], profit: 0, max_drawdown: 0, baselines: [], curve: [] };
    for (const [name, key] of [["モデル単体の1位の単勝", "model_p"], ["合成確率の1位の単勝", "p"], ["1番人気の単勝", "market_p"]]) {
      let hit = 0, ret = 0, c = 0;
      for (const r of preds) {
        if (!r.horses.some((h) => fin(h.finish_pos))) continue;
        const top = r.horses.reduce((a, b) => (b[key] > a[key] ? b : a));
        c++; if (top.finish_pos === 1) { hit++; ret += top.win_odds; }
      }
      out.baselines.push({ name, hit_rate: c ? hit / c : 0, roi: c ? ret / c : 0 });
    }
    if (!bets.length) return out;
    bets = bets.slice().sort((a, b) => a.day - b.day);
    out.bought_races = new Set(bets.map((b) => b.race_id)).size;
    const row = (name, g) => {
      const st = g.reduce((a, b) => a + b.stake, 0), rt = g.reduce((a, b) => a + b.ret, 0), hits = g.filter((b) => b.ret > 0).length;
      return { name, bets: g.length, hits, hit_rate: g.length ? hits / g.length : 0, stake: st, return: rt, roi: st ? rt / st : 0,
        avg_odds: g.length ? g.reduce((a, b) => a + b.odds, 0) / g.length : 0 };
    };
    out.by_type = BET_TYPES.filter((t) => bets.some((b) => b.type === t)).map((t) => row(BET_LABEL[t], bets.filter((b) => b.type === t))).concat([row("合計", bets)]);
    const edges = [1.0, 1.15, 1.3, 1.5, 2.0, 99];
    for (const t of BET_TYPES) for (let e = 0; e < edges.length - 1; e++) {
      const g = bets.filter((b) => b.type === t && b.ev > edges[e] && b.ev <= edges[e + 1]);
      if (g.length) out.ev_bands.push({ bet_type: BET_LABEL[t], band: edges[e + 1] < 99 ? `${edges[e].toFixed(2)}〜${edges[e + 1].toFixed(2)}` : `${edges[e].toFixed(2)}〜`, ...row("", g) });
    }
    for (const y of [...new Set(bets.map((b) => b.year))].sort()) out.by_year.push({ year: y, ...row("", bets.filter((b) => b.year === y)) });
    let cum = 0, peak = 0, dd = 0; const curve = [];
    for (const b of bets) { cum += b.ret - b.stake; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); curve.push(cum); }
    const step = Math.max(1, Math.floor(curve.length / 300));
    out.curve = curve.filter((_, i) => i % step === 0).concat([cum]);
    out.profit = cum; out.max_drawdown = dd;
    return out;
  }

  /* ================= 架空データ（synthetic.py） ================= */
  function rng(seed) {
    let a = seed >>> 0;
    const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const normal = (m = 0, s = 1) => m + s * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
    const int = (lo, hi) => lo + Math.floor(u() * (hi - lo));
    const choice = (arr, probs) => { if (!probs) return arr[Math.floor(u() * arr.length)]; let x = u(); for (let i = 0; i < arr.length; i++) { x -= probs[i]; if (x < 0) return arr[i]; } return arr[arr.length - 1]; };
    const gumbel = (s) => -s * Math.log(-Math.log(1 - u() * 0.999999 + 1e-12));
    return { u, normal, int, choice, gumbel };
  }
  const COURSES = ["東京", "中山", "阪神", "京都", "中京", "新潟", "福島", "小倉", "札幌", "函館"];
  const NANKAN = [["浦和", [800, 1400, 1500, 2000], 12, 0.5], ["船橋", [1000, 1200, 1500, 1600, 1800], 14, 0.25],
    ["大井", [1000, 1200, 1400, 1600, 1800, 2000], 16, 0.1], ["川崎", [900, 1400, 1500, 1600, 2100], 14, 0.4]];
  function synth(league = "jra", nYears = 4, perYear = 600, seed = 1) {
    const R = rng(seed), nk = league === "nankan", PB = PAYBACK_BY_LEAGUE[league];
    const NH = 3000, NJ = 100, NT = 160;
    const ability = Array.from({ length: NH }, () => R.normal()), turf = Array.from({ length: NH }, () => R.normal(0, 0.5));
    const bestDist = Array.from({ length: NH }, () => R.choice([1200, 1400, 1600, 1800, 2000, 2400]));
    const jsk = Array.from({ length: NJ }, () => R.normal(0, 0.3)), tsk = Array.from({ length: NT }, () => R.normal(0, 0.2));
    const trainerOf = Array.from({ length: NH }, () => R.int(0, NT)), sex = Array.from({ length: NH }, () => R.choice(["牡", "牝", "セ"], [0.55, 0.4, 0.05]));
    const birth = Array.from({ length: NH }, () => 2020 - R.int(0, 6)), bw = Array.from({ length: NH }, () => Math.round(R.normal(480, 25)));
    const rows = [], pays = [], start = Date.UTC(2021, 0, 5) / 86400000;
    for (let r = 0; r < nYears * perYear; r++) {
      const yr = Math.floor(r / perYear), day = Math.round(Date.UTC(2021 + yr, 0, 5) / 86400000 + (r % perYear) / perYear * 350);
      const date = dayToStr(day), rid = date.replace(/-/g, "") + String(r).padStart(5, "0");
      let course, surface, dist, fs, inner;
      if (nk) { const c = NANKAN[r % 4]; course = c[0]; surface = "ダ"; dist = R.choice(c[1]); fs = R.int(7, c[2] + 1); inner = c[3]; }
      else { course = COURSES[r % COURSES.length]; surface = R.choice(["芝", "ダ"]); dist = R.choice([1200, 1400, 1600, 1800, 2000, 2400]); fs = R.int(8, 17); inner = 0; }
      const cls = R.int(1, 9);
      const order0 = ability.map((a, i) => [a + R.normal(0, 1.2) - (cls - 4.5) * 0.35, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const lo = Math.floor((cls - 1) / 8 * (NH - fs * 20)), pool = order0.slice(lo, lo + fs * 20);
      const horses = []; while (horses.length < fs) { const h = pool[R.int(0, pool.length)]; if (!horses.includes(h)) horses.push(h); }
      const jockeys = horses.map(() => R.int(0, NJ));
      const apt = horses.map((h) => turf[h] * (surface === "芝" ? 1 : -1) - Math.abs(bestDist[h] - dist) / 800);
      const strength = horses.map((h, k) => ability[h] + apt[k] + jsk[jockeys[k]] + tsk[trainerOf[h]] + inner * (1 - k / Math.max(fs - 1, 1)) * (1600 / Math.max(dist, 800)));
      const perf = strength.map((s) => s + R.gumbel(0.9));
      const order = perf.map((v, k) => k).sort((a, b) => perf[b] - perf[a]), finish = new Array(fs);
      order.forEach((k, pos) => (finish[k] = pos + 1));
      const mkt = horses.map((h, k) => ability[h] + 0.6 * apt[k] + jsk[jockeys[k]] * 1.5 + tsk[trainerOf[h]] + R.normal(0, 0.35));
      let q = mkt.map((m) => Math.exp(m / 0.9)); const qs = q.reduce((a, b) => a + b, 0); q = q.map((v) => v / qs);
      const winOdds = q.map((v) => Math.min(Math.max(Math.round(PB.win / v * 10) / 10, 1.1), 999.9));
      const pop = winOdds.map((o, k) => [o, k]).sort((a, b) => a[0] - b[0]).reduce((acc, [, k], i) => ((acc[k] = i + 1), acc), []);
      const base = dist / 16.5 + (surface === "ダ" ? 0.8 : 0), pmax = Math.max(...perf), pmean = perf.reduce((a, b) => a + b, 0) / fs;
      horses.forEach((h, k) => rows.push({
        race_id: rid, date, course, surface, league, distance: dist, going: R.choice(["良", "稍", "重", "不"], [0.7, 0.15, 0.1, 0.05]),
        race_class: cls, field_size: fs, horse_id: "H" + String(h).padStart(5, "0"), horse_name: "ホース" + h,
        frame: Math.min(8, Math.floor(k / 2) + 1), number: k + 1, sex: sex[h], age: 2021 + yr - birth[h], weight_carried: 55 + (sex[h] !== "牝" ? 2 : 0),
        jockey_id: "J" + String(jockeys[k]).padStart(3, "0"), trainer_id: "T" + String(trainerOf[h]).padStart(3, "0"),
        body_weight: bw[h] + R.int(-8, 9), body_weight_diff: R.int(-8, 9), win_odds: winOdds[k], popularity: pop[k],
        finish_pos: finish[k], time_sec: Math.round((base + (pmax - perf[k]) * 0.25) * 10) / 10,
        last3f: Math.round((35 - (perf[k] - pmean) * 0.3 + R.normal(0, 0.3)) * 10) / 10,
      }));
      const cp = comboProbs(q), [f1, f2, f3] = order, N = (k) => k + 1, srt = (a, b) => [N(a), N(b)].sort((x, y) => x - y).join("-");
      pays.push({ race_id: rid, bet_type: "win", combination: String(N(f1)), payout: Math.round(winOdds[f1] * 100) });
      pays.push({ race_id: rid, bet_type: "quinella", combination: srt(f1, f2), payout: Math.round(PB.quinella / cp.quinella[f1][f2] * 10) * 10 });
      pays.push({ race_id: rid, bet_type: "exacta", combination: `${N(f1)}-${N(f2)}`, payout: Math.round(PB.exacta / cp.exacta[f1][f2] * 10) * 10 });
      for (const [x, y] of [[f1, f2], [f1, f3], [f2, f3]]) pays.push({ race_id: rid, bet_type: "wide", combination: srt(x, y), payout: Math.max(100, Math.round(PB.wide / cp.wide[x][y] * 10) * 10) });
    }
    void start;
    const header = ["race_id", "date", "course", "surface", "league", "distance", "going", "race_class", "field_size", "horse_id", "horse_name",
      "frame", "number", "sex", "age", "weight_carried", "jockey_id", "trainer_id", "body_weight", "body_weight_diff", "win_odds", "popularity",
      "finish_pos", "time_sec", "last3f"];
    const lastIds = [...new Set(rows.map((r) => r.race_id))].slice(-2);
    const card = rows.filter((r) => lastIds.includes(r.race_id)).map((r) => ({ ...r, finish_pos: "", time_sec: "", last3f: "" }));
    return {
      results: toCSV(header, rows), payouts: toCSV(["race_id", "bet_type", "combination", "payout"], pays), card: toCSV(header, card),
      races: nYears * perYear,
    };
  }

  /* ================= 画面から使う窓口 ================= */
  function createSession() {
    const S = { text: {}, results: null, payouts: new Map(), odds: {}, card: null, models: {} };
    const parsed = (name) => {
      const t = S.text[name];
      if (!t) return null;
      if (name === "results" || name === "card") return loadResults(t);
      if (name === "payouts") return loadPayouts(t);
      if (name === "odds") return loadOdds(t);
    };
    const info = (rows) => {
      const races = new Set(rows.map((r) => r.race_id)), days = rows.map((r) => r.day);
      const lg = {}; for (const r of rows) lg[r.league] = (lg[r.league] || 0) + 1;
      return { rows: rows.length, races: races.size, from: dayToStr(Math.min(...days)), to: dayToStr(Math.max(...days)), leagues: lg };
    };
    let cacheD = null;
    const features = () => (cacheD ||= buildFeatures(S.results));
    return {
      setFile(name, text) {
        S.text[name] = text && text.trim() ? text : "";
        const v = S.text[name] ? parsed(name) : null;
        if (name === "results") { S.results = v; cacheD = null; }
        else if (name === "payouts") S.payouts = v || new Map();
        else if (name === "odds") S.odds = v || {};
        else if (name === "card") S.card = v;
        return this.status();
      },
      setModel(league, model) { S.models[league] = model; return this.status(); },
      status() {
        const files = {};
        if (S.results) files.results = info(S.results);
        if (S.card) files.card = info(S.card);
        if (S.payouts.size) files.payouts = { rows: [...S.payouts.values()].reduce((a, m) => a + m.size, 0), races: S.payouts.size };
        const no = Object.keys(S.odds).length; if (no) files.odds = { rows: Object.values(S.odds).reduce((a, d) => a + Object.values(d).reduce((x, m) => x + Object.keys(m).length, 0), 0), races: no };
        return { files, models: { jra: !!S.models.jra, nankan: !!S.models.nankan } };
      },
      synth(league, years) { return synth(league, years || 4); },
      backtest(c, progress) {
        if (!S.results) throw new Error("先に成績 results.csv を入れてください");
        const cfg = mergeConfig(c), D = features();
        const { bets, preds, logs } = walkForward(D, S.payouts, S.odds, cfg, progress);
        if (!preds.length) throw new Error(`${LEAGUE_LABEL[cfg.league]}のデータで検証できる年がありません。最低3年分（学習・合成係数・検証で1年ずつ）入れてください`);
        return { summary: summaryData(bets, preds), logs, estimated_odds: !Object.keys(S.odds).length };
      },
      train(league, progress) {
        if (!S.results) throw new Error("先に成績 results.csv を入れてください");
        const D = features();
        const all = leagueIdx(D, league, (r) => fin(r.finish_pos));
        if (!all.length) throw new Error(`${LEAGUE_LABEL[league]}のレースがありません（league 列か競馬場名を確認してください）`);
        const last = Math.max(...all.map((i) => D.rows[i].day)) - 365;
        const tr = all.filter((i) => D.rows[i].day <= last), ca = all.filter((i) => D.rows[i].day > last);
        if (!tr.length || !ca.length) throw new Error("データが1年分に足りません。最低2年分（できれば3年以上）入れてください");
        const model = trainModel(D, tr, ca, progress);
        model.trained_at = new Date().toISOString().slice(0, 10); model.league = league;
        S.models[league] = model;
        return { model, a: model.a, b: model.b, importance: importance(model) };
      },
      predict(c, oddsText) {
        const cfg = mergeConfig(c), model = S.models[cfg.league];
        if (!model) throw new Error("先に「学習」をしてください");
        if (!S.results) throw new Error("先に成績 results.csv を入れてください");
        if (!S.card) throw new Error("出馬表 card.csv を入れてください");
        const card = S.card.map((r) => ({ ...r, finish_pos: nan, time_sec: nan, last3f: nan }));
        const rids = [...new Set(card.map((r) => r.race_id))], pasted = parseOddsText(oddsText, rids);
        for (const [rid, d] of Object.entries(pasted)) for (const [num, o] of Object.entries(d.win || {}))
          for (const r of card) if (r.race_id === rid && r.number === +num) r.win_odds = o;
        const ridSet = new Set(rids);
        const D = buildFeatures(S.results.filter((r) => !ridSet.has(r.race_id)).concat(card));
        const idx = leagueIdx(D, cfg.league, (r) => ridSet.has(r.race_id));
        if (!idx.length) throw new Error(`出馬表に${LEAGUE_LABEL[cfg.league]}のレースがありません`);
        const pr = predictIdx(D, idx, model), races = [];
        for (const [a, b] of pr.slices) {
          const first = D.rows[idx[a]], rid = first.race_id, race = raceHorses(D, idx, pr, a, b);
          const od = {}; for (const src of [S.odds[rid], pasted[rid]]) if (src) for (const [t, m] of Object.entries(src)) if (t !== "win") Object.assign((od[t] ||= {}), m);
          const rec = recommend(race, cfg, od);
          if (!rec) continue;
          const horses = rec.table.slice().sort((x, y) => y.p - x.p).map((h) => ({ ...h, mark: h.number === rec.honmei ? "◎" : h.number === rec.taikou ? "○" : "" }));
          races.push({ race_id: rid, date: first.date, course: first.course, surface: first.surface, distance: first.distance,
            honmei: rec.honmei, taikou: rec.taikou, skip: !rec.bets.length, total: rec.bets.reduce((x, y) => x + y.stake, 0), bets: rec.bets, horses,
            candidates: rec.candidates });
        }
        return { races, a: model.a, b: model.b };
      },
    };
  }

  const api = { parseCSV, toCSV, loadResults, loadPayouts, loadOdds, parseOddsText, normalizeCombo, buildFeatures,
    comboProbs, recommend, defaultConfig, mergeConfig, estimateOdds, summaryData, synth, createSession, trainModel,
    predictIdx, leagueIdx, walkForward, PAYBACK_BY_LEAGUE, BET_LABEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KeibaEngine = api;
})(globalThis);
