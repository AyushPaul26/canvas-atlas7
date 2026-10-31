import type {ModelInfo} from '@living-canvas/protocol';
import {sameProviderScope,type ApiKeyAIProvider,type ProviderRequest} from './provider-contract';
import {geminiAbortable,geminiError,readGeminiStream} from './gemini-stream';
import {canonicalGeminiTool,geminiInstructions,geminiToolName,geminiTools} from './gemini-tools';

const base='https://generativelanguage.googleapis.com/v1beta';
// Rank only exact IDs actually returned by the catalog. Google's current
// new-project guidance prefers these over access-restricted legacy2.5 models.
// https://ai.google.dev/gemini-api/docs/deprecations/
const preferredTeachingModels=new Map(['gemini-3.5-flash-lite','gemini-3.8-flash'].map((id,index)=>[id,index]));
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function deadline(signal:AbortSignal|undefined,milliseconds:number){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new Error('Gemini request timed out. Try again.')),milliseconds);
  return {signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,dispose:()=>clearTimeout(timer)};
}
export class GeminiProvider implements ApiKeyAIProvider {
  readonly id='gemini' as const;
  constructor(private getKey:()=>string|undefined,private request:typeof fetch=fetch){}
  listModels(signal?:AbortSignal):Promise<ModelInfo[]>{return this.validateKey(this.key(),signal);}
  async validateKey(key:string,signal?:AbortSignal):Promise<ModelInfo[]>{
    if(!key.trim())throw new Error('Gemini API key is missing. Connect a key in Teaching Settings.');
    const bounded=deadline(signal,30_000);const models=new Map<string,ModelInfo>();const tokens=new Set<string>();let pageToken='';
    try{
      do{
        bounded.signal.throwIfAborted();const query=new URLSearchParams({pageSize:'1000',...(pageToken?{pageToken}:{})});
        const response=await geminiAbortable(this.request(`${base}/models?${query}`,{headers:{'x-goog-api-key':key},signal:bounded.signal}),bounded.signal);
        if(!response.ok)throw await this.httpError(response,bounded.signal);
        const json=await this.catalogJson(response,bounded.signal);
        if(!object(json)||!Array.isArray(json.models))throw new Error('Gemini returned an unsupported model catalog.');
        for(const item of json.models){
          if(!object(item)||typeof item.name!=='string'||!/^models\/gemini-[\w.-]+$/.test(item.name)||!Array.isArray(item.supportedGenerationMethods))continue;
          const id=item.name.slice(7);
          if(!item.supportedGenerationMethods.some((method:unknown)=>method==='generateContent'||method==='createInteraction')||/(?:image|tts|audio|native-audio|embedding|robotics|omni|live)/i.test(id))continue;
          models.set(id,{id,name:typeof item.displayName==='string'?item.displayName.slice(0,200):id});
        }
        if(json.nextPageToken!==undefined&&(typeof json.nextPageToken!=='string'||json.nextPageToken.length>4096))throw new Error('Gemini returned an unsupported model catalog page.');
        pageToken=json.nextPageToken??'';
        if(pageToken&&(tokens.has(pageToken)||tokens.size>=100))throw new Error('Gemini returned a looping model catalog.');
        if(pageToken)tokens.add(pageToken);
      }while(pageToken);
      return [...models.values()].sort((a,b)=>(preferredTeachingModels.get(a.id)??preferredTeachingModels.size)-(preferredTeachingModels.get(b.id)??preferredTeachingModels.size));
    }catch(error){this.rethrow(error,bounded.signal);}finally{bounded.dispose();}
  }
  async complete(request:ProviderRequest,signal:AbortSignal){
    const snapshot=structuredClone(request);const key=this.key();const bounded=deadline(signal,180_000);
    try{
      bounded.signal.throwIfAborted();const tools=geminiTools(snapshot.tools);const input=this.input(snapshot);
      const response=await geminiAbortable(this.request(`${base}/interactions?alt=sse`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({model:snapshot.model,system_instruction:geminiInstructions(snapshot.instructions),input,tools,store:false,stream:true}),signal:bounded.signal}),bounded.signal);
      if(!response.ok)throw await this.httpError(response,bounded.signal,snapshot.model);if(!response.body)throw new Error('Gemini did not return a response stream.');
      const completed=await readGeminiStream(response.body,bounded.signal);
      const allowed=new Set(tools.map(tool=>tool.name));
      if(completed.calls.some(call=>!allowed.has(geminiToolName(call.namespace,call.name))))throw new Error('Gemini returned a teaching tool that was not requested.');
      return {...completed,output:completed.output.map(item=>({...item,...(snapshot.scope?{scope:snapshot.scope}:{})})),...(snapshot.scope?{historyScope:snapshot.scope}:{}),modelMetadata:{providerId:this.id,requestedModel:snapshot.model,...(completed.servedModel?{servedModel:completed.servedModel}:{}),...(completed.responseId?{responseId:completed.responseId}:{}),completedAt:new Date().toISOString()}};
    }catch(error){this.rethrow(error,bounded.signal);}finally{bounded.dispose();}
  }
  private key():string{const key=this.getKey();if(!key?.trim())throw new Error('Gemini API key is missing. Connect a key in Teaching Settings.');return key;}
  private rethrow(error:unknown,signal:AbortSignal):never{
    if(signal.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
    if(error instanceof Error&&error.message.startsWith('Gemini '))throw error;throw geminiError();
  }
  private async httpError(response:Response,signal:AbortSignal,model?:string):Promise<Error>{
    // Models API reports invalid keys as HTTP 400 with a machine-readable
    // ErrorInfo reason. Never include the provider's free-form message.
    if(response.status===400){
      try{
        const json=await this.catalogJson(response,signal);
        if(object(json)&&object(json.error)){
          if(Array.isArray(json.error.details)&&json.error.details.some((detail:unknown)=>object(detail)&&detail.reason==='API_KEY_INVALID'))return geminiError(401);
          return geminiError(response.status,json.error.code);
        }
      }catch{signal.throwIfAborted();}
    }
    return geminiError(response.status,undefined,model);
  }
  private async catalogJson(response:Response,signal:AbortSignal):Promise<unknown>{
    if(!response.body)throw new Error('Gemini returned an unsupported model catalog.');
    const reader=response.body.getReader();const decoder=new TextDecoder();let text='',size=0;
    const cancel=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',cancel,{once:true});
    try{
      while(true){const {done,value}=await geminiAbortable(reader.read(),signal);if(done)break;size+=value.byteLength;if(size>4_000_000)throw new Error('Gemini model catalog exceeded the allowed size.');text+=decoder.decode(value,{stream:true});}
      signal.throwIfAborted();text+=decoder.decode();try{return JSON.parse(text);}catch{throw new Error('Gemini returned an unsupported model catalog.');}
    }finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
  }
  private input(request:ProviderRequest):Record<string,unknown>[] {
    const result:Record<string,unknown>[]=[];const calls=new Map<string,string>();const answered=new Set<string>();
    for(const raw of request.input){
      if(!object(raw))throw new Error('Gemini received unsupported teaching context.');
      if(raw.type==='provider_native'){
        if(raw.providerId!=='gemini'||(request.scope?!sameProviderScope(request.scope,raw.scope):raw.scope!==undefined))continue;
        if(!Array.isArray(raw.items))throw new Error('Gemini received incomplete native teaching history.');
        for(const step of raw.items){
          if(!object(step)||!['thought','model_output','function_call'].includes(step.type))throw new Error('Gemini received unsupported native teaching history.');
          if(step.type==='function_call'){
            canonicalGeminiTool(step.name);if(typeof step.id!=='string'||calls.has(step.id))throw new Error('Gemini received conflicting native tool history.');calls.set(step.id,step.name);
          }
          result.push(step);
        }continue;
      }
      if(raw.type==='function_call_output'){
        const name=calls.get(raw.call_id);if(!name)continue;
        if(answered.has(raw.call_id)||typeof raw.output!=='string')throw new Error('Gemini received conflicting tool feedback.');
        answered.add(raw.call_id);result.push({type:'function_result',call_id:raw.call_id,name,result:raw.output});continue;
      }
      // Other providers' native Responses items never cross this boundary.
      if(raw.type)continue;
      if(!['user','developer','system','assistant'].includes(raw.role)||typeof raw.content!=='string')throw new Error('Gemini received unsupported teaching context.');
      const content=geminiInstructions(raw.content);
      result.push({type:raw.role==='assistant'?'model_output':'user_input',content:[{type:'text',text:raw.role==='developer'||raw.role==='system'?`Internal teaching context:\n${content}`:content}]});
    }
    if([...calls.keys()].some(id=>!answered.has(id)))throw new Error('Gemini received incomplete tool history. Rebuild teaching context and retry.');
    return result;
  }
}
