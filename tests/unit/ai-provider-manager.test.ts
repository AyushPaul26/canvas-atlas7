import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AppStatus,ModelInfo} from '@living-canvas/protocol';
import {ApiKeyStore} from '../../apps/desktop/src/main/auth/api-key-store';
import {ProviderManager} from '../../apps/desktop/src/main/ai/provider-manager';
import type {AIProvider,ApiKeyAIProvider,ProviderRequest} from '../../apps/desktop/src/main/ai/provider-contract';
import type {CompletedResponse} from '../../apps/desktop/src/main/ai/tool-stream';
import type {SafetyEvaluation,SafetyGate,SafetyPermit} from '../../apps/desktop/src/main/safety/contracts';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';

const directories:string[]=[];
const protect={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(Buffer.from(value).map(v=>v^123)),decryptString:(value:Buffer)=>Buffer.from(Buffer.from(value).map(v=>v^123)).toString()};
const catalog=[{id:'exact/model',name:'Exact model'}];
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(saved?:string){
  const dir=mkdtempSync(join(tmpdir(),'canvas-ai-manager-'));directories.push(dir);
  const values=new Map<string,string>(saved?[['teachingSettings',saved]]:[]);
  const preferences={getPreference:(k:string)=>values.get(k),setPreference:(k:string,v:string)=>{values.set(k,v);}};
  let authStatus:AppStatus={connected:false,planEnabled:false,desktop:true};
  const response:CompletedResponse={calls:[],output:[],text:''};
  const providers:{chatgpt:AIProvider;gemini:ApiKeyAIProvider;groq:ApiKeyAIProvider}={
    chatgpt:{id:'chatgpt',listModels:async()=>catalog,complete:async()=>response},
    gemini:{id:'gemini',listModels:async()=>catalog,validateKey:async()=>catalog,complete:async()=>response},
    groq:{id:'groq',listModels:async()=>catalog,validateKey:async()=>catalog,complete:async()=>response}
  };
  const keyStores={gemini:new ApiKeyStore(join(dir,'gemini.enc'),protect),groq:new ApiKeyStore(join(dir,'groq.enc'),protect)};
  let changes=0;const options={auth:{status:()=>authStatus},providers,keyStores,preferences,onBeforeChange:()=>{changes++;}};
  const manager=new ProviderManager(options);
  return {manager,options,providers,keyStores,values,get changes(){return changes;},setAuth:(value:AppStatus)=>{authStatus=value;manager.authChanged();}};
}
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
const request:ProviderRequest={model:'exact/model',instructions:'Teach',input:[],tools:[]};
const approvedTask={operation:'topic' as const,originalRequest:'Explain energy.'};
const validPermit:SafetyPermit={token:'valid',policyVersion:'fixture-v1',binding:'fixture-binding'};
function gate(){
  const inspected:unknown[]=[];
  const safety:SafetyGate={authorize:async()=>validPermit,assertCurrent:permit=>{if(permit!==validPermit)throw new Error('Safety approval is required.');},inspect:async content=>{inspected.push(content);},isApproved:()=>true,assertApproved:()=>{},derive:()=>{},registerTrusted:()=>{},cancel:()=>{},cancelAll:()=>{}};
  return {safety,inspected};
}
describe('semantic safety provider transport',()=>{
  it('preserves reviewed output provenance through manager-owned model metadata without another classifier call',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');let classifications=0;
    const safety=new SafetyGuardian({secret:new Uint8Array(32).fill(8),identity:()=>f.manager.identity(),classify:async()=>{classifications++;return {decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};}});f.manager.attachSafety(safety);
    f.providers.gemini.complete=async()=>({calls:[],output:[],text:'Energy is conserved.'});const permit=await safety.authorize(approvedTask);
    const completed=await f.manager.complete({...request,safetyPermit:permit,safetyTask:approvedTask},new AbortController().signal);await safety.inspect(completed,'model-output');
    expect(completed.modelMetadata?.providerId).toBe('gemini');expect(classifications).toBe(2);
  });
  it('requires a genuine current backend permit before generation when attached',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');const g=gate();f.manager.attachSafety(g.safety);let calls=0;
    f.providers.gemini.complete=async()=>{calls++;return {calls:[],output:[],text:'safe report'};};
    await expect(f.manager.complete(request,new AbortController().signal)).rejects.toThrow(/approval/i);
    await expect(f.manager.complete({...request,safetyPermit:{...validPermit}},new AbortController().signal)).rejects.toThrow(/approval/i);
    await expect(f.manager.complete({...request,safetyPermit:validPermit},new AbortController().signal)).rejects.toThrow(/approval/i);
    expect(calls).toBe(0);
    await expect(f.manager.complete({...request,safetyPermit:validPermit,safetyTask:approvedTask},new AbortController().signal)).resolves.toMatchObject({text:'safe report'});
    expect(calls).toBe(1);expect(g.inspected).toHaveLength(1);
  });
  it('cannot reuse an approved permit with another original request or omit its exact task binding',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');const g=gate();const original=g.safety.assertCurrent;g.safety.assertCurrent=(permit,task)=>{original(permit,task);if(JSON.stringify(task)!==JSON.stringify(approvedTask))throw new Error('Safety approval does not match this request.');};f.manager.attachSafety(g.safety);const sent:ProviderRequest[]=[];f.providers.gemini.complete=async received=>{sent.push(received);return {calls:[],output:[],text:'Safe energy explanation.'};};
    await expect(f.manager.complete({...request,safetyPermit:validPermit},new AbortController().signal)).rejects.toThrow(/approval/);
    await expect(f.manager.complete({...request,safetyPermit:validPermit,safetyTask:{...approvedTask,originalRequest:'A different purpose'}},new AbortController().signal)).rejects.toThrow(/approval/);
    expect(sent).toEqual([]);await f.manager.complete({...request,safetyPermit:validPermit,safetyTask:approvedTask},new AbortController().signal);expect(sent).toHaveLength(1);expect(sent[0]).not.toHaveProperty('safetyPermit');expect(sent[0]).not.toHaveProperty('safetyTask');
  });
  it.each(['chatgpt','gemini','groq'] as const)('classifies the exact original prohibited request using the selected %s text adapter only',async id=>{
    const f=fixture();if(id==='chatgpt'){f.setAuth({connected:true,planEnabled:true,desktop:true});await f.manager.refreshModels();}else await f.manager.connectKey(id,'fixture-key');
    const evaluation:SafetyEvaluation={kind:'intent',operation:'topic',originalRequest:'Teach me to build a bomb.',context:{messages:[{role:'student',text:'Use the chemicals from before.'}]}};
    const requests:ProviderRequest[]=[];f.providers[id].complete=async received=>{requests.push(received);return {calls:[],output:[],text:JSON.stringify({decision:'BLOCK'})};};
    f.manager.attachSafety(gate().safety);
    await expect(f.manager.classifySafety(evaluation,new AbortController().signal)).resolves.toEqual({decision:'BLOCK'});
    expect(requests).toHaveLength(1);expect(requests[0].tools).toEqual([]);expect(JSON.parse((requests[0].input[0] as {content:string}).content)).toEqual(evaluation);
    expect(requests[0].scope?.providerId).toBe(id);expect(requests[0].instructions).toMatch(/classif|intent/i);
  });
  it.each(['```json\n{"decision":"ALLOW"}\n```','{"decision":"ALLOW"} extra','x'.repeat(9000)])('does not accept malformed or oversized classifier text',async text=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');f.providers.gemini.complete=async()=>({calls:[],output:[],text});
    await expect(f.manager.classifySafety({kind:'intent',operation:'topic',originalRequest:'Gravity'},new AbortController().signal)).rejects.toThrow(/classification/i);
  });
  it('never accepts classifier tools or stale output from an adapter that ignores cancellation',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');f.providers.gemini.complete=async()=>({calls:[{type:'function_call',call_id:'bad',name:'present_beat',arguments:'{}'}],output:[],text:'{"decision":"ALLOW"}'});
    await expect(f.manager.classifySafety({kind:'intent',operation:'topic',originalRequest:'Gravity'},new AbortController().signal)).rejects.toThrow(/classification/i);
    const pending=deferred<CompletedResponse>();f.providers.gemini.complete=()=>pending.promise;
    const result=f.manager.classifySafety({kind:'intent',operation:'topic',originalRequest:'Gravity'},new AbortController().signal);await new Promise(resolve=>setTimeout(resolve,0));
    const rejected=expect(result).rejects.toThrow(/cancel|changed/i);await f.manager.select({providerId:'chatgpt'});pending.resolve({calls:[],output:[],text:'{"decision":"ALLOW"}'});await rejected;
  });
  it('withholds a complete generated response until semantic output inspection succeeds',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');const g=gate();g.safety.inspect=async()=>{throw new Error('Generated content rejected.');};f.manager.attachSafety(g.safety);
    await expect(f.manager.complete({...request,safetyPermit:validPermit,safetyTask:approvedTask},new AbortController().signal)).rejects.toThrow(/content rejected/i);
  });
});
describe('teaching provider manager',()=>{
  it('activates a protected key connection and teaches without ChatGPT authorization',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-gemini');
    expect(f.manager.status()).toMatchObject({connected:false,teachingProvider:'gemini',teachingConnected:true,teachingReady:true,model:'exact/model'});
    expect(await f.manager.ensureReady()).toMatchObject({providerId:'gemini',modelId:'exact/model'});
    const result=await f.manager.complete(request,new AbortController().signal);
    expect(result.modelMetadata).toMatchObject({providerId:'gemini',requestedModel:'exact/model'});
    expect(result.historyScope).toMatchObject({providerId:'gemini',modelId:'exact/model'});
    expect(JSON.stringify(f.manager.configuration())).not.toContain('fixture-gemini');
    const restart=new ProviderManager(f.options);await restart.refreshModels();
    expect(restart.status()).toMatchObject({teachingProvider:'gemini',teachingReady:true});
    expect(restart.scope()?.credentialRevision).toBe(f.manager.scope()?.credentialRevision);
  });
  it('migrates the legacy model only into ChatGPT',()=>{
    const f=fixture();f.values.set('selectedModel','legacy-model');const manager=new ProviderManager(f.options);
    expect(manager.configuration()).toMatchObject({activeProvider:'chatgpt'});
    expect(manager.configuration().connections.find(x=>x.providerId==='chatgpt')?.model).toBe('legacy-model');
    expect(manager.configuration().connections.find(x=>x.providerId==='gemini')?.model).toBeUndefined();
  });
  it('preserves an unavailable remembered model while activating its connected provider',async()=>{
    const f=fixture(JSON.stringify({version:1,activeProvider:'chatgpt',models:{gemini:'remembered/missing'}}));
    await f.manager.connectKey('gemini','fixture-gemini');
    expect(f.manager.status()).toMatchObject({teachingProvider:'gemini',teachingConnected:true,teachingReady:false,model:'remembered/missing',modelAvailable:false});
    await expect(f.manager.ensureReady()).rejects.toThrow(/model/i);
    await f.manager.select({providerId:'gemini',modelId:'exact/model'});expect(f.manager.status().teachingReady).toBe(true);
  });
  it('preserves the prior key, selection and revision on rejected validation or protected save',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-old');const before=f.manager.configuration();const revision=f.manager.scope()?.credentialRevision;
    f.providers.gemini.validateKey=async()=>{throw new Error('Rejected fixture-new');};
    await expect(f.manager.connectKey('gemini','fixture-new')).rejects.toThrow();expect(f.manager.configuration()).toEqual(before);
    f.providers.gemini.validateKey=async()=>catalog;f.keyStores.gemini.stage=()=>{throw new Error('Protection unavailable');};
    await expect(f.manager.connectKey('gemini','fixture-new')).rejects.toThrow();
    expect(f.manager.scope()?.credentialRevision).toBe(revision);expect(f.keyStores.gemini.load()?.key).toBe('fixture-old');
  });
  it.each([false,true])('rolls back protected credentials and configuration if activation preference save fails (existing key: %s)',async existing=>{
    const f=fixture();if(existing)await f.manager.connectKey('gemini','fixture-old');
    const before=f.manager.configuration(),credential=f.keyStores.gemini.load(),changes=f.changes;
    f.options.preferences.setPreference=()=>{throw new Error('Preferences unavailable');};
    await expect(f.manager.connectKey('gemini','fixture-new')).rejects.toThrow();
    expect(f.manager.configuration()).toEqual(before);expect(f.keyStores.gemini.load()).toEqual(credential);expect(f.changes).toBe(changes);
  });
  it('retains disk credentials and restart scope when both preference persistence and rollback encryption fail',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-old');const before=f.manager.scope();
    const encrypt=protect.encryptString;
    f.options.preferences.setPreference=()=>{protect.encryptString=()=>{throw new Error('Protection unavailable during rollback');};throw new Error('Preferences unavailable');};
    try{
      await expect(f.manager.connectKey('gemini','fixture-new')).rejects.toThrow();
      expect(f.keyStores.gemini.load()?.key).toBe('fixture-old');
      expect(f.keyStores.gemini.load()?.credentialRevision).toBe(before?.credentialRevision);
      expect(f.manager.scope()).toEqual(before);
      const restart=new ProviderManager(f.options);await restart.refreshModels();expect(restart.scope()).toEqual(before);
    }finally{protect.encryptString=encrypt;}
  });
  it('does not publish an initial default model or catalog when persisting that model fails',async()=>{
    const f=fixture();f.setAuth({connected:true,planEnabled:true,desktop:true,account:{id:'fixture-account'}});const before=f.manager.configuration(),changes=f.changes;
    f.options.preferences.setPreference=()=>{throw new Error('Preferences unavailable');};await f.manager.refreshModels();
    const connection=f.manager.configuration().connections.find(item=>item.providerId==='chatgpt');
    expect(connection).toMatchObject({models:[],modelAvailable:false});expect(connection?.model).toBeUndefined();
    expect(f.manager.configuration().revision).toBe(before.revision);expect(f.changes).toBe(changes);expect(f.manager.status().teachingReady).toBe(false);
    // A failed initial refresh must remain retryable rather than marking the catalog loaded.
    f.options.preferences.setPreference=(key,value)=>{f.values.set(key,value);};await f.manager.ensureReady();expect(f.manager.status().teachingReady).toBe(true);
  });
  it.each([false,true])('a catalog refresh does not cancel a pending valid key connection (existing key: %s)',async existing=>{
    const f=fixture();if(existing)await f.manager.connectKey('gemini','fixture-old');
    const validation=deferred<ModelInfo[]>(),oldCatalog=deferred<ModelInfo[]>();f.providers.gemini.validateKey=()=>validation.promise;f.providers.gemini.listModels=()=>oldCatalog.promise;
    const pending=f.manager.connectKey('gemini','fixture-new');const refresh=f.manager.refreshModels('gemini');
    validation.resolve([{id:'new/model',name:'New'}]);await expect(pending).resolves.toMatchObject({activeProvider:'gemini'});
    oldCatalog.resolve([{id:'old/model',name:'Old'}]);await refresh;
    expect(f.keyStores.gemini.load()?.key).toBe('fixture-new');expect(f.manager.configuration().connections.find(item=>item.providerId==='gemini')?.models).toEqual([{id:'new/model',name:'New'}]);
  });
  it('preserves provider and model when saving an explicit selection fails',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-old');const before=f.manager.configuration();
    f.options.preferences.setPreference=()=>{throw new Error('Preferences unavailable');};
    await expect(f.manager.select({providerId:'chatgpt'})).rejects.toThrow();
    expect(f.manager.configuration()).toEqual(before);
  });
  it('rejects an explicit unavailable model without mutating the remembered selection',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-old');const before=f.manager.configuration();
    await expect(f.manager.select({providerId:'gemini',modelId:'missing/model'})).rejects.toThrow(/model/i);
    expect(f.manager.configuration()).toEqual(before);
  });
  it('keeps the latest user connect when validations finish in reverse order',async()=>{
    const f=fixture();const slow=deferred<ModelInfo[]>();f.providers.gemini.validateKey=()=>slow.promise;
    const first=f.manager.connectKey('gemini','fixture-first');const canceled=expect(first).rejects.toThrow(/cancel|chang|supersed/i);
    await f.manager.connectKey('groq','fixture-latest');slow.resolve(catalog);await canceled;
    expect(f.manager.configuration().activeProvider).toBe('groq');expect(f.keyStores.gemini.has()).toBe(false);
  });
  it('does not overwrite a later replacement of the same provider key',async()=>{
    const f=fixture(),slow=deferred<ModelInfo[]>();f.providers.gemini.validateKey=async key=>key==='fixture-first'?slow.promise:catalog;
    const first=f.manager.connectKey('gemini','fixture-first');const canceled=expect(first).rejects.toThrow();
    await f.manager.connectKey('gemini','fixture-latest');const revision=f.manager.scope()?.credentialRevision;
    slow.resolve([{id:'old-model',name:'Old'}]);await canceled;
    expect(f.keyStores.gemini.load()?.key).toBe('fixture-latest');expect(f.manager.scope()?.credentialRevision).toBe(revision);
    expect(f.manager.status().model).toBe('exact/model');
  });
  it('uses a new durable scope for every successful key replacement',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-old');const first=f.manager.scope()?.credentialRevision;
    await f.manager.connectKey('gemini','fixture-new');const second=f.manager.scope()?.credentialRevision;
    expect(first).not.toBe(second);expect(f.keyStores.gemini.load()?.credentialRevision).toBe(second);
    expect(f.manager.status().model).toBe('exact/model');
  });
  it('connects an empty catalog without pretending teaching is ready',async()=>{
    const f=fixture();f.providers.groq.validateKey=async()=>[];await f.manager.connectKey('groq','fixture-groq');
    expect(f.manager.status()).toMatchObject({teachingProvider:'groq',teachingConnected:true,teachingReady:false,modelAvailable:false});
    await expect(f.manager.ensureReady()).rejects.toThrow(/model/i);
  });
  it.each([
    ['Gemini API key was rejected. Replace it in Teaching Settings.','key'],
    ['Gemini quota or rate limit reached. Review API billing and quota, then retry when available.','quota'],
    ['Gemini API key or project does not have access. Review API permissions in Google AI Studio.','permission']
  ])('retains actionable catalog failure category: %s',async(message,category)=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-key');f.providers.gemini.listModels=async()=>{throw new Error(message);};
    await f.manager.refreshModels('gemini');expect(f.manager.status().error?.toLowerCase()).toContain(category);
  });
  it('does not expose arbitrary validation error bodies',async()=>{
    const f=fixture();f.providers.gemini.validateKey=async()=>{throw new Error('Remote diagnostics: fixture-private-other-data');};
    await expect(f.manager.connectKey('gemini','fixture-key')).rejects.not.toThrow(/fixture-private-other-data/);
  });
  it('recognizes the Groq rejected-key diagnostic as a key recovery action',async()=>{
    const f=fixture();f.providers.groq.validateKey=async()=>{throw new Error('Groq rejected the API key. Replace it in Teaching Settings.');};
    await expect(f.manager.connectKey('groq','fixture-groq')).rejects.toThrow(/key.*rejected.*replace/i);
  });
  it.each(['select','remove'] as const)('does not restore a key after later %s intent',async action=>{
    const f=fixture();const slow=deferred<ModelInfo[]>();f.providers.gemini.validateKey=()=>slow.promise;
    const first=f.manager.connectKey('gemini','fixture-first');const canceled=expect(first).rejects.toThrow();
    if(action==='select')await f.manager.select({providerId:'chatgpt'});else f.manager.clearKey('gemini');
    slow.resolve(catalog);await canceled;expect(f.keyStores.gemini.has()).toBe(false);expect(f.manager.configuration().activeProvider).toBe('chatgpt');
  });
  it('aborts and rejects stale completion even when the adapter ignores abort',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-first');const slow=deferred<CompletedResponse>();let signal:AbortSignal|undefined;
    f.providers.gemini.complete=async(_,value)=>{signal=value;return slow.promise;};
    const pending=f.manager.complete(request,new AbortController().signal);await Promise.resolve();await Promise.resolve();
    await f.manager.connectKey('groq','fixture-next');expect(signal?.aborted).toBe(true);
    slow.resolve({calls:[],output:[],text:'stale'});await expect(pending).rejects.toThrow(/abort|chang|stale/i);
  });
  it('preserves active API work when an inactive key is removed or ChatGPT signs out',async()=>{
    const f=fixture();await f.manager.connectKey('groq','fixture-groq');await f.manager.connectKey('gemini','fixture-gemini');const before=f.manager.identity(),changes=f.changes;
    f.manager.clearKey('groq');f.setAuth({connected:false,planEnabled:false,desktop:true});
    expect(f.manager.identity()).toBe(before);expect(f.changes).toBe(changes);expect(f.manager.status().teachingReady).toBe(true);
  });
  it('discards model refresh results after removing that key',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-gemini');const slow=deferred<ModelInfo[]>();f.providers.gemini.listModels=()=>slow.promise;
    const refresh=f.manager.refreshModels('gemini');f.manager.clearKey('gemini');slow.resolve([{id:'late-model',name:'Late'}]);await refresh;
    expect(f.manager.configuration().connections.find(x=>x.providerId==='gemini')).toMatchObject({connected:false,models:[],hasKey:false});
  });
  it('requires ChatGPT authorization and never silently falls back to another saved key',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-gemini');await f.manager.select({providerId:'chatgpt'});
    await expect(f.manager.ensureReady()).rejects.toThrow(/ChatGPT/i);expect(f.manager.configuration().activeProvider).toBe('chatgpt');
  });
  it('invalidates ChatGPT generation when its account changes',async()=>{
    const f=fixture();f.setAuth({connected:true,planEnabled:true,desktop:true,account:{id:'account-one'}});await f.manager.refreshModels();
    const slow=deferred<CompletedResponse>();f.providers.chatgpt.complete=()=>slow.promise;
    const pending=f.manager.complete(request,new AbortController().signal);await Promise.resolve();await Promise.resolve();
    f.setAuth({connected:true,planEnabled:true,desktop:true,account:{id:'account-two'}});
    slow.resolve({calls:[],output:[],text:'old account'});await expect(pending).rejects.toThrow(/chang|abort/i);
  });
  it('preserves served-model provenance even if the adapter did not build metadata',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-gemini');
    f.providers.gemini.complete=async()=>({calls:[],output:[],text:'',servedModel:'served/model',responseId:'response-123'});
    expect((await f.manager.complete(request,new AbortController().signal)).modelMetadata).toMatchObject({providerId:'gemini',requestedModel:'exact/model',servedModel:'served/model',responseId:'response-123'});
  });
  it('rejects completion after disposal even when an adapter ignores cancellation',async()=>{
    const f=fixture();await f.manager.connectKey('gemini','fixture-gemini');const slow=deferred<CompletedResponse>();f.providers.gemini.complete=()=>slow.promise;
    const pending=f.manager.complete(request,new AbortController().signal);await Promise.resolve();await Promise.resolve();f.manager.dispose();
    slow.resolve({calls:[],output:[],text:'stale'});await expect(pending).rejects.toThrow(/chang|abort/i);
  });
});
