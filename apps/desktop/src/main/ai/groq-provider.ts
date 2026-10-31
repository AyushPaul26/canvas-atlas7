import type {ModelInfo} from '@living-canvas/protocol';
import type {ApiKeyAIProvider,ProviderRequest} from './provider-contract';
import type {CompletedResponse} from './tool-stream';
import {GroqStreamError,groqAbortable,groqBodyText,groqDeadline,readGroqStream} from './groq-stream';
import {groqMessages,groqTools} from './groq-tools';
import {GroqAPIError,GroqToolGenerationError,groqAPIError} from './groq-errors';
export {GroqToolGenerationError} from './groq-errors';

const endpoint='https://api.groq.com/openai/v1';
// Groq's tool-use table documents these exact IDs. This orders only models
// actually returned by the catalog; other text models remain manual choices.
// https://console.groq.com/docs/tool-use/overview
const preferredTeachingModels=new Map([
  'openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b',
  'llama-3.3-70b-versatile','llama-3.1-8b-instant',
  'minimaxai/minimax-m2.7','meta-models/muse-spark-open',
].map((id,index)=>[id,index]));
function incompatibleTeachingModel(id:string):boolean{
  // Allam's documented 4,096-token context does not fit this application's
  // structured teaching prompts; catalog access alone cannot establish readiness.
  // https://console.groq.com/docs/model/allam-2-7b
  return id==='allam-2-7b'||/whisper|guard|orpheus|playai|tts|speech|audio|embed|moderation|compound/i.test(id);
}

export class GroqProvider implements ApiKeyAIProvider {
  readonly id='groq' as const;
  constructor(private getKey:()=>string|undefined,private request:typeof fetch=fetch){}
  private key():string{const key=this.getKey();if(!key?.trim())throw new Error('Connect a Groq API key in Teaching settings.');return key;}
  private async send(url:string,init:RequestInit,signal:AbortSignal):Promise<Response>{
    try{
      signal.throwIfAborted();const pending=this.request(url,{...init,signal});
      // Discard a late response from nonconforming fetch implementations.
      void pending.then(response=>{if(signal.aborted)void response.body?.cancel().catch(()=>undefined);},()=>undefined);
      const response=await groqAbortable(pending,signal);signal.throwIfAborted();return response;
    }catch{if(signal.aborted)throw signal.reason;throw new Error('Groq network connection failed. Check your connection and try again.');}
  }
  private async check(response:Response,signal:AbortSignal):Promise<void>{
    if(response.ok)return;
    let error:unknown;
    // Only this fixed code can enter generated-content repair. Raw error bodies,
    // failed_generation, keys, and arbitrary remote messages never leave here.
    if((response.status===400||response.status===422)&&response.body){
      try{const json=JSON.parse(await groqBodyText(response.body,signal,32_000));error=json?.error;}
      catch{if(signal.aborted)throw signal.reason;}
    }else void response.body?.cancel().catch(()=>undefined);
    throw groqAPIError(error,response.status);
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{return this.validateKey(this.key(),signal);}
  async validateKey(key:string,signal?:AbortSignal):Promise<ModelInfo[]>{
    if(!key.trim())throw new Error('Connect a Groq API key in Teaching settings.');
    return groqDeadline(signal,30_000,async active=>{
      const response=await this.send(`${endpoint}/models`,{method:'GET',headers:{Authorization:`Bearer ${key}`}},active);
      await this.check(response,active);if(!response.body)throw new Error('Groq returned an unsupported model catalog.');
      let json:any;try{json=JSON.parse(await groqBodyText(response.body,active));}catch{if(active.aborted)throw active.reason;throw new Error('Groq returned an unsupported model catalog.');}
      if(!Array.isArray(json?.data))throw new Error('Groq returned an unsupported model catalog.');
      const ids=new Set<string>(),models:ModelInfo[]=[];
      for(const item of json.data){
        const id=item?.id;
        if(typeof id!=='string'||id.length>200||!/^[a-zA-Z0-9][\w:./-]*$/.test(id)||item.active===false||ids.has(id))continue;
        // The catalog has no reliable tool-capability field. Exclude explicit
        // non-teaching families without claiming all other models are verified.
        if(incompatibleTeachingModel(id))continue;
        ids.add(id);models.push({id,name:id});
      }
      return models.sort((a,b)=>(preferredTeachingModels.get(a.id)??preferredTeachingModels.size)-(preferredTeachingModels.get(b.id)??preferredTeachingModels.size));
    });
  }
  async complete(request:ProviderRequest,signal:AbortSignal):Promise<CompletedResponse>{
    signal.throwIfAborted();
    const requestedModel=request.model,key=this.key(),scope=request.scope?{...request.scope}:undefined;
    if(incompatibleTeachingModel(requestedModel))throw new Error(`Groq model ${requestedModel==='allam-2-7b'?'allam-2-7b':'selection'} does not meet Canvas Atlas teaching requirements. Choose a model with tool support and a larger context window in Teaching settings.`);
    if(scope&&(scope.providerId!=='groq'||scope.modelId!==requestedModel))throw new Error('Groq teaching context has an incompatible provider scope.');
    const {tools,allowed}=groqTools(request.tools),messages=groqMessages(request,allowed);
    const payload=JSON.stringify({model:requestedModel,messages,...(tools.length?{tools,tool_choice:'required'}:{}),stream:true});
    if(new TextEncoder().encode(payload).byteLength>4_000_000)throw new Error('Groq teaching request exceeded the allowed size.');
    return groqDeadline(signal,180_000,async active=>{
      const response=await this.send(`${endpoint}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:payload},active);
      await this.check(response,active);if(!response.body)throw new Error('Groq did not return a response stream.');
      let completed:CompletedResponse;
      try{completed=await readGroqStream(response.body,active,allowed);}
      catch(error){if(active.aborted)throw active.reason;if(error instanceof GroqStreamError||error instanceof GroqAPIError||error instanceof GroqToolGenerationError)throw error;throw new GroqStreamError('Groq response stream failed. Your lesson is saved; try again.');}
      return {...completed,...(scope?{historyScope:scope}:{}),modelMetadata:{providerId:'groq',requestedModel,...(completed.servedModel?{servedModel:completed.servedModel}:{}),...(completed.responseId?{responseId:completed.responseId}:{}),completedAt:new Date().toISOString()}};
    });
  }
}
