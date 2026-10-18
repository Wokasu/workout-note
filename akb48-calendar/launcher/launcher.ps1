# AKB48 申込ランチャー（Windows）
# 推しが出る公演の申込ページを、Chromeのプロファイル（申込アカウント）ごとに順番に開く。
# ページを開くだけで、ログイン・入力・申込ボタンは自分で操作する。
#
# 使い方: launcher.bat をダブルクリック
# 準備: Chromeのプロファイル名を「AKB 01」「AKB 02」…のように「AKB」で始め、番号は2桁にしておく
param(
  [string]$Select,          # 開く公演の番号（例 "1-5"）。指定すると質問しない
  [switch]$DryRun,          # Chromeを起動せず、開く内容を表示するだけ
  [switch]$NoWait,          # Enterを待たずに次のアカウントへ進む（テスト用）
  [string]$LocalState = "$env:LOCALAPPDATA\Google\Chrome\User Data\Local State",
  [string]$Links = 'https://raw.githubusercontent.com/Wokasu/workout-note/akb48-calendar-feed/links.json',
  [string]$ProfilePrefix = 'AKB',
  [string]$ChromePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$weekdays = '日', '月', '火', '水', '木', '金', '土'

function Stop-WithMessage([string]$message) {
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  if (-not $NoWait) { [void](Read-Host 'Enterで閉じます') }
  exit 1
}

function Find-Chrome {
  if ($ChromePath) { return $ChromePath }
  foreach ($key in 'HKCU:', 'HKLM:') {
    $item = Get-ItemProperty "$key\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($item -and $item.'(default)' -and (Test-Path $item.'(default)')) { return $item.'(default)' }
  }
  foreach ($path in "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") {
    if ($path -and (Test-Path $path)) { return $path }
  }
  return $null
}

# Chromeの設定ファイルから、名前が「AKB」で始まるプロファイルを名前順に取り出す
function Get-Profiles {
  if (-not (Test-Path $LocalState)) { return @() }
  $state = Get-Content -Raw -Encoding UTF8 $LocalState | ConvertFrom-Json
  $state.profile.info_cache.PSObject.Properties |
    ForEach-Object { [pscustomobject]@{ Dir = $_.Name; Name = $_.Value.name } } |
    Where-Object { $_.Name -like "$ProfilePrefix*" } |
    Sort-Object Name
}

# 申込する公演の一覧。urls.txt があればそちらを優先（1行に1つURL）
function Get-Shows {
  $manual = Join-Path $here 'urls.txt'
  if (Test-Path $manual) {
    $urls = Get-Content -Encoding UTF8 $manual | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^https?://' }
    if ($urls) {
      Write-Host "urls.txt のURLを使います（$(@($urls).Count) 件）"
      return @($urls | ForEach-Object { [pscustomobject]@{ date = $null; time = $null; title = $_; members = @(); url = $_ } })
    }
  }
  if (Test-Path $Links) {
    $json = Get-Content -Raw -Encoding UTF8 $Links
  } else {
    $client = New-Object Net.WebClient
    $client.Encoding = [Text.Encoding]::UTF8
    $json = $client.DownloadString("$Links`?t=$([DateTime]::Now.Ticks)")
  }
  return @($json | ConvertFrom-Json)
}

function Format-Show($show) {
  if (-not $show.date) { return $show.title }
  $d = [datetime]::ParseExact($show.date, 'yyyy-MM-dd', $null)
  $time = if ($show.time) { $show.time } else { '--:--' }
  "{0}({1}) {2} {3}  {4}" -f $d.ToString('MM/dd'), $weekdays[[int]$d.DayOfWeek], $time, $show.title, ($show.members -join '・')
}

# "1-5" や "1,3,4" を番号の配列にする
function Expand-Selection([string]$text, [int]$max) {
  $numbers = foreach ($part in ($text -split '[,、\s]+' | Where-Object { $_ })) {
    if ($part -match '^(\d+)\s*[-~～]\s*(\d+)$') { [int]$matches[1]..[int]$matches[2] }
    elseif ($part -match '^\d+$') { [int]$part }
    else { throw "番号の書き方が違います: $part" }
  }
  @($numbers | Where-Object { $_ -ge 1 -and $_ -le $max } | Select-Object -Unique)
}

Write-Host '=== AKB48 申込ランチャー ===' -ForegroundColor Magenta

$chrome = Find-Chrome
if (-not $chrome -and -not $DryRun) { Stop-WithMessage 'Google Chrome が見つかりませんでした。' }

$profiles = @(Get-Profiles)
if ($profiles.Count -eq 0) {
  Stop-WithMessage "名前が「$ProfilePrefix」で始まるChromeのプロファイルが見つかりませんでした。`nChromeのプロファイル名を「AKB 01」「AKB 02」…にしてから、もう一度実行してください。"
}
Write-Host "申込アカウント（Chromeのプロファイル）: $($profiles.Count) 個"

try { $shows = Get-Shows } catch { Stop-WithMessage "公演の一覧を読み込めませんでした: $($_.Exception.Message)" }
if ($shows.Count -eq 0) { Stop-WithMessage '申込できる公演がありません。' }

Write-Host ''
for ($i = 0; $i -lt $shows.Count; $i++) {
  $line = "[{0,2}] {1}" -f ($i + 1), (Format-Show $shows[$i])
  if ($shows[$i].url) { Write-Host $line } else { Write-Host "$line  ← 申込URL未設定" -ForegroundColor DarkGray }
}
Write-Host ''

if (-not $Select) {
  $Select = Read-Host '開く公演の番号を入力してください（例: 1-5 や 1,3,4）'
}
try { $picked = Expand-Selection $Select $shows.Count } catch { Stop-WithMessage $_.Exception.Message }
$targets = @($picked | ForEach-Object { $shows[$_ - 1] } | Where-Object { $_.url })
if ($targets.Count -eq 0) { Stop-WithMessage '申込URLのある公演が選ばれていません。' }

Write-Host ''
Write-Host "次の $($targets.Count) 公演を、$($profiles.Count) 個のアカウントで1つずつ開きます:" -ForegroundColor Cyan
$targets | ForEach-Object { Write-Host "  - $(Format-Show $_)" }

for ($p = 0; $p -lt $profiles.Count; $p++) {
  $prof = $profiles[$p]
  Write-Host ''
  Write-Host ("[{0}/{1}] {2} で開きます" -f ($p + 1), $profiles.Count, $prof.Name) -ForegroundColor Yellow
  $arguments = @("--profile-directory=`"$($prof.Dir)`"", '--new-window') + @($targets | ForEach-Object { $_.url })
  if ($DryRun) {
    Write-Host "  chrome $($arguments -join ' ')"
  } else {
    Start-Process -FilePath $chrome -ArgumentList $arguments
  }
  if ($NoWait -or $p -eq $profiles.Count - 1) { continue }
  $answer = Read-Host '  申し込みが終わったら Enter で次のアカウントへ（q で終了）'
  if ($answer -eq 'q') { break }
}

Write-Host ''
Write-Host 'おつかれさまでした！' -ForegroundColor Magenta
if (-not $NoWait) { [void](Read-Host 'Enterで閉じます') }
