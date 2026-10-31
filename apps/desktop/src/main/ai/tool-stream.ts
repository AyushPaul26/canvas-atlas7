import type {ModelRunMetadata} from '@living-canvas/protocol';
import type {ProviderScope} from './provider-contract';
export type FunctionCall={id?:string;type:'function_call';call_id:string;name:string;namespace?:string;arguments:string};
export type CompletedResponse={calls:FunctionCall[];output:Record<string,unknown>[];text:string;servedModel?:string;responseId?:string;modelMetadata?:ModelRunMetadata;historyScope?:ProviderScope;repairDiagnostic?:string};
const publicCodes=new Set(['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','subscription_sharing_user_not_eligible','subscription_sharing_unsupported_capability','subscription_sharing_route_not_supported','subscription_sharing_invalid_user','subscription_sharing_user_unavailable','chatpass_v2_scope_not_authorized','chatpass_v2_invalid_authorization_context','rate_limit_exceeded','invalid_grant','invalid_function_parameters','invalid_json_schema','invalid_request_error','unsupported_parameter','unsupported_value','invalid_value','model_not_found','context_length_exceeded','insufficient_quota','server_error','internal_error','service_unavailable']);
const publicParameterParts=new Set(['model','instructions','input','tools','function','parameters','properties','items','required','additionalProperties','name','type','strict','store','stream','tool_choice','title','overview','sections','evidenceIds','explanation','keyPoints','definitions','term','meaning','equations','latex','examples','recap','reviewQuestions','question','answer','content','role','text','reasoning','effort']);
export type ChatGPTDiagnostic={status?:number;code?:string;param?:string};
/** Never retain remote error prose, arbitrary fields, or unknown error tokens. */
export class ChatGPTAPIError extends Error {
  constructor(message:string,readonly diagnostic:ChatGPTDiagnostic){
    const details=[...(diagnostic.status?[`HTTP ${diagnostic.status}`]:[]),diagnostic.code,diagnostic.param].filter(Boolean).join(' · ');
    super(details?`${message} (${details})`:message);this.name='ChatGPTAPIError';
  }
}
export function providerError(code?:unknown,status?:number,param?:unknown):ChatGPTAPIError {
  const diagnostic:ChatGPTDiagnostic={};
  if(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599)diagnostic.status=status;
  if(typeof code==='string'&&publicCodes.has(code))diagnostic.code=code;
  if(typeof param==='string'&&param.length<=240&&/^[A-Za-z_]\w*(?:\[\d{1,3}\]|\.[A-Za-z_]\w*)*$/.test(param)&&param.replace(/\[\d+\]/g,'').split('.').every(part=>publicParameterParts.has(part)))diagnostic.param=param;
  const known=diagnostic.code;
  let message='ChatGPT could not complete this request. Your lesson is saved; try again.';
  if(status===401||known==='invalid_grant'||known==='subscription_sharing_invalid_user')message='ChatGPT authorization expired or was revoked. Continue with ChatGPT again.';
  else if(status===403||known==='subscription_sharing_user_not_eligible'||known==='chatpass_v2_scope_not_authorized'||known==='chatpass_v2_invalid_authorization_context')message='ChatGPT plan permission is unavailable for this account. Review your ChatGPT app access and plan permissions.';
  else if(status===429||known==='subscription_sharing_usage_limit_exceeded'||known==='rate_limit_exceeded'||known==='insufficient_quota')message='ChatGPT usage limit reached. Review app limits in ChatGPT Settings → Usage, then try again when available.';
  else if(known==='subscription_sharing_usage_unavailable')message='ChatGPT plan usage is temporarily unavailable. Your lesson is saved; try again later.';
  else if(status&&status>=500||known==='server_error'||known==='internal_error'||known==='service_unavailable'||known==='subscription_sharing_user_unavailable')message='ChatGPT service is temporarily unavailable. Your lesson is saved; try again later.';
  else if(known==='invalid_function_parameters'||known==='invalid_json_schema')message='ChatGPT rejected the app’s tool schema. Your lesson is saved. Please report this app request error.';
  else if(status===404||known==='model_not_found')message='This ChatGPT model is unavailable. Refresh models and choose an available model in Teaching settings.';
  else if(known==='context_length_exceeded')message='ChatGPT rejected this request because its context is too large. Your lesson is saved. Use a shorter study session.';
  else if(known==='subscription_sharing_unsupported_capability'||known==='unsupported_parameter'||known==='unsupported_value')message='ChatGPT rejected an unsupported feature in this request. Your lesson is saved. Choose another available model or update Canvas Atlas.';
  else if(status===400||status===422||known==='invalid_request_error'||known==='invalid_value')message='ChatGPT rejected this app request. Your lesson is saved. Please report the error details below.';
  return new ChatGPTAPIError(message,Object.freeze(diagnostic));
}
export async function readResponseStream(body:ReadableStream<Uint8Array>,signal:AbortSignal):Promise<CompletedResponse>{
  signal.throwIfAborted();const reader=body.getReader();const decoder=new TextDecoder();
  let buffer='',size=0,completed=false,text='';let output:Record<string,unknown>[]=[];let servedModel:string|undefined,responseId:string|undefined;
  const safeIdentifier=(value:unknown)=>typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9][\w:./-]*$/.test(value)?value:undefined;
  const calls=new Map<string,FunctionCall>();
  const abort=()=>{void reader.cancel();};signal.addEventListener('abort',abort,{once:true});
  const add=(item:Record<string,unknown>)=>{
    if(item.type!=='function_call')return;
    if(typeof item.call_id!=='string'||typeof item.name!=='string'||typeof item.arguments!=='string')throw new Error('ChatGPT returned an incomplete tool call.');
    if(item.arguments.length>1_000_000)throw new Error('ChatGPT tool arguments exceeded the allowed size.');
    try{JSON.parse(item.arguments);}catch{throw new Error('ChatGPT returned invalid tool JSON.');}
    const old=calls.get(item.call_id);
    if(old&&(old.arguments!==item.arguments||old.name!==item.name||old.namespace!==item.namespace))throw new Error('ChatGPT returned conflicting duplicate tool calls.');
    calls.set(item.call_id,item as FunctionCall);
  };
  const consume=(block:string)=>{
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')return;
    let event:any;try{event=JSON.parse(data);}catch{throw new Error('ChatGPT returned malformed stream JSON.');}
    if(event.type==='response.failed'||event.type==='error'){const error=event.response?.error??event.error??event;throw providerError(error?.code,undefined,error?.param);}
    if(event.type==='response.incomplete')throw new Error('ChatGPT response was incomplete. Your last committed lesson is preserved.');
    if(event.type==='response.output_item.done')add(event.item??{});
    if(event.type==='response.output_text.delta'&&typeof event.delta==='string')text+=event.delta;
    if(event.type==='response.completed'){
      if(event.response?.status&&event.response.status!=='completed')throw new Error('ChatGPT response was incomplete.');
      servedModel=safeIdentifier(event.response?.model);responseId=safeIdentifier(event.response?.id);
      completed=true;output=Array.isArray(event.response?.output)?event.response.output:[];for(const item of output)add(item);
      const canonical=output.flatMap(item=>item.type==='message'&&item.role==='assistant'&&Array.isArray(item.content)?item.content.flatMap((part:unknown)=>part&&typeof part==='object'&&'type' in part&&part.type==='output_text'&&'text' in part&&typeof part.text==='string'?[part.text]:[]):[]).join('');
      if(text&&canonical&&text!==canonical)throw new Error('ChatGPT returned conflicting completed response text.');
      if(!text)text=canonical;
    }
  };
  try{
    while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
      size+=value.byteLength;if(size>4_000_000)throw new Error('ChatGPT response exceeded the allowed size.');
      buffer+=(decoder.decode(value,{stream:true}));buffer=buffer.replace(/\r\n/g,'\n');let index:number;
      while((index=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,index));buffer=buffer.slice(index+2);}
    }
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);signal.throwIfAborted();
    if(!completed)throw new Error('ChatGPT stream ended without response.completed. Try again.');
    return {calls:[...calls.values()],output:output.length?output:[...calls.values()],text,...(servedModel?{servedModel}:{}),...(responseId?{responseId}:{})};
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
