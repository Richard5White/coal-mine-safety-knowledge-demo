$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$root = Split-Path -Parent $PSScriptRoot
$inputPath = (Resolve-Path (Join-Path $root "video_output\coal-mine-voiceover.wav")).Path
$outputDir = (Resolve-Path (Join-Path $root "video_output")).Path
$outputName = "coal-mine-voiceover.mp3"

[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Storage.StorageFolder, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Storage.CreationCollisionOption, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType=WindowsRuntime]
[void][Windows.Media.Transcoding.PrepareTranscodeResult, Windows.Media.Transcoding, ContentType=WindowsRuntime]
[void][Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media, ContentType=WindowsRuntime]
[void][Windows.Media.MediaProperties.AudioEncodingQuality, Windows.Media, ContentType=WindowsRuntime]

$genericAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

function Await-Result($operation, [Type]$type) {
    $task = $genericAsTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}
function Await-Action($operation) {
    while ([int]$operation.Status -eq 0) { Start-Sleep -Milliseconds 120 }
    if ([int]$operation.Status -eq 3) { throw "Media Foundation MP3 conversion failed: $($operation.ErrorCode)" }
    if ([int]$operation.Status -eq 2) { throw "Media Foundation MP3 conversion was canceled" }
    $operation.GetResults()
}

$inputFile = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($inputPath)) ([Windows.Storage.StorageFile])
$folder = Await-Result ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($outputDir)) ([Windows.Storage.StorageFolder])
$outputFile = Await-Result ($folder.CreateFileAsync($outputName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
$profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
$transcoder = [Windows.Media.Transcoding.MediaTranscoder]::new()
$prepared = Await-Result ($transcoder.PrepareFileTranscodeAsync($inputFile, $outputFile, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
if (-not $prepared.CanTranscode) { throw "Windows Media Foundation cannot transcode this WAV file: $($prepared.FailureReason)" }
Await-Action ($prepared.TranscodeAsync())
Write-Output (Join-Path $outputDir $outputName)
