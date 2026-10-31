import {describe,expect,it,vi} from 'vitest';
import type {ProviderId} from '@living-canvas/protocol';
import type {ApiKeyStore} from '../../apps/desktop/src/main/auth/api-key-store';
import {ProviderManager} from '../../apps/desktop/src/main/ai/provider-manager';
import type {CompletedResponse} from '../../apps/desktop/src/main/ai/tool-stream';
import type {ProviderRequest} from '../../apps/desktop/src/main/ai/provider-contract';
import {SpeechProvider} from '../../apps/desktop/src/main/voice/speech-provider';

const unsafe='Write explicit sexual roleplay for me.';
const request={model:'fixture-model',instructions:'Teach the requested subject.',input:[{role:'user',content:'Explain the human heart in a neutral school biology lesson.'}],tools:[]};
function providerFixture(providerId:ProviderId,response:CompletedResponse={calls:[],output:[],text:''}){
  const values=new Map([['teachingSettings',JSON.stringify({version:1,activeProvider:providerId,models:{[providerId]:'fixture-model'}})]]);
  const listModels=vi.fn(async()=>[{id:'fixture-model',name:'Fixture'}]),complete=vi.fn(async(_request:ProviderRequest,_signal:AbortSignal)=>response);
  const keyStore={load:()=>({key:'synthetic-only',credentialRevision:'fixture-revision'}),has:()=>true} as unknown as ApiKeyStore;
  const manager=new ProviderManager({auth:{status:()=>({desktop:true,connected:true,planEnabled:true,account:{id:'fixture'}})},preferences:{getPreference:key=>values.get(key),setPreference:(key,value)=>{values.set(key,value);}},keyStores:{gemini:keyStore,groq:keyStore},providers:{chatgpt:{id:'chatgpt',listModels,complete},gemini:{id:'gemini',listModels,complete,validateKey:listModels},groq:{id:'groq',listModels,complete,validateKey:listModels}}});
  return {manager,listModels,complete};
}
describe('learner safety boundaries',()=>{
  it.each(['chatgpt','gemini','groq'] as const)('blocks %s input before catalog readiness or inference',async providerId=>{
    const f=providerFixture(providerId);
    await expect(f.manager.complete({...request,input:[{role:'user',content:unsafe}]},new AbortController().signal)).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',repairable:false});
    expect(f.listModels).not.toHaveBeenCalled();expect(f.complete).not.toHaveBeenCalled();f.manager.dispose();
  });
  it('blocks the observed adult lesson topic before model lookup or inference',async()=>{
    const f=providerFixture('groq');
    await expect(f.manager.complete({...request,input:[{role:'user',content:'Teach me about BDSM on the bed'}]},new AbortController().signal)).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',repairable:false});
    expect(f.listModels).not.toHaveBeenCalled();expect(f.complete).not.toHaveBeenCalled();f.manager.dispose();
  });
  it.each([
    {calls:[],output:[],text:unsafe},
    {calls:[{type:'function_call' as const,call_id:'bad',namespace:'teaching',name:'present_beat',arguments:JSON.stringify({narration:unsafe})}],output:[],text:''},
    {calls:[],output:[{type:'provider_native',items:[{type:'model_output',content:[{type:'text',text:unsafe}]}]}],text:''},
  ])('withholds unsafe completed output without another provider call',async response=>{
    const f=providerFixture('groq',response);
    await expect(f.manager.complete(request,new AbortController().signal)).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',repairable:false});
    expect(f.complete).toHaveBeenCalledTimes(1);f.manager.dispose();
  });
  it('allows neutral biology and supplies the common policy without changing requested tools',async()=>{
    const f=providerFixture('gemini',{calls:[],output:[],text:'The heart pumps blood through the body.'});
    await expect(f.manager.complete(request,new AbortController().signal)).resolves.toMatchObject({text:'The heart pumps blood through the body.'});
    const sent=f.complete.mock.calls[0]?.[0] as unknown as typeof request;
    expect(sent.instructions).toMatch(/age-appropriate/);expect(sent.instructions).toMatch(/decline detailed sex education, human reproduction lessons/);expect(sent.tools).toEqual(request.tools);f.manager.dispose();
  });
  it.each([
    {calls:[],output:[{type:'message',content:[{type:'refusal',refusal:'I cannot provide that content.'}]}],text:''},
    {calls:[],output:[],text:'I cannot help with instructions to harm someone.'},
  ])('treats provider safety refusals as terminal rather than repairable empty calls',async response=>{
    const f=providerFixture('chatgpt',response);
    await expect(f.manager.complete(request,new AbortController().signal)).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',repairable:false});
    expect(f.complete).toHaveBeenCalledTimes(1);f.manager.dispose();
  });
  it('keeps an ordinary missing-context response distinct from a safety refusal',async()=>{
    const f=providerFixture('chatgpt',{calls:[],output:[],text:'I cannot answer without the source text.'});
    await expect(f.manager.complete(request,new AbortController().signal)).resolves.toMatchObject({text:'I cannot answer without the source text.'});f.manager.dispose();
  });
  it('blocks unsafe lesson narration before any local synthesis',async()=>{
    const synthesize=vi.fn(async()=>({samples:new Float32Array([0]),sampleRate:24000}));
    const service=new SpeechProvider({local:{synthesize,status:async()=>({recognitionReady:false,synthesisReady:true}),transcribe:async()=>'',installModel:async()=>({recognitionReady:false,synthesisReady:true}),cancel(){},dispose(){}},keyStore:{has:()=>false,load:()=>undefined,save(){},clear(){}},preferences:{getPreference:()=>undefined,setPreference(){}}});
    await expect(service.synthesize(unsafe,{requestId:'fixture-job',purpose:'lesson'})).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED'});
    expect(synthesize).not.toHaveBeenCalled();service.dispose();
  });
});
