import { encodeWave } from './audioEncoding';

type Options = {
  sampleRate: number;
  transcribe: (audio: ArrayBuffer) => Promise<string>;
  onDraft: (text: string) => void;
  onFinal: (text: string) => void;
  onSpeechStart: () => void;
  onError: (message: string) => void;
  onActivity?: (active: boolean) => void;
  onBusy?: (busy: boolean) => void;
};
type Utterance = { id: number; chunks: Float32Array[]; samples: number; voicedMs: number; quietMs: number; draft: string; lastPartialSamples: number; windowStart: number };

/** Local energy VAD, bounded PCM windows, one recognition request at a time. No network speech API. */
export class LocalSpeechPipeline {
  private stopped = false;
  private suspended = false;
  private busy = false;
  private sequence = 0;
  private generation = 0;
  private candidateMs = 0;
  private noiseFloor = .003;
  private preRoll: Float32Array[] = [];
  private active: Utterance | null = null;
  private pendingFinalText = '';
  private awaitingContinuation = false;
  private continuationQuietMs = 0;
  private finals: Utterance[] = [];
  private timer: ReturnType<typeof setInterval>;

  constructor(private options: Options) {
    this.timer = setInterval(() => this.recognize(), 1000);
  }

  push(samples: Float32Array) {
    if (this.stopped || this.suspended || !samples.length) return;
    if (this.finals.length >= 2 && !this.active) return;
    const duration = samples.length * 1000 / this.options.sampleRate;
    let squared = 0;
    for (const value of samples) squared += value * value;
    const rms = Math.sqrt(squared / samples.length);
    const onset = Math.max(.012, this.noiseFloor * 3.5);
    const release = Math.max(.006, this.noiseFloor * 2);
    const voiced = rms >= (this.active ? release : onset);
    if (!this.active) {
      if (this.awaitingContinuation) {
        this.continuationQuietMs = voiced ? 0 : this.continuationQuietMs + duration;
        if (this.continuationQuietMs >= 900) {
          this.awaitingContinuation = false;
          if (this.pendingFinalText && !this.busy && !this.finals.length) { const text = this.pendingFinalText; this.pendingFinalText = ''; this.options.onFinal(text); }
        }
      }
      this.preRoll.push(new Float32Array(samples));
      while (this.preRoll.length > 1 && this.preRoll.reduce((sum, chunk) => sum + chunk.length, 0) > this.options.sampleRate * .35) this.preRoll.shift();
      this.candidateMs = voiced ? this.candidateMs + duration : 0;
      if (!voiced) this.noiseFloor = this.noiseFloor * .96 + Math.min(rms, .012) * .04;
      if (this.candidateMs < 180) return;
      const chunks = this.preRoll; this.preRoll = [];
      this.active = { id: ++this.sequence, chunks, samples: chunks.reduce((sum, chunk) => sum + chunk.length, 0), voicedMs: this.candidateMs, quietMs: 0, draft: '', lastPartialSamples: 0, windowStart: 0 };
      this.candidateMs = 0; this.options.onActivity?.(true); this.options.onSpeechStart();
      return;
    }
    this.active.chunks.push(new Float32Array(samples)); this.active.samples += samples.length;
    if (voiced) { this.active.voicedMs += duration; this.active.quietMs = 0; }
    else this.active.quietMs += duration;
    if (this.active.quietMs >= 900) this.finishUtterance(false);
    else if (this.active.samples >= this.options.sampleRate * 28) this.finishUtterance(true);
  }

  private finishUtterance(continuing = false) {
    if (!this.active) return;
    this.awaitingContinuation = continuing; this.continuationQuietMs = 0;
    this.finals.push(this.active); this.active = null; this.preRoll = []; this.candidateMs = 0;
    this.options.onActivity?.(false); this.recognize();
  }

  private recognize() {
    if (this.stopped || this.suspended || this.busy) return;
    const final = this.finals.length > 0;
    const utterance = final ? this.finals.shift()! : this.active;
    if (!utterance || (!final && (utterance.voicedMs < 300 || utterance.samples === utterance.lastPartialSamples))) return;
    this.busy = true; this.options.onBusy?.(true);
    const generation = this.generation;
    utterance.lastPartialSamples = utterance.samples;
    const maxSamples = this.options.sampleRate * (final ? 30 : 8);
    const start = Math.max(0, utterance.samples - maxSamples);
    let skip = start;
    const chunks = utterance.chunks.flatMap((chunk) => {
      if (skip >= chunk.length) { skip -= chunk.length; return []; }
      const result = skip ? chunk.slice(skip) : chunk; skip = 0; return [result];
    });
    void this.options.transcribe(encodeWave(chunks, this.options.sampleRate)).then((raw) => {
      if (this.stopped || this.suspended || generation !== this.generation) return;
      const text = raw.trim();
      if (!text || /^\[?(?:blank_audio|silence|no speech)\]?$/i.test(text)) return;
      if (final) {
        const combined = `${this.pendingFinalText} ${text}`.trim();
        if (this.active || this.finals.length || this.awaitingContinuation) { this.pendingFinalText = combined; this.options.onDraft(combined); }
        else { this.pendingFinalText = ''; this.options.onFinal(combined); }
      }
      else {
        utterance.draft = start === 0 ? text : mergeTranscript(utterance.draft, text);
        utterance.windowStart = start;
        if (this.active?.id === utterance.id) this.options.onDraft(`${this.pendingFinalText} ${utterance.draft}`.trim());
      }
    }).catch((error) => {
      if (!this.stopped && !this.suspended && generation === this.generation && !/cancel|supersed/i.test(String(error))) this.options.onError(`Local voice recognition could not finish: ${error instanceof Error ? error.message : String(error)}. Your draft is still available to type.`);
    }).finally(() => {
      this.busy = false; this.options.onBusy?.(false);
      if (this.finals.length) this.recognize();
    });
  }

  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) { this.generation++; this.active = null; this.preRoll = []; this.finals = []; this.pendingFinalText = ''; this.awaitingContinuation = false; this.candidateMs = 0; this.options.onActivity?.(false); }
  }

  stop() {
    this.stopped = true; clearInterval(this.timer); this.active = null; this.finals = []; this.preRoll = [];
    this.options.onActivity?.(false); this.options.onBusy?.(false);
  }
}

const normalize = (word: string) => word.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
export function mergeTranscript(previous: string, next: string): string {
  if (!previous) return next;
  const oldWords = previous.trim().split(/\s+/), newWords = next.trim().split(/\s+/);
  for (let count = Math.min(oldWords.length, newWords.length); count >= 2; count--) {
    if (oldWords.slice(-count).every((word, index) => normalize(word) === normalize(newWords[index]))) return [...oldWords, ...newWords.slice(count)].join(' ');
  }
  if (normalize(oldWords[0]) === normalize(newWords[0])) return next;
  return `${previous.trim()} ${next.trim()}`;
}

/** Presentation pacing only: duration-derived word positions are not forced alignment. */
export function narrationPrefixAt(text: string, elapsed: number, duration: number): string {
  if (!(elapsed > 0) || !(duration > 0)) return '';
  if (elapsed >= duration) return text;
  const target = elapsed / duration * text.length;
  let end = 0;
  for (const match of text.matchAll(/\S+\s*/g)) { const boundary = match.index + match[0].length; if (boundary > target) break; end = boundary; }
  return text.slice(0, end);
}
