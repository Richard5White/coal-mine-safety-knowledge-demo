param(
    [string]$VoiceName = "Microsoft Kangkang",
    [int]$Rate = 1
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$narrationPath = Join-Path $PSScriptRoot "narration.json"
$audioDir = Join-Path $projectRoot "video_output\audio"
New-Item -ItemType Directory -Force -Path $audioDir | Out-Null

$items = Get-Content -LiteralPath $narrationPath -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object -ComObject SAPI.SpVoice
$voiceToken = $synth.GetVoices() | Where-Object { $_.GetDescription() -like ($VoiceName + "*") } | Select-Object -First 1
if (-not $voiceToken) { throw "未找到可导出的中文语音：$VoiceName" }
$synth.Voice = $voiceToken
$synth.Rate = $Rate
$synth.Volume = 100

foreach ($item in $items) {
    $target = Join-Path $audioDir ($item.id + ".wav")
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open($target, 3, $false)
    $synth.AudioOutputStream = $stream
    [void]$synth.Speak($item.text)
    $stream.Close()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    Write-Output $target
}

[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($synth)
