param([string]$VoiceName = "Microsoft Huihui Desktop", [int]$Rate = 1)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$timeline = Get-Content -LiteralPath (Join-Path $PSScriptRoot "voiceover_timeline.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$targetDir = Join-Path $root "video_output\voiceover_segments"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$voice = New-Object -ComObject SAPI.SpVoice
$token = $voice.GetVoices() | Where-Object { $_.GetDescription() -like ($VoiceName + "*") } | Select-Object -First 1
if (-not $token) { throw "Voice not found: $VoiceName" }
$voice.Voice = $token; $voice.Rate = $Rate; $voice.Volume = 100
foreach ($item in $timeline) {
    $path = Join-Path $targetDir ($item.id + ".wav")
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open($path, 3, $false)
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak($item.text)
    $stream.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    Write-Output $path
}
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
