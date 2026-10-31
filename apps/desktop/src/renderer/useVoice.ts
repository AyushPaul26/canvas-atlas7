import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioResult, VoiceStatus } from '@living-canvas/protocol';
import { bridge } from './bridge';
import { LocalSpeechPipeline, narrationPrefixAt } from './localSpeech';
import { clampVoiceRate, createAudioPlayback } from './audioPlayback';
import {requestSpeech} from './speechRequest';
export { encodeWave } from './audioEncoding';

type VoiceCallbacks = { onDraft?: (text: string) => void; onFinal?: (text: string) => void; onSpeechStart?: () => void };
type Capture = { context: AudioContext; stream: MediaStream; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode; pipeline: LocalSpeechPipeline };

export function useVoice(onTranscript: (text: string) => void, onError: (text: string) => void, options: VoiceCallbacks = {}) {
  const [status, setStatus] = useState<VoiceStatus>({ recognitionReady: false, synthesisReady: false });
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [draft, setDraft] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [echoSuspended, setEchoSuspended] = useState(false);
  const [timingEstimated, setTimingEstimated] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [rate, setRateState] = useState(() => {
    try { const saved = localStorage.getItem('canvas-atlas-voice-speed'); return saved === null ? .96 : clampVoiceRate(Number(saved)); }
    catch { return .96; }
  });
  const [headphones, setHeadphonesState] = useState(false);
  const [localVoice, setLocalVoice] = useState(false);
  const capture = useRef<Capture | null>(null);
  const playbackEpoch = useRef(0);
  const captureEpoch = useRef(0);
  const playingRef = useRef(false);
  const speakingRef = useRef(false);
  const openingCapture = useRef(false);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<AudioResult>>(Promise.resolve('completed'));
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const rateRef = useRef(rate); rateRef.current = rate;
  const headphonesRef = useRef(headphones); headphonesRef.current = headphones;
  const callbacks = useRef({ onTranscript, onError, ...options }); callbacks.current = { onTranscript, onError, ...options };
  const configurationRevision = useRef<number | undefined>(undefined);

  useEffect(() => {
    const update = (next: VoiceStatus) => {
      if (next.configurationRevision !== undefined && configurationRevision.current !== undefined && next.configurationRevision < configurationRevision.current) return;
      if (next.configurationRevision !== undefined && configurationRevision.current !== undefined && next.configurationRevision !== configurationRevision.current) {
        playbackEpoch.current++; pending.current = Promise.resolve('interrupted'); audioPlaybackRef.current?.stop();
      }
      configurationRevision.current = next.configurationRevision; setStatus(next);
    };
    void bridge.voiceStatus().then(update).catch((error) => callbacks.current.onError(String(error)));
    const unsubscribe = bridge.onVoiceProgress(update);
    const check = () => setLocalVoice(Boolean(window.speechSynthesis?.getVoices().some((voice) => voice.localService && voice.lang.startsWith('en'))));
    check(); window.speechSynthesis?.addEventListener('voiceschanged', check);
    return () => { unsubscribe(); window.speechSynthesis?.removeEventListener('voiceschanged', check); };
  }, []);

  const gateMicrophone = useCallback((suspended: boolean) => {
    capture.current?.pipeline.setSuspended(suspended);
    setEchoSuspended(suspended && Boolean(capture.current));
  }, []);
  const finishPlayback = useCallback(() => {
    playingRef.current = false; setPlaying(false); setTimingEstimated(false);
    if (echoTimer.current) clearTimeout(echoTimer.current);
    echoTimer.current = setTimeout(() => gateMicrophone(false), headphonesRef.current ? 0 : 300);
  }, [gateMicrophone]);
  const audioPlaybackRef = useRef<ReturnType<typeof createAudioPlayback> | null>(null);
  if (!audioPlaybackRef.current) audioPlaybackRef.current = createAudioPlayback({
    synthesize: (text, signal) => requestSpeech(text, 'lesson', signal), enabled: () => enabledRef.current,
    rate: () => rateRef.current,
    onError: (message) => callbacks.current.onError(message),
    onActivity: (active, preparing, estimated) => {
      speakingRef.current = active || preparing; setSpeaking(active || preparing);
      if (active) {
        if (echoTimer.current) clearTimeout(echoTimer.current);
        playingRef.current = true; setPlaying(true); setTimingEstimated(estimated); gateMicrophone(!headphonesRef.current);
      } else finishPlayback();
    },
  });
  const audioPlayback = audioPlaybackRef.current;
  const stopSpeaking = useCallback(() => {
    playbackEpoch.current++; pending.current = Promise.resolve('interrupted');
    audioPlayback.stop(); speakingRef.current = false; setSpeaking(false); finishPlayback();
  }, [audioPlayback, finishPlayback]);

  const stopRecording = useCallback(async (_discard = true) => {
    captureEpoch.current++; openingCapture.current = false;
    setStarting(false); setRecording(false); setVoiceActive(false); setEchoSuspended(false); setTranscribing(false);
    const active = capture.current; capture.current = null;
    if (!active) return;
    active.pipeline.stop(); active.processor.disconnect(); active.source.disconnect();
    active.stream.getTracks().forEach((track) => track.stop()); await active.context.close();
  }, []);

  const startRecording = useCallback(async () => {
    if (capture.current || openingCapture.current) return;
    const generation = ++captureEpoch.current; openingCapture.current = true; setStarting(true);
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (generation !== captureEpoch.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      context = new AudioContext(); await context.resume();
      if (generation !== captureEpoch.current) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1);
      const pipeline = new LocalSpeechPipeline({
        sampleRate: context.sampleRate, transcribe: (wav) => bridge.transcribeAudio(wav),
        onActivity: (active) => { if (generation === captureEpoch.current) setVoiceActive(active); },
        onBusy: (busy) => { if (generation === captureEpoch.current) setTranscribing(busy); },
        onSpeechStart: () => {
          if (generation !== captureEpoch.current) return;
          if (playingRef.current || speakingRef.current) stopSpeaking();
          setDraft(''); callbacks.current.onSpeechStart?.();
        },
        onDraft: (text) => { if (generation === captureEpoch.current) { setDraft(text); callbacks.current.onDraft?.(text); } },
        onFinal: (text) => { if (generation === captureEpoch.current) { setDraft(''); (callbacks.current.onFinal ?? callbacks.current.onTranscript)(text); } },
        onError: (message) => { if (generation === captureEpoch.current) callbacks.current.onError(message); },
      });
      processor.onaudioprocess = (event) => { if (generation === captureEpoch.current) pipeline.push(event.inputBuffer.getChannelData(0)); };
      source.connect(processor); processor.connect(context.destination); capture.current = { context, stream, source, processor, pipeline };
      gateMicrophone(playingRef.current && !headphonesRef.current); setRecording(true);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop()); void context?.close().catch(() => {});
      if (generation === captureEpoch.current) callbacks.current.onError(`Microphone could not start: ${error instanceof Error ? error.message : String(error)}. You can type instead.`);
    } finally { if (generation === captureEpoch.current) { openingCapture.current = false; setStarting(false); } }
  }, [gateMicrophone, stopSpeaking]);

  const speak = useCallback((text: string, onHeard?: (prefix: string) => void, onDisplay?: (prefix: string) => void): Promise<AudioResult> => {
    if (!enabledRef.current || !text.trim()) return Promise.resolve('unavailable');
    const epoch = playbackEpoch.current;
    const sentences = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text));
    const segments: Array<{ text: string; start: number; end: number }> = [];
    for (const sentence of sentences) {
      let offset = 0;
      while (offset < sentence.segment.length) {
        let end = Math.min(sentence.segment.length, offset + 240);
        if (end < sentence.segment.length) { const space = sentence.segment.lastIndexOf(' ', end); if (space > offset + 100) end = space + 1; }
        segments.push({ text: sentence.segment.slice(offset, end), start: sentence.index + offset, end: sentence.index + end }); offset = end;
      }
    }
    pending.current = pending.current.then(async (): Promise<AudioResult> => {
      if (epoch !== playbackEpoch.current) return 'interrupted';
      for (let index = 0; index < segments.length; index++) {
        if (epoch !== playbackEpoch.current) return 'interrupted';
        const segment = segments[index];
        let prefetched = false;
        const outcome = audioPlayback.play({ id: `speech:${index}`, text: segment.text }, { beatId: 'speech', chunkId: `speech:${index}`, offsetSeconds: 0, passId: `speech:${epoch}` }, {
          onFrame: (frame) => {
            if (epoch !== playbackEpoch.current) return;
            if (!prefetched && segments[index + 1]) { prefetched = true; audioPlayback.prefetch?.({ id: `speech:${index + 1}`, text: segments[index + 1].text }); }
            onDisplay?.(text.slice(0, segment.start + narrationPrefixAt(segment.text, frame.offsetSeconds, frame.durationSeconds).length));
          },
          onHeard: () => { if (epoch === playbackEpoch.current) { onDisplay?.(text.slice(0, segment.end)); onHeard?.(text.slice(0, segment.end)); } },
        });
        const result = await outcome;
        if (result !== 'completed') return result;
      }
      return 'completed';
    });
    return pending.current;
  }, [audioPlayback]);

  useEffect(() => () => { stopSpeaking(); void stopRecording(true); if (echoTimer.current) clearTimeout(echoTimer.current); }, [stopSpeaking, stopRecording]);
  const toggle = () => { if (enabled) stopSpeaking(); setEnabled(!enabled); };
  const setRate = (value: number) => {
    const next = clampVoiceRate(value); rateRef.current = next; setRateState(next);
    try { localStorage.setItem('canvas-atlas-voice-speed', String(next)); } catch { /* Preferences remain usable when storage is blocked. */ }
  };
  const setHeadphones = (value: boolean) => { headphonesRef.current = value; setHeadphonesState(value); gateMicrophone(playingRef.current && !value); };
  const resumeListening = () => { if (echoTimer.current) clearTimeout(echoTimer.current); if (!playingRef.current) gateMicrophone(false); };
  const resetInput = () => { capture.current?.pipeline.setSuspended(true); if (!playingRef.current || headphonesRef.current) capture.current?.pipeline.setSuspended(false); setDraft(''); };
  const install = async (id: string) => { try { setStatus(await bridge.installVoiceModel(id)); } catch (error) { callbacks.current.onError(error instanceof Error ? error.message : String(error)); } };
  return { status, recording, listening: recording, starting, transcribing, voiceActive, draft, speaking, playing, echoSuspended, timingEstimated, enabled, rate, setRate, headphones, setHeadphones, localVoice, speak, audioPlayback, pauseSpeaking: () => audioPlayback.pause(), resumeSpeaking: () => audioPlayback.resume(), stopSpeaking, stopRecording, startRecording, resumeListening, resetInput, toggle, install };
}
