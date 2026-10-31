import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ElevenLabsKeyStore} from '../../apps/desktop/src/main/voice/elevenlabs-key-store';
import {ElevenLabsClient} from '../../apps/desktop/src/main/voice/elevenlabs-client';
import {SpeechProvider} from '../../apps/desktop/src/main/voice/speech-provider';

const key='test-key-for-fixtures-only';
const voice={voice_id:'voice-test',name:'Test teacher',labels:{accent:'Indian',gender:'female'},description:'A fixture voice'};
const pcm=()=>new Response(new Uint8Array([0,128,0,0,255,127]));
const fetcher=()=>vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/text-to-speech/')?pcm():Response.json({voices:[voice],has_more:false}));
const settings={provider:'elevenlabs' as const,voiceId:'voice-test',voiceName:'Test teacher',modelId:'eleven_multilingual_v2' as const,stability:.5,similarityBoost:.75,style:0};
const scratch:string[]=[];
afterEach(()=>{for(const dir of scratch.splice(0))rmSync(dir,{recursive:true,force:true});});

it('protects an API key with OS encryption and removes only its own file',()=>{
  const directory=mkdtempSync(join(tmpdir(),'atlas-eleven-key-'));scratch.push(directory);const path=join(directory,'key.enc');
  const protection={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(Buffer.from(value).map(x=>x^123)),decryptString:(value:Buffer)=>Buffer.from(value).map(x=>x^123).toString()};
  const store=new ElevenLabsKeyStore(path,protection);store.save(key);
  expect(readFileSync(path).toString()).not.toContain(key);expect(store.load()).toBe(key);expect(store.has()).toBe(true);
  store.clear();expect(store.has()).toBe(false);expect(store.load()).toBeUndefined();
  expect(()=>new ElevenLabsKeyStore(path,{...protection,isEncryptionAvailable:()=>false}).save(key)).toThrow(/protect|encrypt/i);
  expect(()=>new ElevenLabsKeyStore(path,{...protection,getSelectedStorageBackend:()=>'basic_text'}).save(key)).toThrow(/protect|encrypt/i);
});

it('loads a bounded public catalog using account authentication and pagination',async()=>{
  const request=fetcher(),client=new ElevenLabsClient(request as typeof fetch);
  const page=await client.listVoices(key,{search:'teacher',nextPageToken:'page2'});
  expect(page.voices).toEqual([{id:'voice-test',name:'Test teacher',description:'A fixture voice',accent:'Indian',gender:'female'}]);
  const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];
  expect(String(url)).toContain('https://api.elevenlabs.io/v2/voices?');expect(String(url)).toContain('next_page_token=page2');
  expect(init.headers).toMatchObject({'xi-api-key':key});expect(init.redirect).toBe('error');
  expect(JSON.stringify(page)).not.toContain(key);
});

it('converts signed PCM24k into the existing Float32 playback contract',async()=>{
  const request=fetcher(),client=new ElevenLabsClient(request as typeof fetch);
  const audio=await client.synthesize(key,{...settings,text:'Explain gravity.'});
  expect(audio.sampleRate).toBe(24000);expect(Array.from(audio.samples)).toEqual([-1,0,32767/32768]);
  const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];
  expect(String(url)).toContain('output_format=pcm_24000');expect(JSON.parse(String(init.body))).toMatchObject({text:'Explain gravity.',model_id:'eleven_multilingual_v2',voice_settings:{stability:.5,similarity_boost:.75,style:0}});
});

it.each([401,403,429,500])('maps provider status %s without exposing provider details or credentials',async status=>{
  const client=new ElevenLabsClient((async()=>Response.json({detail:{message:key}},{status})) as typeof fetch);
  const error=await client.listVoices(key).catch(error=>error as Error);
  expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain(key);expect(String(error)).toMatch(/key|access|credit|busy|ElevenLabs/i);
});

it('rejects malformed catalog and truncated PCM rather than playing fabricated audio',async()=>{
  await expect(new ElevenLabsClient((async()=>Response.json({voices:'wrong'})) as typeof fetch).listVoices(key)).rejects.toThrow();
  await expect(new ElevenLabsClient((async()=>new Response(new Uint8Array([1]))) as typeof fetch).synthesize(key,{...settings,text:'Test'})).rejects.toThrow(/audio|PCM/i);
});

