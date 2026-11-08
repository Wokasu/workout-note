# 競馬予想AI（JRA・個人用）🏇

◎ と ○ の2頭を選び、**回収率が上がる時だけ**次の買い目を出します。

- ◎ の単勝
- ◎-○ の馬連・ワイド
- 条件がそろえば ◎→○ の馬単

## しくみ（回収率のための設計）

```
過去の結果 ──▶ 特徴量 ──▶ 能力モデル(LightGBM) ──▶ モデルの勝率
                                                     │
単勝オッズ ─────────────────────────▶ 市場の勝率 ──┤ 合成（Benter型）
                                                     ▼
                                                最終の勝率 p
                                                     │ 2着・3着の補正つき Harville
                                                     ▼
                                   単勝・馬連・ワイド・馬単の的中率
                                                     │ × オッズ
                                                     ▼
                                期待値が基準を超える買い目だけ・ケリーで金額
```

1. **能力モデルにはオッズを入れない。** 過去走・騎手・調教師・距離適性などだけで勝率を出す。
2. **市場（オッズ）と合成する。** `p ∝ exp(a·log モデル + b·log 市場)`。a, b は学習に使っていない年で決める。
   市場はかなり正確なので、モデル単体で買うより必ず良くなる。a が 0 に近ければ「モデルに上乗せの力がない」という意味。
3. **的中率ではなく期待値で選ぶ。** ◎○ は「単勝◎・馬連・ワイド・馬単のうち期待値の基準を超える買い目の期待利益が最大になる組」。
   ◎ が1番人気になるとは限らない。
4. **買わないレースを作る。** 基準を満たす買い目がなければ「見送り」（◎○ は参考に表示）。控除率が 20〜25% あるので、ほとんどのレースは買うだけ損。
5. **金額は分数ケリー。** 期待値が大きく確率の高い買い目ほど厚く。1レースの上限は資金の 3%。
6. **大穴は買わない。** 勝率 6% 未満は ◎ に、4% 未満は ○ にしない。オッズの上限もある（推定誤差が大きいので）。

## 使い方

```bash
cd keiba-ai
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# 1) 動作確認（架空データ。数字に意味はない）
python -m keiba_ai.cli synth --out data
python -m keiba_ai.cli backtest --results data/results.csv --payouts data/payouts.csv

# 2) 本番: 自分のデータで検証 → 学習 → 予想
python -m keiba_ai.cli backtest --results data/results.csv --payouts data/payouts.csv
python -m keiba_ai.cli train    --results data/results.csv --model models/model.pkl
python -m keiba_ai.cli predict  --results data/results.csv --card data/card.csv \
                                --odds data/odds_today.csv --bankroll 100000 --table

pytest -q tests
```

出力の例:

```
■ レース 202505021011
  ◎ 7番 ○○○○  （勝率 7.2% / 単勝 19.7倍）
  ○ 4番 ××××  （勝率 14.9% / 単勝 6.3倍）
  単勝 7            300円   的中率  7.2%  オッズ   19.7  期待値 1.41
  ワイド 4-7         200円   的中率  5.9%  オッズ   22.0  期待値 1.30
  合計 500円
```

主なオプション: `--bankroll`（資金）, `--kelly 0.15`（ケリーの何割）, `--max-race 0.03`,
`--bets win,quinella,wide`（券種を絞る）, `--ev-win 1.2 --ev-wide 1.1 ...`（期待値の下限）。

## データ

`data/` は git に入れません（`.gitignore`）。必要なのは3つの CSV です。列の詳しい意味は `keiba_ai/schema.py`。

| ファイル | 1行 | 必須の列 |
| --- | --- | --- |
| `results.csv` | 1頭 × 1レース | race_id, date, course, surface, distance, going, race_class, field_size, horse_id, horse_name, frame, number, sex, age, weight_carried, jockey_id, trainer_id, body_weight, body_weight_diff, win_odds, popularity, finish_pos, time_sec, last3f |
| `payouts.csv` | 払戻1件 | race_id, bet_type(win/quinella/wide/exacta), combination(例 `3-7`), payout(100円あたり) |
| `odds.csv`（任意） | オッズ1件 | race_id, bet_type, combination, odds（ワイドは**下限**） |

`card.csv`（予想するレースの出馬表）は `results.csv` と同じ列で、結果の3列を空にしたもの。`win_odds` は**締切直前**の値を入れるほど精度が上がります。

### データの入手先

- **JRA-VAN データラボ（おすすめ）**: JRA 公式のデータ配信（月額制）。TARGET frontier JV などのソフトで過去の成績・払戻・オッズを CSV に書き出せる。
  過去の**馬連・ワイド・馬単のオッズ**も取れるので、バックテストが正確になる。
- netkeiba などのサイトから取る方法もあるが、各サイトの利用規約を確認すること（自動取得を禁止しているサイトが多い）。

最低でも **3年分**（学習・合成係数・検証で1年ずつ）、できれば 5〜10 年分。

## 回収率を上げるための調整の手順

1. `backtest` を実行し、券種ごと・**期待値の帯ごと**の回収率を見る。
2. 回収率が 100% を下回る帯は、その券種の `--ev-*` を上げて切る。点数が極端に減る券種は `--bets` で外す。
3. 合成係数 `a(モデル)` が年によってほぼ 0 なら、モデルに力がない。特徴量を足す（後述）のが先。
4. 調整は**最後の1年を見ずに**行い、最後に1回だけその年で確かめる（何度も見て合わせると過剰適合で、本番では回収率が落ちる）。
5. 本番は実オッズ（`--odds`）で判断する。推定オッズは割り引いて（×0.85）使っているが、ズレは残る。

### 精度を上げる余地（次の一手）

- タイム指数（コース・距離・馬場ごとの基準タイムで補正）
- 調教タイム、血統（父・母父の芝ダ・距離適性）、脚質と展開（通過順）
- 騎手の乗り替わり、休み明けの何戦目か、馬場の内外の有利不利
- 締切直前のオッズの動き（直前に売れた馬）

## 注意

- 個人用です。馬券は 20 歳から。過去の回収率は将来を保証しません。
- 架空データ（`synth`）の回収率は**意味がありません**。仕組みが動くかの確認用です。
