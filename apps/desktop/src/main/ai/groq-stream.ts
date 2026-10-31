import type {CompletedResponse,FunctionCall} from './tool-stream';
import type {GroqToolIdentity} from './groq-tools';
import {groqAPIError} from './groq-errors';

/** Marks only fixed local diagnostics as safe to surface outside the transport. */
export class GroqStreamError extends Error {}

/** Race every I/O boundary, including custom desktop fetches that ignore signals. */
export function groqAbortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new DOMException('Groq request canceled.','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export async function groqDeadline<T>(signal:AbortSignal|undefined,ms:number,operation:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Groq request timed out. Try again.','TimeoutError')),ms);
  try{controller.signal.throwIfAborted();return await operation(controller.signal);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function groqBodyText(body:ReadableStream<Uint8Array>,signal:AbortSignal,maxBytes=4_000_000):Promise<string>{
  signal.throwIfAborted();const reader=body.getReader();const decoder=new TextDecoder();let text='',bytes=0;
  const abort=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',abort,{once:true});
  try{
    while(true){const item=await groqAbortable(reader.read(),signal);signal.throwIfAborted();if(item.done)break;
      bytes+=item.value.byteLength;if(bytes>maxBytes)throw new GroqStreamError('Groq response exceeded the allowed size.');
      text+=decoder.decode(item.value,{stream:true});
    }
    return text+decoder.decode();
  }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}

export async function readGroqStream(body:ReadableStream<Uint8Array>,signal:AbortSignal,allowed:Map<string,GroqToolIdentity>):Promise<CompletedResponse>{
  signal.throwIfAborted();const reader=body.getReader(),decoder=new TextDecoder();
  const fragments=new Map<number,{id?:string;name:string;arguments:string}>();
  let buffer='',size=0,argumentSize=0,text='',done=false,finish:string|undefined,servedModel:string|undefined,responseId:string|undefined;
  const identifier=(value:unknown)=>typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9][\w:./-]*$/.test(value)?value:undefined;
  const consume=(block:string)=>{
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data)return;
    if(done)throw new GroqStreamError('Groq returned data after the terminal DONE marker.');
    if(data==='[DONE]'){done=true;return;}
    let event:any;try{event=JSON.parse(data);}catch{throw new GroqStreamError('Groq returned malformed stream JSON.');}
    if(!event||typeof event!=='object'||Array.isArray(event))throw new GroqStreamError('Groq returned an unsupported response stream.');
    if(event.error)throw groqAPIError(event.error);
    const model=identifier(event.model),id=identifier(event.id);
    if(model){if(servedModel&&servedModel!==model)throw new GroqStreamError('Groq returned conflicting response model metadata.');servedModel=model;}
    if(id){if(responseId&&responseId!==id)throw new GroqStreamError('Groq returned conflicting response identity.');responseId=id;}
    if(!Array.isArray(event.choices))throw new GroqStreamError('Groq returned an unsupported response stream.');
    for(const choice of event.choices){
      if(choice.index!==0)throw new GroqStreamError('Groq returned an unsupported response choice.');
      const delta=choice.delta??{};
      if(finish&&(delta.content||delta.tool_calls?.length||choice.finish_reason))throw new GroqStreamError('Groq returned data after the terminal finish reason.');
      if(typeof delta.content==='string')text+=delta.content;
      if(delta.tool_calls!==undefined&&!Array.isArray(delta.tool_calls))throw new GroqStreamError('Groq returned incomplete tool calls.');
      for(const part of delta.tool_calls??[]){
        if(!Number.isInteger(part.index)||part.index<0||part.index>127||part.type&&part.type!=='function')throw new GroqStreamError('Groq returned an unsupported tool call index.');
        const item=fragments.get(part.index)??{name:'',arguments:''};
        if(part.id!==undefined){
          if(!identifier(part.id))throw new GroqStreamError('Groq returned an invalid tool call ID.');
          if(item.id&&item.id!==part.id)throw new GroqStreamError('Groq returned conflicting tool call IDs.');item.id=part.id;
        }
        if(part.function?.name!==undefined){
          if(typeof part.function.name!=='string')throw new GroqStreamError('Groq returned an invalid tool function name.');
          item.name+=part.function.name;if(item.name.length>128)throw new GroqStreamError('Groq returned an unsupported tool function name.');
        }
        if(part.function?.arguments!==undefined){
          if(typeof part.function.arguments!=='string')throw new GroqStreamError('Groq returned invalid tool JSON.');
          argumentSize+=part.function.arguments.length;if(argumentSize>1_000_000)throw new GroqStreamError('Groq tool arguments exceeded the allowed size.');item.arguments+=part.function.arguments;
        }
        fragments.set(part.index,item);
      }
      if(choice.finish_reason!==null&&choice.finish_reason!==undefined){
        if(!['tool_calls','stop'].includes(choice.finish_reason))throw new GroqStreamError('Groq response was incomplete or blocked by its finish reason.');
        finish=choice.finish_reason;
      }
    }
  };
  const abort=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      const item=await groqAbortable(reader.read(),signal);signal.throwIfAborted();if(item.done)break;
      size+=item.value.byteLength;if(size>4_000_000)throw new GroqStreamError('Groq response exceeded the allowed size.');
      buffer+=decoder.decode(item.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      let boundary:number;while((boundary=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}
    }
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);signal.throwIfAborted();
    if(!done||!finish)throw new GroqStreamError('Groq stream ended without terminal finish and DONE markers.');
    if(fragments.size&&finish!=='tool_calls'||!fragments.size&&finish==='tool_calls')throw new GroqStreamError('Groq returned incomplete tool calls with an invalid finish reason.');
    const calls:FunctionCall[]=[],ids=new Set<string>();
    for(const [,item] of [...fragments].sort(([a],[b])=>a-b)){
      if(!item.id||!item.name)throw new GroqStreamError('Groq returned an incomplete tool call.');
      if(ids.has(item.id))throw new GroqStreamError('Groq returned duplicate tool call IDs.');ids.add(item.id);
      const identity=allowed.get(item.name);if(!identity)throw new GroqStreamError('Groq returned an unknown teaching tool.');
      let args:unknown;try{args=JSON.parse(item.arguments);}catch{throw new GroqStreamError('Groq returned invalid tool JSON.');}
      if(!args||typeof args!=='object'||Array.isArray(args))throw new GroqStreamError('Groq returned invalid tool JSON arguments.');
      calls.push({type:'function_call',call_id:item.id,...identity,arguments:item.arguments});
    }
    return {calls,output:calls.map(call=>({...call})),text,...(servedModel?{servedModel}:{}),...(responseId?{responseId}:{})};
  }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