function setup(request:typeof fetch=fetcher() as typeof fetch){
  let savedKey:string|undefined;const preferences=new Map<string,string>();
  const keyStore={has:()=>!!savedKey,load:()=>savedKey,save:(value:string)=>{savedKey=value;},clear:()=>{savedKey=undefined;}};
  const local={status:vi.fn(async()=>({recognitionReady:true,synthesisReady:true,synthesisEngine:'kokoro' as const})),transcribe:vi.fn(async()=>'Local words'),installModel:vi.fn(),synthesize:vi.fn(async()=>({samples:new Float32Array(100),sampleRate:24000})),cancel:vi.fn(),dispose:vi.fn()};
  const options={keyStore,local,preferences:{getPreference:(name:string)=>preferences.get(name),setPreference:(name:string,value:string)=>preferences.set(name,value)},request};
  return {service:new SpeechProvider(options),options,local,keyStore};
}

it('uses local narration by default without provider requests',async()=>{
  const request=fetcher(),{service,local}=setup(request as typeof fetch);
  await service.synthesize('Test');expect(local.synthesize).toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});

it('persists only public voice settings and restores a chosen account voice',async()=>{
  const {service,options,local}=setup();await service.setKey(key);await service.configure(settings);
  expect(service.configuration()).toMatchObject({...settings,hasKey:true});expect(JSON.stringify(service.configuration())).not.toContain(key);
  const restored=new SpeechProvider(options);expect(restored.configuration()).toMatchObject({provider:'elevenlabs',voiceId:'voice-test',hasKey:true});
  expect(await restored.status()).toMatchObject({synthesisReady:true,synthesisEngine:'elevenlabs'});
  await restored.synthesize('Explain gravity.');expect(local.synthesize).not.toHaveBeenCalled();
  restored.clearKey();expect(restored.configuration()).toMatchObject({provider:'local',hasKey:false});
});

it('requires a key and an available account voice before enabling ElevenLabs',async()=>{
  const {service}=setup();await expect(service.configure(settings)).rejects.toThrow(/key/i);
  await service.setKey(key);await expect(service.configure({...settings,voiceId:'unknown'})).rejects.toThrow(/voice/i);
});

it('aborts only the requested synthesis job and rejects stale audio on a voice change',async()=>{
  const request=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
    if(!String(input).includes('/text-to-speech/'))return Promise.resolve(Response.json({voices:[voice],has_more:false}));
    return new Promise<Response>((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  });
  const {service,local}=setup(request as typeof fetch);await service.setKey(key);await service.configure(settings);
  const work=service.synthesize('Test',{requestId:'job-1',purpose:'lesson'});const rejected=expect(work).rejects.toThrow();service.cancelSpeech('job-1');await rejected;
  expect(local.cancel).not.toHaveBeenCalled();expect(await service.transcribe(new ArrayBuffer(4))).toBe('Local words');
  const next=service.synthesize('Again',{requestId:'job-2',purpose:'lesson'});const canceled=expect(next).rejects.toThrow();await service.configure({...settings,provider:'local'});await canceled;
});

it('cannot resurrect a removed key when its earlier connection check finishes late',async()=>{
  let release!:(response:Response)=>void;
  const {service,keyStore}=setup((()=>new Promise<Response>(resolve=>{release=resolve;})) as typeof fetch);
  const connection=service.setKey(key),rejected=expect(connection).rejects.toThrow(/changed|cancel/i);
  service.clearKey();release(Response.json({voices:[voice],has_more:false}));await rejected;
  expect(keyStore.has()).toBe(false);expect(service.configuration()).toMatchObject({provider:'local',hasKey:false});
});

it('retains the newest validated key when connection attempts complete out of order',async()=>{
  let release!:(response:Response)=>void;let calls=0;
  const request=(()=>++calls===1?new Promise<Response>(resolve=>{release=resolve;}):Promise.resolve(Response.json({voices:[voice],has_more:false}))) as typeof fetch;
  const {service,keyStore}=setup(request);
  const first=service.setKey(key),rejected=expect(first).rejects.toThrow(/changed|cancel/i);
  const nextKey='newer-test-key-for-fixtures';await service.setKey(nextKey);
  release(Response.json({voices:[voice],has_more:false}));await rejected;expect(keyStore.load()).toBe(nextKey);
});

it('does not return late catalog data after disposal or send new requests from a closed service',async()=>{
  let release!:(response:Response)=>void;let calls=0;
  const request=vi.fn(()=>++calls===1?Promise.resolve(Response.json({voices:[voice],has_more:false})):new Promise<Response>(resolve=>{release=resolve;}));
  const {service}=setup(request as typeof fetch);await service.setKey(key);
  const pending=service.listVoices(),rejected=expect(pending).rejects.toThrow(/closed|changed|cancel/i);service.dispose();
  release(Response.json({voices:[voice],has_more:false}));await rejected;
  await expect(service.listVoices()).rejects.toThrow(/closed/i);expect(request).toHaveBeenCalledTimes(2);
});

