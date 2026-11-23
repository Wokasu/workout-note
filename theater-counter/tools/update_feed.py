#!/usr/bin/env python3
"""劇場公演カウンター（アーティファクト版）の公演データを作り直す。

公式ブログから全公演を集め（collect_schedule.py）、前回のデータの過去の公演と合わせて、
アーティファクトの共有データ feed/schedule・feed/events に書く JSON を作る。
書き込み自体は Claude の ArtifactData ツールで行う（このスクリプトはファイルを作るだけ）。

使い方:
  python3 -I theater-counter/tools/update_feed.py <作業フォルダ> [前回の feed/schedule の JSON]
出力:
  <作業フォルダ>/docs/schedule.json  … feed/schedule に set する中身
  <作業フォルダ>/docs/events.json    … feed/events に set する中身（推しメンの公演。公開ブランチの events.json）
"""
import json, os, subprocess, sys, time
from datetime import date, timedelta

work = os.path.abspath(sys.argv[1])
prev_path = sys.argv[2] if len(sys.argv) > 2 else ''
here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.dirname(os.path.dirname(here))
os.makedirs(os.path.join(work, 'cache'), exist_ok=True)
os.makedirs(os.path.join(work, 'docs'), exist_ok=True)

# 先月・今月・来月のブログ一覧を読む（新しい記事を拾うため毎回読み直す）
t = date.today()
months = sorted({(t.replace(day=1) - timedelta(days=1)).strftime('%Y%m'), t.strftime('%Y%m'),
                 (t.replace(day=28) + timedelta(days=4)).strftime('%Y%m')})
new_path = os.path.join(work, 'schedule-new.json')
subprocess.run([sys.executable, '-I', os.path.join(here, 'collect_schedule.py'), os.path.join(work, 'cache'), new_path, *months], check=True)
new = json.load(open(new_path, encoding='utf-8'))

# 前回分と合わせる：今回読めた範囲は今回の内容、それより前（過去）の公演は前回の記録を残す
prev = []
if prev_path and os.path.exists(prev_path):
    d = json.load(open(prev_path, encoding='utf-8'))
    d = d.get('data', d)                       # ArtifactData の保存形式（data の中に本体）にも対応
    try:
        prev = json.loads(d['json'])['shows']
    except Exception:
        prev = []
key = lambda r: (r['date'], r['time'])
new_keys = {key(r) for r in new['shows']}
first_new = min((r['date'] for r in new['shows']), default='9999')
shows = sorted([r for r in prev if key(r) not in new_keys and r['date'] < first_new] + new['shows'], key=key)
if not new['shows']:
    sys.exit('公演を1件も読めませんでした（前回のデータを残すため、何も書き出しません）')
sched = {'version': 1, 'source': new.get('source', ''), 'asOf': new['asOf'], 'shows': shows}
now = int(time.time() * 1000)
json.dump({'json': json.dumps(sched, ensure_ascii=False), 'asOf': sched['asOf'], 'updatedAt': now},
          open(os.path.join(work, 'docs', 'schedule.json'), 'w', encoding='utf-8'), ensure_ascii=False)

# 推しメンの公演（3時間ごとに更新されている公開ブランチの events.json）
subprocess.run(['git', '-C', repo, 'fetch', '-q', 'origin', 'akb48-calendar-feed'], check=True)
ev = subprocess.run(['git', '-C', repo, 'show', 'FETCH_HEAD:events.json'], check=True, capture_output=True).stdout.decode('utf-8')
json.loads(ev)
json.dump({'json': ev, 'updatedAt': now}, open(os.path.join(work, 'docs', 'events.json'), 'w', encoding='utf-8'), ensure_ascii=False)

print(f'schedule: {len(shows)} 公演（{shows[0]["date"]}〜{shows[-1]["date"]}、今回 {len(new["shows"])} 件・前回から {len(shows) - len(new["shows"])} 件）')
print(f'docs: {os.path.join(work, "docs")}')
