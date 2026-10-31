import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {voiceSettingsSchema,voiceQuerySchema,speechJobSchema,VOICE_PREVIEW_TEXT,type VoiceSettings,type VoiceConfiguration,type AccountVoice,type SpeechJob,type VoiceStatus} from '@living-canvas/protocol';
import type {AudioSegment,JobContext} from '../../../../../packages/voice/src/contracts';
import {segmentNarration} from '../../../../../packages/voice/src/synthesis';
import {ElevenLabsClient} from './elevenlabs-client';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate} from '../safety/contracts';

type Local={status():Promise<VoiceStatus>;synthesize(text:string,context?:JobContext):Promise<AudioSegment|null>;transcribe(audio:ArrayBuffer):Promise<string>;installModel(id:string):Promise<VoiceStatus>;cancel():void;dispose():void};
type Options={local:Local;safety?:SafetyGate;keyStore:{has():boolean;load():string|undefined;save(key:string):void;clear():void};preferences:{getPreference(key:string):string|undefined;setPreference(key:string,value:string):void};request?:typeof fetch;onStatus?:(status:VoiceStatus)=>void};
export class SpeechProvider {
  private settings:VoiceSettings=voiceSettingsSchema.parse({});private revision=0;private disposed=false;private credentialEpoch=0;
  private localStatus:VoiceStatus={recognitionReady:false,synthesisReady:false};
  private voices=new Map<string,AccountVoice>();private jobs=new Map<string,AbortController>();private catalogJobs=new Set<AbortController>();private client:ElevenLabsClient;
  constructor(private options:Options){this.client=new ElevenLabsClient(options.request);try{const value=options.preferences.getPreference('speechSettings');if(value)this.settings=voiceSettingsSchema.parse(JSON.parse(value));}catch{/* Invalid preferences revert to local narration. */}}
  configuration():VoiceConfiguration{return {...this.settings,hasKey:this.options.keyStore.has(),revision:this.revision};}
  private assertLive(){if(this.disposed)throw new Error('Voice service is closed.');}
  private cancelCatalogs(){for(const job of this.catalogJobs)job.abort();this.catalogJobs.clear();}
  private catalogJob(){this.assertLive();if(this.catalogJobs.size>=3)throw new Error('Voice catalog is busy. Wait for the current request and retry.');const work=new AbortController();this.catalogJobs.add(work);return work;}
  private remember(voices:AccountVoice[]){
    for(const voice of voices){this.voices.delete(voice.id);this.voices.set(voice.id,voice);}
    while(this.voices.size>1000){const first=this.voices.keys().next().value!;const voice=this.voices.get(first)!;this.voices.delete(first);if(first===this.settings.voiceId)this.voices.set(first,voice);}
  }
  private snapshot():VoiceStatus{return {...this.localStatus,...(this.settings.provider==='elevenlabs'?{synthesisEngine:'elevenlabs' as const,synthesisReady:this.options.keyStore.has()&&!!this.settings.voiceId,voiceName:this.settings.voiceName||'ElevenLabs',error:undefined}:{}),configurationRevision:this.revision};}
  handleLocalStatus(status:VoiceStatus){this.localStatus=status;if(!this.disposed)this.options.onStatus?.(this.snapshot());}
  async status(){if(this.settings.provider==='local')this.localStatus=await this.options.local.status();return this.snapshot();}
  private changed(){this.revision++;for(const job of this.jobs.values())job.abort();this.cancelCatalogs();this.options.onStatus?.(this.snapshot());}
  private key(){const key=this.options.keyStore.load();if(!key)throw new Error('Connect your ElevenLabs API key in Voice settings first.');return key;}
  async setKey(value:string){
    this.assertLive();const key=z.string().trim().min(16).max(512).regex(/^\S+$/).parse(value),epoch=++this.credentialEpoch;this.cancelCatalogs();const work=this.catalogJob();
    try{
      const page=await this.client.listVoices(key,{},work.signal);
      this.assertLive();if(epoch!==this.credentialEpoch)throw new Error('Voice connection changed. Connect the intended key again.');
      const settings:VoiceSettings={...this.settings,provider:'local',voiceId:'',voiceName:''};
      // Persist the safe selection first. A failed atomic key save leaves the old
      // key intact; restore its prior selection rather than mixing two accounts.
      this.options.preferences.setPreference('speechSettings',JSON.stringify(settings));
      try{this.options.keyStore.save(key);}catch(error){try{this.options.preferences.setPreference('speechSettings',JSON.stringify(this.settings));}catch{/* A safe local selection remains preferable to an account mismatch. */}throw error;}
      this.settings=settings;this.voices.clear();this.remember(page.voices);this.changed();return this.configuration();
    }finally{this.catalogJobs.delete(work);}
  }
  clearKey(){this.assertLive();this.credentialEpoch++;this.cancelCatalogs();this.options.keyStore.clear();this.voices.clear();this.settings={...this.settings,provider:'local',voiceId:'',voiceName:''};this.options.preferences.setPreference('speechSettings',JSON.stringify(this.settings));this.changed();return this.configuration();}
  async listVoices(query:{search?:string;nextPageToken?:string}={}){
    this.assertLive();const revision=this.revision,epoch=this.credentialEpoch,work=this.catalogJob();
    try{
      const page=await this.client.listVoices(this.key(),voiceQuerySchema.parse(query),work.signal);
      this.assertLive();if(revision!==this.revision||epoch!==this.credentialEpoch)throw new Error('Voice settings changed. Refresh voices again.');this.remember(page.voices);return page;
    }finally{this.catalogJobs.delete(work);}
  }
  async configure(value:VoiceSettings){
    if(this.disposed)throw new Error('Voice service is closed.');const settings=voiceSettingsSchema.parse(value);
    if(settings.provider==='elevenlabs'){
      this.key();const voice=this.voices.get(settings.voiceId)??(settings.voiceId&&settings.voiceId===this.settings.voiceId?{id:settings.voiceId,name:this.settings.voiceName}:undefined);
      if(!voice)throw new Error('Refresh voices and choose an available account voice.');
      settings.voiceName=voice.name;
    }
    this.options.preferences.setPreference('speechSettings',JSON.stringify(settings));this.settings=settings;this.changed();return this.configuration();
  }
  cancelSpeech(id:string){this.jobs.get(id)?.abort();}
  cancel(){for(const job of this.jobs.values())job.abort();this.options.local.cancel();}
  async synthesize(text:string,context:SpeechJob={requestId:randomUUID(),purpose:'lesson'}):Promise<AudioSegment|null>{
    if(this.disposed)throw new Error('Voice service is closed.');z.string().max(8000).parse(text);speechJobSchema.parse(context);
    assertLearnerSafe(context.purpose==='preview'?VOICE_PREVIEW_TEXT:text,'narration');
    const spoken=context.purpose==='preview'?VOICE_PREVIEW_TEXT:text;
    this.options.safety?.assertApproved(spoken,'narration');
    const segments=segmentNarration(spoken);for(const segment of segments)assertLearnerSafe(segment,'narration');
    if(this.jobs.has(context.requestId)||this.jobs.size>=3)throw new Error('Voice is busy. Stop the current preview or retry.');
    const work=new AbortController(),revision=this.revision,settings={...this.settings};this.jobs.set(context.requestId,work);
    const check=()=>{work.signal.throwIfAborted();if(this.disposed||revision!==this.revision)throw new Error('Voice settings changed. Retry this step.');this.options.safety?.assertApproved(spoken,'narration');};
    try{
      if(settings.provider==='local'){const audio=await this.options.local.synthesize(context.purpose==='preview'?VOICE_PREVIEW_TEXT:text,{signal:work.signal});check();return audio;}
      const key=this.key(),parts:Float32Array[]=[];let length=0;
      for(const segment of segments){
        check();const audio=await this.client.synthesize(key,{...settings,text:segment},work.signal);check();length+=audio.samples.length;
        if(length>24000*300)throw new Error('Narration exceeds five minutes.');parts.push(audio.samples);
      }
      if(!length)return null;
      const samples=new Float32Array(length);let offset=0;for(const part of parts){samples.set(part,offset);offset+=part.length;}return {samples,sampleRate:24000};
    }finally{this.jobs.delete(context.requestId);}
  }
  transcribe(audio:ArrayBuffer){return this.options.local.transcribe(audio);}
  async installModel(id:string){await this.options.local.installModel(id);return this.status();}
  dispose(){this.disposed=true;this.credentialEpoch++;this.cancelCatalogs();this.cancel();this.options.local.dispose();}
}