it('keeps a previously saved off-page voice usable when settings are edited after restart',async()=>{
  const request=fetcher(),{service,options}=setup(request as typeof fetch);await service.setKey(key);await service.configure(settings);
  const restored=new SpeechProvider(options);const calls=request.mock.calls.length;
  await restored.configure({...settings,voiceName:'Untrusted replacement name',stability:.65});
  expect(restored.configuration()).toMatchObject({voiceId:'voice-test',voiceName:'Test teacher',stability:.65});expect(request).toHaveBeenCalledTimes(calls);
});

it('requires an explicit voice selection again after connecting a replacement account key',async()=>{
  const {service}=setup();await service.setKey(key);await service.configure(settings);
  await service.setKey('replacement-fixture-key');
  expect(service.configuration()).toMatchObject({provider:'local',voiceId:'',voiceName:'',hasKey:true});
});

it('retains the previous key and settings when replacement validation or protected storage fails',async()=>{
  const request=fetcher(),{service,keyStore,options}=setup(request as typeof fetch);await service.setKey(key);await service.configure(settings);
  request.mockImplementationOnce(async()=>Response.json({},{status:401}));
  await expect(service.setKey('replacement-fixture-key')).rejects.toThrow(/key/i);
  expect(keyStore.load()).toBe(key);expect(service.configuration()).toMatchObject(settings);
  keyStore.save=()=>{throw new Error('OS key store unavailable');};
  await expect(service.setKey('replacement-fixture-key')).rejects.toThrow(/key store/i);
  expect(keyStore.load()).toBe(key);expect(new SpeechProvider(options).configuration()).toMatchObject(settings);
});

it('rejects a successful JSON response instead of treating its bytes as spoken PCM',async()=>{
  const client=new ElevenLabsClient((async()=>Response.json({})) as typeof fetch);
  await expect(client.synthesize(key,{...settings,text:'Test'})).rejects.toThrow(/audio|PCM/i);
});

it('cancels a stalled response body promptly even if a fetch adapter ignores abort signals',async()=>{
  const client=new ElevenLabsClient((async()=>new Response(new ReadableStream<Uint8Array>({start(){}}))) as typeof fetch);
  const controller=new AbortController();const pending=client.synthesize(key,{...settings,text:'Test'},controller.signal);
  await Promise.resolve();await Promise.resolve();controller.abort();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{await expect(Promise.race([pending,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Cancellation did not finish')),250);})])).rejects.toThrow(/canceled/i);}
  finally{if(timeout)clearTimeout(timeout);}
});

it('bounds both declared and streamed response bytes and cancels excessive streams',async()=>{
  const cancel=vi.fn();
  const declared=new ElevenLabsClient((async()=>new Response(new ReadableStream({cancel}),{headers:{'content-length':String(8*1024*1024+1)}})) as typeof fetch);
  await expect(declared.synthesize(key,{...settings,text:'Test'})).rejects.toThrow(/limit/);expect(cancel).toHaveBeenCalledOnce();
  const streamed=new ElevenLabsClient((async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));controller.close();}}))) as typeof fetch);
  await expect(streamed.synthesize(key,{...settings,text:'Test'})).rejects.toThrow(/limit/);
});

it('redacts transport-owned response-body failures',async()=>{
  const client=new ElevenLabsClient((async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(key));}}))) as typeof fetch);
  const error=await client.synthesize(key,{...settings,text:'Test'}).catch(error=>error as Error);
  expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain(key);expect(String(error)).toMatch(/audio|data/i);
});

it('bounds cached account choices while preserving the selected voice and current page',async()=>{
  let page=0;const request=vi.fn(async()=>Response.json({voices:page++===0?[voice]:Array.from({length:200},(_,i)=>({...voice,voice_id:`page-${page}-${i}`})),has_more:false}));
  const {service}=setup(request as typeof fetch);await service.setKey(key);await service.configure(settings);
  for(let i=0;i<7;i++)await service.listVoices({nextPageToken:`${i}`});
  await service.configure({...settings,stability:.65});
  expect(service.configuration()).toMatchObject({voiceId:'voice-test',stability:.65});
  await expect(service.configure({...settings,voiceId:'page-2-0'})).rejects.toThrow(/voice/i);
  await service.configure({...settings,voiceId:'page-8-199'});expect(service.configuration().voiceId).toBe('page-8-199');
});
