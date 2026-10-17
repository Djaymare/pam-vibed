param([Parameter(Mandatory=$true)][string]$Manifest, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$pamItems = Get-Content -Raw -Encoding UTF8 -LiteralPath $Manifest | ConvertFrom-Json
$pamSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $pamFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  foreach ($pamItem in $pamItems) {
    $pamSynth.SelectVoice($pamItem.voice)
    $pamSynth.Rate = $pamItem.rate
    $pamSynth.SetOutputToWaveFile((Join-Path $OutputDirectory ($pamItem.id + '.wav')), $pamFormat)
    $pamSynth.Speak($pamItem.text)
    $pamSynth.SetOutputToNull()
  }
} finally { $pamSynth.Dispose() }
