# 競馬予想AI（JRA・南関東・個人用）🏇

中央（JRA）と南関東（浦和・船橋・大井・川崎）に対応しています。

◎ と ○ の2頭を選び、**回収率が上がる時だけ**次の買い目を出します。

- ◎ の単勝
- ◎-○ の馬連・ワイド
- 条件がそろえば ◎→○ の馬単

## Python なしで使う（ブラウザ版）

`web/` はブラウザだけで動く版です。インストール不要で、PC でもスマホでも開くだけで使えます。
データの読み込み・検証・学習・予想まで全部ブラウザの中で計算し、CSV もモデルもどこにも送りません
（同じブラウザに保存され、次に開いたときも残っています）。

- 能力モデルは **条件付きロジット**（レース内ソフトマックスの線形モデル。Benter の方法）。Python 版の LightGBM の代わり。
- それ以外（特徴量・オッズとの合成・2着3着の確率・期待値とケリーの買い目・ウォークフォワード検証）は Python 版と同じ計算。
  特徴量・組み合わせ確率・買い目が Python 版と一致することを確認済み。
- 締切直前のオッズは「馬連 3-7 12.5」のように貼り付けられる（ワイドは「4.1-4.8」と書けば下限を使う）。

```bash
python web/build.py   # web/engine.js を web/template.html に埋め込んで web/dist/index.html を作る
```

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
python -m keiba_ai.cli train    --results data/results.csv --model models/model_jra.pkl
python -m keiba_ai.cli predict  --results data/results.csv --card data/card.csv \
                                --odds data/odds_today.csv --bankroll 100000 --table

# 南関東は全部のコマンドに --league nankan を付ける（モデルは models/model_nankan.pkl に別に保存）
python -m keiba_ai.cli backtest --league nankan --results data/results.csv --payouts data/payouts.csv
python -m keiba_ai.cli train    --league nankan --results data/results.csv
python -m keiba_ai.cli predict  --league nankan --results data/results.csv --card data/card_oi.csv

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

## 南関東について

| | 中央 | 南関東 |
| --- | --- | --- |
| 払戻率 | 単勝80% 馬連・ワイド77.5% 馬単75% | 単勝80% 馬連・ワイド・馬単75% |
| モデル | `models/model_jra.pkl` | `models/model_nankan.pkl` |
| クラス（`race_class`） | 新馬・未勝利=1 … G1=8 | 未格付=1, C3=2 … A1=9, OP=10, S3=11 … Jpn1=15 |

- **主催ごとに別のモデル**を学習します（馬の層・騎手・コースがまったく違うため）。合成係数・期待値の基準も別。
- **中央と南関東を1つの CSV にまとめてよい。** `league` 列（`jra` / `nankan`）が無ければ競馬場名で判断します。
  まとめておくと、**中央からの転入馬**の中央時代の成績が特徴量に入ります（`h_from_jra`, `h_league_switch`）。
  クラスの物差しが違うので、主催をまたぐ「クラスの上下」は使いません。
- `race_class` は数値でも、`B1`・`C2`・`3勝` のような文字でもよい（`keiba_ai/schema.py` の `CLASS_SCALE` で数値に直す）。
- 南関東向けの特徴量: **同じ競馬場での成績**（`h_same_course_fp`）、**競馬場×距離**（`course_dist`）と馬番の組み合わせ
  （浦和・川崎のような小回りでは内枠の有利不利が大きい）。
- 南関東は1レースの売上が中央より小さいので、締切直前にオッズが大きく動きます。**実オッズは締切直前の値で判断**し、
  金額を厚くしすぎない（自分の馬券でオッズが下がる）こと。

### 南関東のデータ

JRA-VAN には地方競馬のデータがありません。地方競馬の公式データ配信（地方競馬全国協会）や、
南関東4場・地方競馬情報サイトの成績・払戻ページから、上と同じ列の CSV を作ります。サイトから取る場合は利用規約を確認すること。
最低3年分、できれば5年分以上。

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
