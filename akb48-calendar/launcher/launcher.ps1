# AKB48 申込ランチャー（Windows）
# 推しが出る公演の申込ページを、Chromeのプロファイル（申込アカウント）ごとに順番に開く。
# ページを開くだけで、ログイン・入力・申込ボタンは自分で操作する。
#
# 使い方: launcher.bat をダブルクリックして、モードを選ぶ
#   1. 申込ページを開く … 選んだ公演の申込ページを、アカウントごとに順番に開く
#   2. ログイン確認    … チケットセンターを、アカウントごとに順番に開く（申込前にログインを確かめる）
#   3. 申込状況・キャンセル … 申込履歴のページを、全アカウントで一度に開く（キャンセルは自分でボタンを押す）
# 準備: Chromeのプロファイル名を「AKB 01」「AKB 02」…のように「AKB」で始め、番号は2桁にしておく
param(
  [ValidateSet('', 'apply', 'login', 'applications')]
  [string]$Mode,            # apply=申込ページを開く / login=ログイン確認 / applications=申込状況・キャンセル。指定すると質問しない
  [string]$Select,          # 開く公演の番号（例 "1-5"）。指定すると質問しない
  [switch]$DryRun,          # Chromeを起動せず、開く内容を表示するだけ
  [switch]$NoWait,          # Enterを待たずに次のアカウントへ進む（テスト用）
  [string]$LocalState = "$env:LOCALAPPDATA\Google\Chrome\User Data\Local State",
  [string]$Links = 'https://raw.githubusercontent.com/Wokasu/workout-note/akb48-calendar-feed/links.json',
  [string]$ProfilePrefix = 'AKB',
  [string]$LoginUrl = 'https://akb48.zaiko.io/ja',
  [string]$ApplicationsUrl = 'https://zaiko.io/account/applications',
  [string]$ChromePath,
  [switch]$UseSystemProxy   # 最初から Windows のプロキシ設定を使って読み込む
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

# URL の中身を文字列で読む。
# まず直接つなぎ（8秒で打ち切り）、つながらなければ Windows のプロキシ設定を使う（60秒まで待つ）。
# プロキシ設定の自動検出は時間がかかるので、見つかったプロキシは launcher-proxy.txt に覚えて次から直接使う
function Get-Text([string]$url) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $proxyFile = Join-Path $here 'launcher-proxy.txt'
  $saved = if (Test-Path $proxyFile) { (Get-Content -Raw $proxyFile).Trim() } else { '' }
  $read = {
    param($proxy, [int]$timeout)
    $request = [Net.HttpWebRequest]::Create($url)
    $request.Proxy = $proxy
    $request.Timeout = $timeout
    $request.ReadWriteTimeout = $timeout
    $response = $request.GetResponse()
    try { (New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd() } finally { $response.Close() }
  }
  if ($saved -and $saved -ne 'direct') {
    try { return & $read (New-Object Net.WebProxy($saved)) 20000 } catch { Write-Host "  覚えていたプロキシ（$saved）でつながりませんでした" -ForegroundColor DarkGray }
  }
  if (-not $UseSystemProxy) {
    try {
      $text = & $read $null 8000
      if ($saved -ne 'direct') { Set-Content -Path $proxyFile -Value 'direct' -Encoding ASCII }
      return $text
    } catch { Write-Host '  直接つながらないので、Windows のプロキシ設定で読み込みます（少し時間がかかります）…' -ForegroundColor DarkGray }
  }
  $system = [Net.WebRequest]::GetSystemWebProxy()
  $system.Credentials = [Net.CredentialCache]::DefaultCredentials
  $text = & $read $system 60000
  try {
    $via = $system.GetProxy([Uri]$url)
    Set-Content -Path $proxyFile -Value $(if ($via.Host -eq ([Uri]$url).Host) { 'direct' } else { $via.AbsoluteUri }) -Encoding ASCII
  } catch {}
  return $text
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
    return @($json | ConvertFrom-Json)
  }
  # 前回読めた一覧を残しておき、読み込めなかったときに使う
  $cache = Join-Path $here 'links-cache.json'
  Write-Host '公演の一覧を読み込んでいます…'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $json = Get-Text "$Links`?t=$([DateTime]::Now.Ticks)"
    Write-Host ("  {0:N1} 秒で読み込みました" -f $watch.Elapsed.TotalSeconds) -ForegroundColor DarkGray
    try { [IO.File]::WriteAllText($cache, $json, (New-Object Text.UTF8Encoding($false))) } catch {}
  } catch {
    if (-not (Test-Path $cache)) { throw }
    Write-Host "  読み込めなかったので、前回の一覧を使います（$((Get-Item $cache).LastWriteTime.ToString('M/d HH:mm')) 時点）: $($_.Exception.Message)" -ForegroundColor Yellow
    $json = Get-Content -Raw -Encoding UTF8 $cache
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

# アカウント（プロファイル）ごとに、Enterを押すたびに次のウィンドウでURLを開く
function Open-PerProfile([string[]]$urls, [string]$waitMessage) {
  for ($p = 0; $p -lt $profiles.Count; $p++) {
    $prof = $profiles[$p]
    Write-Host ''
    Write-Host ("[{0}/{1}] {2} で開きます" -f ($p + 1), $profiles.Count, $prof.Name) -ForegroundColor Yellow
    $arguments = @("--profile-directory=`"$($prof.Dir)`"", '--new-window') + $urls
    if ($DryRun) {
      Write-Host "  chrome $($arguments -join ' ')"
    } else {
      Start-Process -FilePath $chrome -ArgumentList $arguments
    }
    if ($NoWait -or $p -eq $profiles.Count - 1) { continue }
    $answer = Read-Host "  $waitMessage（q で終了）"
    if ($answer -eq 'q') { break }
  }
}

if (-not $Mode) {
  Write-Host ''
  Write-Host '  1. 申込ページを開く'
  Write-Host '  2. 全アカウントのログイン確認'
  Write-Host '  3. 申込状況の確認・キャンセル（全アカウントで一度に開く）'
  $Mode = switch (Read-Host '番号を選んでください') { '1' { 'apply' } '2' { 'login' } '3' { 'applications' } default { Stop-WithMessage '1〜3 を入力してください。' } }
}

if ($Mode -eq 'login') {
  Write-Host ''
  Write-Host "チケットセンターを $($profiles.Count) 個のアカウントで1つずつ開きます。" -ForegroundColor Cyan
  Write-Host '右上にログインボタンが出ていたら、ログインし直してください（パスワードは保存しておくと自動で入ります）。'
  Open-PerProfile @($LoginUrl) 'ログインできていたら Enter で次のアカウントへ'
  Write-Host ''
  Write-Host 'ログイン確認が終わりました！' -ForegroundColor Magenta
  if (-not $NoWait) { [void](Read-Host 'Enterで閉じます') }
  exit 0
}

if ($Mode -eq 'applications') {
  Write-Host ''
  Write-Host "申込状況のページを $($profiles.Count) 個のアカウントで一度に開きます。" -ForegroundColor Cyan
  Write-Host 'キャンセルしたい申込があれば、そのアカウントのウィンドウで取り消してください（取り消しは自分で操作します）。'
  foreach ($prof in $profiles) {
    $arguments = @("--profile-directory=`"$($prof.Dir)`"", '--new-window', $ApplicationsUrl)
    if ($DryRun) {
      Write-Host "  [$($prof.Name)] chrome $($arguments -join ' ')"
    } else {
      Write-Host "  [$($prof.Name)] を開きました"
      Start-Process -FilePath $chrome -ArgumentList $arguments
      Start-Sleep -Milliseconds 300 # 一度に起動するとChromeが取りこぼすことがあるので少し間をあける
    }
  }
  Write-Host ''
  Write-Host '全アカウントで開きました！' -ForegroundColor Magenta
  if (-not $NoWait) { [void](Read-Host 'Enterで閉じます') }
  exit 0
}

try { $shows = Get-Shows } catch { Stop-WithMessage "公演の一覧を読み込めませんでした: $($_.Exception.Message)" }
if ($shows.Count -eq 0) { Stop-WithMessage '申込できる公演がありません。' }

Write-Host ''
for ($i = 0; $i -lt $shows.Count; $i++) {
  $line = "[{0,2}] {1}" -f ($i + 1), (Format-Show $shows[$i])
  if ($shows[$i].url) { Write-Host $line } else { Write-Host "$line  ← まだ申込が始まっていません" -ForegroundColor DarkGray }
}
Write-Host ''

if (-not $Select) {
  $Select = Read-Host '開く公演の番号を入力してください（例: 1-5 や 1,3,4）'
}
try { $picked = Expand-Selection $Select $shows.Count } catch { Stop-WithMessage $_.Exception.Message }
$targets = @($picked | ForEach-Object { $shows[$_ - 1] } | Where-Object { $_.url })
if ($targets.Count -eq 0) { Stop-WithMessage '申込が始まっている公演が選ばれていません。' }

Write-Host ''
Write-Host "次の $($targets.Count) 公演を、$($profiles.Count) 個のアカウントで1つずつ開きます:" -ForegroundColor Cyan
$targets | ForEach-Object { Write-Host "  - $(Format-Show $_)" }

Open-PerProfile @($targets | ForEach-Object { $_.url }) '申し込みが終わったら Enter で次のアカウントへ'

Write-Host ''
Write-Host 'おつかれさまでした！' -ForegroundColor Magenta
if (-not $NoWait) { [void](Read-Host 'Enterで閉じます') }
