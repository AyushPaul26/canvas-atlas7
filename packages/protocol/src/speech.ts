import {z} from 'zod';
export const voiceSettingsSchema=z.object({
  provider:z.enum(['local','elevenlabs']).default('local'),
  voiceId:z.string().max(160).regex(/^[\w-]*$/).default(''),voiceName:z.string().max(160).default(''),
  modelId:z.literal('eleven_multilingual_v2').default('eleven_multilingual_v2'),
  stability:z.number().finite().min(0).max(1).default(.5),similarityBoost:z.number().finite().min(0).max(1).default(.75),style:z.number().finite().min(0).max(1).default(0),
}).strict();
export type VoiceSettings=z.infer<typeof voiceSettingsSchema>;
export type VoiceConfiguration=VoiceSettings&{hasKey:boolean;revision:number};
export interface AccountVoice {id:string;name:string;description?:string;accent?:string;gender?:string}
export interface VoicePage {voices:AccountVoice[];hasMore:boolean;nextPageToken?:string}
export const speechJobSchema=z.object({requestId:z.string().min(1).max(160).regex(/^[\w:.-]+$/),purpose:z.enum(['lesson','preview'])}).strict();
export type SpeechJob=z.infer<typeof speechJobSchema>;
export const voiceQuerySchema=z.object({search:z.string().max(120).optional(),nextPageToken:z.string().max(512).optional()}).strict();
export const VOICE_PREVIEW_TEXT='Let us explore this together. We will take it one step at a time, and you can ask a question whenever you need.';
