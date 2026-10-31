import type {ModelInfo} from '@living-canvas/protocol';
import {providerError,readResponseStream} from './tool-stream';
import type {AIProvider,ProviderRequest} from './provider-contract';
export type {ProviderRequest} from './provider-contract';

/** Read only bounded error JSON. Raw provider prose never crosses this boundary. */
async function rejected(response:Response,signal:AbortSignal):Promise<never>{
  let code:unknown,param:unknown;
  const deadline=new AbortController(),active=AbortSignal.any([signal,deadline.signal]);
  const timer=setTimeout(()=>deadline.abort(),5000);
  const reader=response.body?.getReader(),decoder=new TextDecoder();
  const abort=()=>{void reader?.cancel().catch(()=>undefined);};active.addEventListener('abort',abort,{once:true});
  try{
    active.throwIfAborted();let text='',bytes=0;
    if(reader)while(true){
      const chunk=await reader.read();active.throwIfAborted();if(chunk.done)break;
      bytes+=chunk.value.byteLength;if(bytes>16_000)throw new Error('Bounded provider diagnostic.');
      text+=decoder.decode(chunk.value,{stream:true});
    }
    const json=JSON.parse(text+decoder.decode());code=json?.error?.code;param=json?.error?.param;
  }catch{signal.throwIfAborted();}
  finally{clearTimeout(timer);active.removeEventListener('abort',abort);void reader?.cancel().catch(()=>undefined);reader?.releaseLock();}
  throw providerError(code,response.status,param);
}
export class ChatGPTProvider implements AIProvider {
  readonly id='chatgpt' as const;
  constructor(private auth:{accessToken():Promise<string>},private request:typeof fetch=fetch){}
  async listModels():Promise<ModelInfo[]>{
    const signal=AbortSignal.timeout(30000);
    const response=await this.request('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${await this.auth.accessToken()}`},signal});
    if(!response.ok)return rejected(response,signal);
    const json=await response.json() as {models?:{slug:string;display_name?:string;visibility?:string}[]};
    if(!Array.isArray(json.models))throw new Error('ChatGPT returned an unsupported model catalog.');
    return json.models.filter(item=>item.visibility==='list'&&typeof item.slug==='string').map(item=>({id:item.slug,name:item.display_name??item.slug}));
  }
  async complete(request:ProviderRequest,signal:AbortSignal){
    const requestedModel=request.model;
    signal.throwIfAborted();const token=await this.auth.accessToken();signal.throwIfAborted();
    const active=AbortSignal.any([signal,AbortSignal.timeout(180000)]);
    const response=await this.request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:requestedModel,instructions:request.instructions,input:request.input,...(request.tools.length?{tools:request.tools}:{}),store:false,stream:true}),signal:active});
    if(!response.ok)return rejected(response,active);
    if(!response.body)throw new Error('ChatGPT did not return a response stream.');
    const completed=await readResponseStream(response.body,active);
    return {...completed,modelMetadata:{requestedModel,...(completed.servedModel?{servedModel:completed.servedModel}:{}),...(completed.responseId?{responseId:completed.responseId}:{}),completedAt:new Date().toISOString()}};
  }
}
