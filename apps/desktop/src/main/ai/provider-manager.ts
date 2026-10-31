import {randomUUID} from 'node:crypto';
import {migrateTeachingSettings,teachingKeyInputSchema,teachingSelectionInputSchema,type ApiProviderId,type AppStatus,type ModelInfo,type ProviderId,type TeachingConfiguration,type TeachingConnection,type TeachingSettings} from '@living-canvas/protocol';
import {ApiKeyStore,type ApiKeyRecord} from '../auth/api-key-store';
import {sameProviderScope,type AIProvider,type ApiKeyAIProvider,type ProviderRequest,type ProviderScope} from './provider-contract';
import type {CompletedResponse} from './tool-stream';
import {assertLearnerSafe,buildLearnerSafetyInstructions} from '../../../../../packages/teacher/src/learner-safety';
import {buildIntentClassifierInstructions} from '../../../../../packages/teacher/src/intent-policy';
import type {SafetyEvaluation,SafetyGate} from '../safety/contracts';

type Options={auth:{status():AppStatus};providers:{chatgpt:AIProvider;gemini:ApiKeyAIProvider;groq:ApiKeyAIProvider};keyStores:{gemini:ApiKeyStore;groq:ApiKeyStore};preferences:{getPreference(key:string):string|undefined;setPreference(key:string,value:string):void};onBeforeChange?:()=>void;onChange?:()=>void};
const ids:ProviderId[]=['chatgpt','gemini','groq'];
const label=(id:ProviderId)=>({chatgpt:'ChatGPT',gemini:'Gemini',groq:'Groq'})[id];
const canceled=()=>new Error('The teaching connection changed. This operation was canceled.');
// Classify transport/storage failures into local copy; never relay arbitrary response bodies.
function safeFailure(id:ProviderId,error:unknown):string{
  const message=error instanceof Error?error.message.toLowerCase():'';
  if(message===canceled().message.toLowerCase())return canceled().message;
  if(/protection|encrypt|unlock/.test(message))return `Operating system credential protection is unavailable. Enable protected storage before connecting ${label(id)}.`;
  if(/settings could not be saved|preferences/.test(message))return 'Teaching settings could not be saved. Your previous connection is unchanged. Try again.';
  if(/quota|rate limit|credit|usage limit|429/.test(message))return `${label(id)} quota or rate limit reached. Review usage and billing, then retry when available.`;
  if(/permission|does not have access|plan access|403/.test(message))return `${label(id)} permission is unavailable. Review the account or API project permissions and reconnect.`;
  if(/key.*reject|reject.*key|invalid.*key|authorization|expired|revoked|401/.test(message))return id==='chatgpt'?'ChatGPT authorization expired or was revoked. Continue with ChatGPT again.':`${label(id)} API key was rejected. Replace it in Teaching Settings.`;
  if(/model.*unavailable|404/.test(message))return `${label(id)} model is unavailable. Refresh models and choose an available model in Settings.`;
  if(/timeout|timed out/.test(message))return `${label(id)} connection timed out. Check your connection and try again.`;
  return `${label(id)} connection could not be completed. Check the connection and try again.`;
}
export class ProviderManager implements AIProvider {
  private settings:TeachingSettings;
  private revision=0;
  private intent=0;
  private generations:Record<ProviderId,number>={chatgpt:0,gemini:0,groq:0};
  private catalogs:Record<ProviderId,number>={chatgpt:0,gemini:0,groq:0};
  private models:Record<ProviderId,ModelInfo[]>={chatgpt:[],gemini:[],groq:[]};
  private loaded=new Set<ProviderId>();
  private errors:Partial<Record<ProviderId,string>>={};
  private records:Partial<Record<ApiProviderId,ApiKeyRecord>>={};
  private controllers=new Set<AbortController>();
  private requests=new Set<AbortController>();
  private disposed=false;
  private chatRevision=randomUUID();
  private chatIdentity:string;
  private safety?:SafetyGate;
  constructor(private options:Options){
    this.settings=migrateTeachingSettings(options.preferences.getPreference('teachingSettings'),options.preferences.getPreference('selectedModel'));
    this.chatIdentity=this.authIdentity();
    for(const id of ['gemini','groq'] as const){try{this.records[id]=options.keyStores[id].load();}catch{this.errors[id]=`The saved ${label(id)} key could not be unlocked. Remove it and connect again.`;}}
  }
  get id(){return this.settings.activeProvider;}
  attachSafety(safety:SafetyGate){if(this.safety&&this.safety!==safety)throw new Error('The safety service is already attached.');this.safety=safety;}
  private authIdentity(){const status=this.options.auth.status();return JSON.stringify([status.connected,status.planEnabled,status.account?.id]);}
  private connected(id:ProviderId){return id==='chatgpt'?this.options.auth.status().connected:!!this.records[id];}
  private modelAvailable(id:ProviderId){const model=this.settings.models[id];return !!model&&this.models[id].some(item=>item.id===model);}
  private persist(settings=this.settings){this.options.preferences.setPreference('teachingSettings',JSON.stringify(settings));}
  private changed(){this.safety?.cancelAll();this.options.onBeforeChange?.();this.revision++;for(const controller of this.requests)controller.abort(canceled());this.options.onChange?.();}
  private notify(){this.options.onChange?.();}
  private assertAlive(){if(this.disposed)throw canceled();}
  configuration():TeachingConfiguration{
    const connections:TeachingConnection[]=ids.map(providerId=>({providerId,connected:this.connected(providerId),hasKey:providerId==='chatgpt'?false:this.options.keyStores[providerId].has(),models:this.models[providerId].map(model=>({...model})),...(this.settings.models[providerId]?{model:this.settings.models[providerId]}:{}),modelAvailable:this.modelAvailable(providerId),...(this.errors[providerId]?{error:this.errors[providerId]}:{})}));
    return {activeProvider:this.id,revision:this.revision,connections};
  }
  status():AppStatus{
    const auth=this.options.auth.status(),id=this.id,connected=this.connected(id),available=this.modelAvailable(id);
    const error=this.errors[id]??(id==='chatgpt'?auth.error:undefined);
    // Account state belongs to ChatGPT; teaching readiness belongs to the selected provider.
    const {model:_model,modelAvailable:_available,error:_error,...accountStatus}=auth;
    return {...accountStatus,teachingProvider:id,teachingConnected:connected,teachingReady:connected&&available&&(id!=='chatgpt'||auth.planEnabled),teachingRevision:this.revision,...(this.settings.models[id]?{model:this.settings.models[id]}:{}),modelAvailable:available,...(error?{error}:{})};
  }
  async refreshModels(providerId:ProviderId=this.id):Promise<TeachingConfiguration>{
    this.assertAlive();const id=teachingSelectionInputSchema.parse({providerId}).providerId;
    const generation=this.generations[id],catalog=++this.catalogs[id];
    if(!this.connected(id)){this.models[id]=[];this.loaded.delete(id);this.notify();return this.configuration();}
    const controller=new AbortController();this.controllers.add(controller);
    try{
      const models=await this.options.providers[id].listModels(controller.signal);
      if(this.disposed||generation!==this.generations[id]||catalog!==this.catalogs[id])return this.configuration();
      const wasAvailable=this.modelAvailable(id),previous=this.settings.models[id];
      if(!previous&&models.length){
        const next:TeachingSettings={...this.settings,models:{...this.settings.models,[id]:models[0].id}};
        this.persist(next);this.settings=next;
      }
      this.models[id]=models.map(model=>({...model}));this.loaded.add(id);delete this.errors[id];
      if(id===this.id&&(previous!==this.settings.models[id]||wasAvailable!==this.modelAvailable(id)))this.changed();else this.notify();
    }catch(error){
      if(!this.disposed&&generation===this.generations[id]&&catalog===this.catalogs[id]){this.errors[id]=safeFailure(id,error);this.notify();}
    }finally{this.controllers.delete(controller);}
    return this.configuration();
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{signal?.throwIfAborted();const models=await this.getModels();signal?.throwIfAborted();return models;}
  async getModels():Promise<ModelInfo[]>{await this.refreshModels();return this.models[this.id].map(model=>({...model}));}
  async select(selection:{providerId:ProviderId;modelId?:string}):Promise<TeachingConfiguration>{
    this.assertAlive();const value=teachingSelectionInputSchema.parse(selection);this.intent++;
    if(value.modelId&&!this.models[value.providerId].some(model=>model.id===value.modelId))throw new Error(`The selected ${label(value.providerId)} model is unavailable. Refresh models and choose an available model.`);
    const oldId=this.id,oldModel=this.settings.models[value.providerId];
    const next:TeachingSettings={...this.settings,activeProvider:value.providerId,models:{...this.settings.models,...(value.modelId?{[value.providerId]:value.modelId}:{})}};
    this.persist(next);this.settings=next;if(oldId!==this.id||oldModel!==this.settings.models[this.id])this.changed();else this.notify();
    if(!this.loaded.has(value.providerId)&&this.connected(value.providerId))await this.refreshModels(value.providerId);
    return this.configuration();
  }
  async connectKey(providerId:ApiProviderId,key:string):Promise<TeachingConfiguration>{
    this.assertAlive();const input=teachingKeyInputSchema.parse({providerId,key}),id=input.providerId;
    const intent=++this.intent,generation=++this.generations[id],controller=new AbortController();this.controllers.add(controller);
    try{
      const models=await this.options.providers[id].validateKey(input.key,controller.signal);
      if(this.disposed||intent!==this.intent||generation!==this.generations[id])throw canceled();
      const record={key:input.key,credentialRevision:randomUUID()};
      const next:TeachingSettings={...this.settings,activeProvider:id,models:{...this.settings.models,...(!this.settings.models[id]&&models.length?{[id]:models[0].id}:{})}};
      const staged=this.options.keyStores[id].stage(record);
      try{
        this.persist(next);
        try{staged.commit();}catch(error){this.persist(this.settings);throw error;}
      }finally{staged.rollback();}
      // An old-key catalog may have started while validation was pending.
      this.catalogs[id]++;
      this.records[id]=record;this.models[id]=models.map(model=>({...model}));this.loaded.add(id);delete this.errors[id];
      this.settings=next;this.changed();return this.configuration();
    }catch(error){
      // eslint-disable-next-line preserve-caught-error -- Storage/transport causes can contain credentials; only fixed public diagnostics leave this boundary.
      throw new Error(safeFailure(id,error));
    }finally{this.controllers.delete(controller);}
  }
  clearKey(providerId:ApiProviderId):TeachingConfiguration{
    this.assertAlive();const id=teachingKeyInputSchema.shape.providerId.parse(providerId);this.intent++;this.generations[id]++;
    this.options.keyStores[id].clear();delete this.records[id];delete this.errors[id];this.models[id]=[];this.loaded.delete(id);
    if(id===this.id)this.changed();else this.notify();return this.configuration();
  }
  async ensureReady():Promise<ProviderScope>{
    this.assertAlive();const id=this.id,intent=this.intent;
    if(!this.connected(id))throw new Error(id==='chatgpt'?'Continue with ChatGPT to begin your lesson.':`Connect a ${label(id)} API key in Settings to begin your lesson.`);
    if(id==='chatgpt'&&!this.options.auth.status().planEnabled)throw new Error('ChatGPT plan use was not enabled. Continue with ChatGPT and grant plan access.');
    if(!this.loaded.has(id))await this.refreshModels(id);
    if(this.disposed||id!==this.id||intent!==this.intent)throw canceled();
    if(!this.modelAvailable(id))throw new Error(this.errors[id]??`The selected ${label(id)} model is unavailable. Choose an available model in Settings.`);
    const scope=this.scope();if(!scope)throw canceled();return scope;
  }
  scope():ProviderScope|undefined{
    const id=this.id,modelId=this.settings.models[id];if(!modelId||!this.connected(id))return undefined;
    if(id==='chatgpt')return {providerId:id,modelId,credentialRevision:this.chatRevision,...(this.options.auth.status().account?.id?{accountId:this.options.auth.status().account!.id}:{})};
    const record=this.records[id];return record?{providerId:id,modelId,credentialRevision:record.credentialRevision}:undefined;
  }
  identity():string{return JSON.stringify([this.revision,this.scope()??{providerId:this.id,modelId:this.settings.models[this.id]}]);}
  /** A separate fixed text channel cannot invoke teaching tools or recursively
   * authorize itself. Only the policy service consumes this private verdict. */
  async classifySafety(evaluation:SafetyEvaluation,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();const scope=await this.ensureReady();signal.throwIfAborted();
    const revision=this.revision,controller=new AbortController();this.requests.add(controller);
    const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(30000)]);
    try{
      const content=JSON.stringify(evaluation);
      if(Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Safety classification content is too large.');
      const result=await this.options.providers[scope.providerId].complete({model:scope.modelId,instructions:buildIntentClassifierInstructions(),input:[{role:'user',content}],tools:[],scope},combined);
      combined.throwIfAborted();if(this.disposed||revision!==this.revision||!sameProviderScope(scope,this.scope()))throw canceled();
      if(result.calls.length||typeof result.text!=='string'||Buffer.byteLength(result.text,'utf8')>8192)throw new Error('Safety classification returned invalid data.');
      try{return JSON.parse(result.text);}catch{throw new Error('Safety classification returned invalid data.');}
    }finally{this.requests.delete(controller);}
  }
  async complete(request:ProviderRequest,signal:AbortSignal):Promise<CompletedResponse>{
    signal.throwIfAborted();if(this.safety){if(!request.safetyPermit||!request.safetyTask)throw new Error('Safety approval is required before generating learning material.');this.safety.assertCurrent(request.safetyPermit,request.safetyTask);}
    assertLearnerSafe(request.input,'learner-input');const scope=await this.ensureReady();signal.throwIfAborted();
    if(request.model!==scope.modelId||!sameProviderScope(scope,this.scope())||request.scope&&!sameProviderScope(request.scope,scope))throw canceled();
    const revision=this.revision,controller=new AbortController();this.requests.add(controller);
    const combined=AbortSignal.any([signal,controller.signal]);
    try{
      if(request.safetyPermit)this.safety?.assertCurrent(request.safetyPermit,request.safetyTask);
      const {safetyPermit:_permit,safetyTask:_task,...wireRequest}=request;
      const result=await this.options.providers[scope.providerId].complete({...wireRequest,instructions:`${request.instructions}\n\n${buildLearnerSafetyInstructions()}`,scope},combined);
      combined.throwIfAborted();if(this.disposed||revision!==this.revision||!sameProviderScope(scope,this.scope()))throw canceled();
      assertLearnerSafe(result,'model-output');
      if(request.safetyPermit)this.safety?.assertCurrent(request.safetyPermit,request.safetyTask);
      await this.safety?.inspect(result,'model-output',combined);
      combined.throwIfAborted();if(this.disposed||revision!==this.revision||!sameProviderScope(scope,this.scope()))throw canceled();
      if(request.safetyPermit)this.safety?.assertCurrent(request.safetyPermit,request.safetyTask);
      const completed:CompletedResponse={...result,historyScope:{...scope},modelMetadata:{...(result.servedModel?{servedModel:result.servedModel}:{}),...(result.responseId?{responseId:result.responseId}:{}),...result.modelMetadata,providerId:scope.providerId,requestedModel:scope.modelId,completedAt:result.modelMetadata?.completedAt??new Date().toISOString()}};
      this.safety?.derive(completed,[result],'model-output');return completed;
    }finally{this.requests.delete(controller);}
  }
  authChanged(){
    const identity=this.authIdentity();if(identity===this.chatIdentity)return;
    this.chatIdentity=identity;this.chatRevision=randomUUID();this.generations.chatgpt++;this.models.chatgpt=[];this.loaded.delete('chatgpt');delete this.errors.chatgpt;
    if(this.id==='chatgpt'){this.intent++;this.changed();}else this.notify();
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.intent++;for(const controller of [...this.requests,...this.controllers])controller.abort(canceled());this.requests.clear();this.controllers.clear();}
}
