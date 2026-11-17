param([string]$FileName = "coal-mine-kg-demo.mp4")
$ErrorActionPreference = "Stop"
$video = (Resolve-Path (Join-Path (Split-Path -Parent $PSScriptRoot) ("video_output\" + $FileName))).Path
$wmp = New-Object -ComObject WMPlayer.OCX
try {
    $media = $wmp.newMedia($video)
    Start-Sleep -Milliseconds 500
    [pscustomobject]@{
        Path = $video
        DurationSeconds = [math]::Round($media.duration, 2)
        DurationText = $media.durationString
        SizeBytes = (Get-Item -LiteralPath $video).Length
    } | Format-List
} finally {
    $wmp.close()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wmp)
}
