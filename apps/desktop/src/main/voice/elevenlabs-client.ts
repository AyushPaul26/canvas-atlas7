import {z} from 'zod';
import type {VoicePage,VoiceSettings} from '@living-canvas/protocol';

const entry=z.object({voice_id:z.string().min(1).max(160).regex(/^[\w-]+$/),name:z.string().min(1).max(160),description:z.string().nullable().optional(),labels:z.record(z.string(),z.string()).optional()});
const catalog=z.object({voices:z.array(entry).max(200),has_more:z.boolean().optional(),next_page_token:z.string().max(512).nullable().optional()});
const abortError=(signal:AbortSignal)=>new Error(signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'ElevenLabs request timed out. Retry or choose local voice.':'Voice request canceled.');
function assertActive(signal:AbortSignal){if(signal.aborted)throw abortError(signal);}
/** Bound both fetch and body reads, including adapters that do not honor abort. */
async function interruptible<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  assertActive(signal);let abort:(()=>void)|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{abort=()=>reject(abortError(signal));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
  finally{if(abort)signal.removeEventListener('abort',abort);}
}
async function bounded(response:Response,limit:number,signal:AbortSignal){
  if(Number(response.headers.get('content-length'))>limit){void response.body?.cancel().catch(()=>{});throw new Error('ElevenLabs response exceeded the audio or catalog limit.');}
  if(!response.body)throw new Error('ElevenLabs returned an empty response.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try{
    assertActive(signal);
    while(true){
      const item=await interruptible(reader.read(),signal);if(item.done)break;
      length+=item.value.length;if(length>limit)throw new Error('ElevenLabs response exceeded the audio or catalog limit.');parts.push(item.value);
    }
  }catch(error){
    void reader.cancel().catch(()=>{});if(signal.aborted)throw abortError(signal);
    if(error instanceof Error&&error.message==='ElevenLabs response exceeded the audio or catalog limit.')throw error;
    // eslint-disable-next-line preserve-caught-error -- Transport-owned errors may contain credentials; public errors must not retain them.
    throw new Error('ElevenLabs returned incomplete audio or catalog data. Retry the request.');
  }
  finally{reader.releaseLock();}
  assertActive(signal);
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export class ElevenLabsClient {
  constructor(private request:typeof fetch=fetch){}
  private async call(path:string,key:string,init:RequestInit,signal?:AbortSignal){
    const active=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);let response:Response;
    try{assertActive(active);response=await interruptible(this.request(`https://api.elevenlabs.io${path}`,{...init,headers:{'xi-api-key':key,...init.headers},redirect:'error',credentials:'omit',signal:active}),active);}
    catch{if(active.aborted)throw abortError(active);throw new Error('Could not reach ElevenLabs. Check your connection and retry, or choose local voice.');}
    assertActive(active);
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error(response.status===401?'ElevenLabs rejected the API key. Replace it in Voice settings.':response.status===403?'ElevenLabs denied access. Check this key’s voice and text-to-speech permissions.':response.status===429?'ElevenLabs is busy or your credit limit was reached. Check your account, then retry or choose local voice.':response.status===400||response.status===404||response.status===422?'ElevenLabs could not use this voice or its settings. Refresh your voices and choose an available voice.':'ElevenLabs is temporarily unavailable. Retry or choose local voice.');}
    return {response,signal:active};
  }
  async listVoices(key:string,query:{search?:string;nextPageToken?:string}={},signal?:AbortSignal):Promise<VoicePage>{
    const params=new URLSearchParams({page_size:'50'});if(query.search)params.set('search',query.search);if(query.nextPageToken)params.set('next_page_token',query.nextPageToken);
    const result=await this.call(`/v2/voices?${params}`,key,{method:'GET'},signal);
    const bytes=await bounded(result.response,2*1024*1024,result.signal);
    let data:z.infer<typeof catalog>;
    try{data=catalog.parse(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new Error('ElevenLabs returned an unsupported voice catalog. Retry refreshing voices.');}
    if(data.has_more&&!data.next_page_token)throw new Error('ElevenLabs returned incomplete voice pagination. Refresh voices.');
    return {voices:data.voices.map(v=>({id:v.voice_id,name:v.name,...(v.description?{description:v.description.slice(0,500)}:{}),...(v.labels?.accent?{accent:v.labels.accent.slice(0,80)}:{}),...(v.labels?.gender?{gender:v.labels.gender.slice(0,80)}:{})})),hasMore:!!data.has_more,...(data.next_page_token?{nextPageToken:data.next_page_token}:{})};
  }
  async synthesize(key:string,input:VoiceSettings&{text:string},signal?:AbortSignal){
    const result=await this.call(`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=pcm_24000`,key,{method:'POST',headers:{'Content-Type':'application/json',Accept:'audio/pcm'},body:JSON.stringify({text:input.text,model_id:input.modelId,voice_settings:{stability:input.stability,similarity_boost:input.similarityBoost,style:input.style,use_speaker_boost:true}})},signal);
    const contentType=result.response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
    if(contentType&&!contentType.startsWith('audio/')&&contentType!=='application/octet-stream'){void result.response.body?.cancel().catch(()=>{});throw new Error('ElevenLabs returned invalid audio instead of PCM. Retry this step.');}
    const bytes=await bounded(result.response,8*1024*1024,result.signal);
    if(!bytes.length||bytes.length%2)throw new Error('ElevenLabs returned invalid PCM audio. Retry this step.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),samples=new Float32Array(bytes.length/2);
    for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
    return {samples,sampleRate:24000};
  }
}
