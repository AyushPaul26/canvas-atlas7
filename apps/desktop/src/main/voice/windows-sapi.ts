import { join } from 'node:path';
import { runLocalProcess } from './process.js';

// The script never interpolates student text into executable code or SSML.
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' })
  if ($voices.Count -eq 0) { throw 'No installed offline English Windows voice. Add an English Speech voice in Windows Settings.' }
  if ($request.voice) { $chosen = @($voices | Where-Object { $_.VoiceInfo.Name -eq $request.voice }); if ($chosen.Count -eq 0) { throw 'Selected offline voice is unavailable' }; $synth.SelectVoice($chosen[0].VoiceInfo.Name) }
  else {
    $female = @($voices | Where-Object { $_.VoiceInfo.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female })
    $zira = @($female | Where-Object { $_.VoiceInfo.Name -like '*Zira*' })
    if ($zira.Count -gt 0) { $synth.SelectVoice($zira[0].VoiceInfo.Name) }
    elseif ($female.Count -gt 0) { $synth.SelectVoice($female[0].VoiceInfo.Name) }
    else { $synth.SelectVoice($voices[0].VoiceInfo.Name) }
  }
  if ($request.action -eq 'voices') {
    $result = @($voices | Sort-Object @{Expression={if ($_.VoiceInfo.Name -like '*Zira*') {0} elseif ($_.VoiceInfo.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female) {1} else {2}}} | ForEach-Object { @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name } })
    ConvertTo-Json -InputObject $result -Compress
  } elseif ($request.action -eq 'synthesize') {
    if (-not $request.text -or $request.text.Length -gt 600) { throw 'Invalid narration segment' }
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($request.output, $format)
    $synth.Speak([string]$request.text)
    $synth.SetOutputToNull()
  } else { throw 'Unknown local voice request' }
} finally { $synth.Dispose() }
`;
export function windowsPowerShell() {
  if (process.platform !== 'win32') throw Error('Local Windows voice is only available on Windows');
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
export function runPowerShell(scriptText: string, request: unknown, signal?: AbortSignal, timeoutMs = 60000) {
  return runLocalProcess(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(scriptText, 'utf16le').toString('base64')], { input: JSON.stringify(request), signal, timeoutMs });
}
export async function getOfflineVoices(signal?: AbortSignal): Promise<Array<{ name: string; culture: string }>> {
  const result = await runPowerShell(script, { action: 'voices' }, signal, 15000);
  const voices: unknown = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  if (!Array.isArray(voices) || !voices.length) throw Error('No installed offline English Windows voice');
  return voices as Array<{ name: string; culture: string }>;
}
export async function synthesizeWindows(text: string, output: string, voice?: string, signal?: AbortSignal) {
  await runPowerShell(script, { action: 'synthesize', text, output, voice }, signal);
}
