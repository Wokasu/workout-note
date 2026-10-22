# 申込ランチャーを Chrome を起動しないモードで動かし、出力を確かめる（Windows PowerShell 5.1 用）
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = & "$dir\launcher.ps1" -Mode apply -DryRun -NoWait -Select '1-3' -LocalState "$dir\test\Local State" -Links "$dir\test\links.json" -Hashira "$dir\test\hashira.txt" *>&1 | Out-String -Width 1000
Write-Host $out
$expected = @(
  '申込アカウント（Chromeのプロファイル）: 2 個',
  '[ 2] 11/09(月) 18:30 「ここからだ」公演  伊藤百花  ← まだ申込が始まっていません',
  '次の 2 公演を、2 個のアカウントで1つずつ開きます',
  '[1/2] AKB 01 柱の会 で開きます',
  '11/07(土) 12:30 「RESET」公演  伊藤百花  → 柱の会会員枠',
  '11/11(水) 19:00 「RESET」公演  奥本カイリ・渡邉葵心  → 公演ページ',
  'chrome --profile-directory="Profile 1" --new-window https://akb48.zaiko.io/apply/Test:Abc:12345 https://akb48.zaiko.io/ja/e/2026-reset-1111-1900',
  '[2/2] AKB 02 映像倉庫 で開きます'
)
foreach ($e in $expected) {
  if (-not $out.Contains($e)) { throw "出力に見つかりません: $e" }
}
if ($out.Contains('個人用')) { throw 'AKB以外のプロファイルが含まれています' }

# ログイン確認モード
$out = & "$dir\launcher.ps1" -Mode login -DryRun -NoWait -LocalState "$dir\test\Local State" *>&1 | Out-String -Width 1000
Write-Host $out
foreach ($e in @(
  'チケットセンターを 2 個のアカウントで1つずつ開きます。',
  'chrome --profile-directory="Profile 1" --new-window https://akb48.zaiko.io/ja',
  'chrome --profile-directory="Profile 2" --new-window https://akb48.zaiko.io/ja',
  'ログイン確認が終わりました！'
)) {
  if (-not $out.Contains($e)) { throw "出力に見つかりません: $e" }
}
Write-Host 'OK'
