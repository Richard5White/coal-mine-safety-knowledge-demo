param([string]$OutputName = "coal-mine-kg-demo")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot "video_output"
$captureDir = Join-Path $outputDir "captures"
$audioDir = Join-Path $outputDir "audio"
$items = Get-Content -LiteralPath (Join-Path $PSScriptRoot "narration.json") -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-WaveDuration([string]$Path) {
    $stream = [IO.File]::OpenRead($Path); $reader = New-Object IO.BinaryReader($stream)
    try {
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne "RIFF") { throw "Invalid WAV: $Path" }
        [void]$reader.ReadInt32()
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne "WAVE") { throw "Invalid WAV: $Path" }
        $byteRate = 0; $dataSize = 0
        while ($stream.Position -lt $stream.Length) {
            $chunkId = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)); $chunkSize = $reader.ReadInt32()
            if ($chunkId -eq "fmt ") {
                [void]$reader.ReadInt16(); [void]$reader.ReadInt16(); [void]$reader.ReadInt32(); $byteRate = $reader.ReadInt32()
                $remaining = $chunkSize - 12; if ($remaining -gt 0) { [void]$reader.ReadBytes($remaining) }
            } elseif ($chunkId -eq "data") { $dataSize = $chunkSize; break }
            else { [void]$reader.ReadBytes($chunkSize) }
        }
        if ($byteRate -le 0 -or $dataSize -le 0) { throw "Cannot read WAV duration: $Path" }
        return [double]$dataSize / [double]$byteRate
    } finally { $reader.Close(); $stream.Close() }
}

function Format-SrtTime([double]$Seconds) {
    $span = [TimeSpan]::FromSeconds($Seconds)
    return "{0:00}:{1:00}:{2:00},{3:000}" -f [math]::Floor($span.TotalHours),$span.Minutes,$span.Seconds,$span.Milliseconds
}

$cursorPoints = @($null,@(1710,625),@(165,295),@(1215,585),@(1260,475),@(1460,175),@(720,435),@(1110,590),@(1020,540),@(775,680),@(1810,370),@(1150,690),@(145,420))
$durations=@(); $srtLines=[Collections.Generic.List[string]]::new(); $scriptLines=[Collections.Generic.List[string]]::new(); $elapsed=0.0
for ($i=0; $i -lt $items.Count; $i++) {
    $item=$items[$i]; $duration=Get-WaveDuration (Join-Path $audioDir ($item.id+".wav")); $durations += $duration
    $srtLines.Add([string]($i+1)); $srtLines.Add("$(Format-SrtTime $elapsed) --> $(Format-SrtTime ($elapsed+$duration))"); $srtLines.Add($item.text); $srtLines.Add("")
    $scriptLines.Add("[$($item.chapter)]"); $scriptLines.Add($item.text); $scriptLines.Add(""); $elapsed += $duration + .20
}
$srtPath=Join-Path $outputDir ($OutputName+".srt"); $scriptPath=Join-Path $outputDir ($OutputName+"-script.txt")
[IO.File]::WriteAllLines($srtPath,$srtLines,[Text.UTF8Encoding]::new($true)); [IO.File]::WriteAllLines($scriptPath,$scriptLines,[Text.UTF8Encoding]::new($true))

$ppt=New-Object -ComObject PowerPoint.Application; $ppt.Visible=-1; $presentation=$ppt.Presentations.Add()
$presentation.PageSetup.SlideWidth=960; $presentation.PageSetup.SlideHeight=540; $w=$presentation.PageSetup.SlideWidth; $h=$presentation.PageSetup.SlideHeight
try {
    for ($i=0; $i -lt $items.Count; $i++) {
        $item=$items[$i]; $capturePath=Join-Path $captureDir ($item.id+".png"); $audioPath=Join-Path $audioDir ($item.id+".wav")
        if (!(Test-Path -LiteralPath $capturePath)) { throw "Missing capture: $capturePath" }; if (!(Test-Path -LiteralPath $audioPath)) { throw "Missing audio: $audioPath" }
        $slide=$presentation.Slides.Add($i+1,12); [void]$slide.Shapes.AddPicture($capturePath,0,-1,0,0,$w,$h)
        $shade=$slide.Shapes.AddShape(1,0,$h-74,$w,74); $shade.Fill.ForeColor.RGB=2363401; $shade.Fill.Transparency=.12; $shade.Line.Visible=0
        $chapter=$slide.Shapes.AddTextbox(1,22,$h-65,220,16); $chapter.TextFrame.TextRange.Text="CHAPTER  "+$item.chapter
        $chapter.TextFrame.TextRange.Font.Name="Microsoft YaHei"; $chapter.TextFrame.TextRange.Font.Size=10; $chapter.TextFrame.TextRange.Font.Bold=-1; $chapter.TextFrame.TextRange.Font.Color.RGB=64600
        $caption=$slide.Shapes.AddTextbox(1,22,$h-47,$w-44,42); $caption.TextFrame.MarginLeft=0; $caption.TextFrame.MarginRight=0; $caption.TextFrame.MarginTop=0; $caption.TextFrame.MarginBottom=0
        $caption.TextFrame.WordWrap=-1; $caption.TextFrame.TextRange.Text=$item.text; $caption.TextFrame.TextRange.Font.Name="Microsoft YaHei"; $caption.TextFrame.TextRange.Font.Size=13; $caption.TextFrame.TextRange.Font.Color.RGB=16777215
        $point=$cursorPoints[$i]
        if ($null -ne $point) {
            $x=[double]$point[0]/1920*$w; $y=[double]$point[1]/1080*$h
            $ring=$slide.Shapes.AddShape(9,$x-9,$y-9,18,18); $ring.Fill.Visible=0; $ring.Line.ForeColor.RGB=31197; $ring.Line.Weight=2.25
            $dot=$slide.Shapes.AddShape(9,$x-2.5,$y-2.5,5,5); $dot.Fill.ForeColor.RGB=31197; $dot.Line.Visible=0
        }
        $media=$slide.Shapes.AddMediaObject2($audioPath,0,-1,-100,-100,5,5); $media.AnimationSettings.PlaySettings.PlayOnEntry=-1; $media.AnimationSettings.PlaySettings.HideWhileNotPlaying=-1; $media.AnimationSettings.PlaySettings.StopAfterSlides=1
        $slide.SlideShowTransition.AdvanceOnClick=0; $slide.SlideShowTransition.AdvanceOnTime=-1; $slide.SlideShowTransition.AdvanceTime=$durations[$i]+.20
    }
    $pptxPath=Join-Path $outputDir ($OutputName+".pptx"); $videoPath=Join-Path $outputDir ($OutputName+".mp4")
    $presentation.SaveAs($pptxPath,24); if (Test-Path -LiteralPath $videoPath) { Remove-Item -LiteralPath $videoPath -Force }
    Write-Output "Timeline saved: $pptxPath"; Write-Output ("Narration duration: {0:N2} seconds" -f ($durations|Measure-Object -Sum).Sum)
    $presentation.CreateVideo($videoPath,-1,5,1080,30,85); $last=-1; $started=Get-Date
    while ($true) {
        $status=$presentation.CreateVideoStatus; if ($status -ne $last) { Write-Output "CreateVideoStatus=$status"; $last=$status }
        if ($status -eq 3) { break }; if ($status -eq 4) { throw "PowerPoint video export failed" }; if (((Get-Date)-$started).TotalMinutes -gt 25) { throw "PowerPoint video export timed out" }
        Start-Sleep -Seconds 5
    }
    Write-Output "Video exported: $videoPath"
} finally {
    $presentation.Close(); $ppt.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ppt)
}
