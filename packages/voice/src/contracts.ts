export interface VoiceStatus {
  recognitionReady: boolean;
  synthesisReady: boolean;
  downloading?: string;
  progress?: number;
  error?: string;
  synthesisEngine?: 'kokoro' | 'windows-sapi' | 'elevenlabs' | null;
  configurationRevision?: number;
  voiceName?: string;
  neuralReady?: boolean;
}
export interface AudioSegment { samples: Float32Array; sampleRate: number }
export interface VoiceArtifact { id: string; filename: string; url: string; bytes: number; sha256: string }
export interface JobContext { sessionId?: string; epoch?: number; signal?: AbortSignal; recognitionHint?: string }
