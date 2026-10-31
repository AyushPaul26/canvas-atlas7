import {isDeepStrictEqual} from 'node:util';
import type {CompletedResponse,FunctionCall} from './tool-stream';
import {canonicalGeminiTool} from './gemini-tools';
import {ProviderToolGenerationError} from './provider-contract';

const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):string|undefined=>typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9][\w:./-]*$/.test(value)?value:undefined;
const failure=()=>new Error('Gemini returned an incomplete, blocked, or failed response. Your saved lesson is preserved.');
export function geminiError(status?:number,code?:unknown,model?:string):Error {
  if(['malformed_function_call','malformed_tool_call','unexpected_tool_call','too_many_tool_calls'].includes(String(code)))return new ProviderToolGenerationError('gemini','Gemini could not generate a complete teaching tool call. Return a complete tool call matching the supplied schema.');
  if(['safety','recitation','language','prohibited_content','spii','blocklist','content_blocked'].includes(String(code)))return new Error('Gemini blocked this response. Rephrase the teaching request and try again.');
  if(code==='authentication')status=401;
  if(code==='payment_required')status=402;
  if(code==='permission_denied')status=403;
  if(code==='not_found'||code==='model_not_found')status=404;
  if(['rate_limit_exceeded','quota_exceeded','too_many_requests','resource_exhausted'].includes(String(code)))status=429;
  if(code==='api_error'||code==='service_unavailable')status=503;
  if(status===401)return new Error('Gemini API key was rejected. Replace it in Teaching Settings.');
  if(status===403)return new Error('Gemini API key or project does not have access. Review API permissions in Google AI Studio.');
  if(status===402||code==='failed_precondition')return new Error('Gemini billing credits or project prerequisites are unavailable. Review billing and add credits in Google AI Studio.');
  if(status===404&&model?.startsWith('gemini-2.5-'))return new Error('Gemini 2.5 model access may be limited to previously active users. Choose a listed Gemini 3.5 Flash-Lite or 3.8 Flash model in Teaching Settings, then retry.');
  if(status===404)return new Error('Gemini model is unavailable. Refresh models and choose an available model in Teaching Settings.');
  if(status===429)return new Error('Gemini quota or rate limit reached. Review API billing and quota, then retry when available.');
  if(status&&status>=500)return new Error('Gemini service is temporarily unavailable. Try again later.');
  if(status===400)return new Error('Gemini rejected this request or tool schema. Review the selected model and try again.');
  return new Error('Gemini could not complete this request. Check your network and try again.');
}
/** Racing the operation is necessary: injected/proxy transports can ignore AbortSignal. */
export function geminiAbortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export async function readGeminiStream(body:ReadableStream<Uint8Array>,signal:AbortSignal):Promise<CompletedResponse>{
  signal.throwIfAborted();const reader=body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,lineBuffer='',skipLF=false,done=false,terminal:Record<string,any>|undefined;
  let dataLines:string[]=[];
  const steps=new Map<number,{item:Record<string,any>;arguments?:string;stopped:boolean}>();
  const cancel=()=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',cancel,{once:true});
  const consume=(data:string)=>{
    if(!data)return;
    if(done)throw new Error('Gemini returned data after its terminal DONE marker.');
    // The official Interactions stream ends with event: done / data: [DONE].
    // This transport marker is not JSON and never replaces semantic completion.
    // https://ai.google.dev/gemini-api/docs/streaming
    if(data.trim()==='[DONE]'){
      if(!terminal)throw new Error('Gemini stream ended before interaction.completed. Try again.');
      done=true;return;
    }
    let event:unknown;try{event=JSON.parse(data);}catch{throw new Error('Gemini returned malformed stream JSON.');}
    if(!object(event)||typeof event.event_type!=='string')throw failure();
    if(event.event_type==='error')throw geminiError(undefined,event.error?.code);
    if(terminal)throw new Error('Gemini returned events after its completed response.');
    if(event.event_type==='interaction.created')return;
    if(event.event_type==='interaction.status_update'){
      if(!['in_progress','requires_action','completed'].includes(event.status))throw failure();return;
    }
    if(event.event_type==='interaction.completed'){
      if(!object(event.interaction)||!['completed','requires_action'].includes(event.interaction.status))throw failure();
      terminal=event.interaction;return;
    }
    if(!Number.isSafeInteger(event.index)||event.index<0||event.index>10_000)throw failure();
    if(event.event_type==='step.start'){
      if(steps.has(event.index)||!object(event.step)||!['thought','model_output','function_call'].includes(event.step.type))throw failure();
      steps.set(event.index,{item:structuredClone(event.step),stopped:false});return;
    }
    const step=steps.get(event.index);if(!step||step.stopped)throw failure();
    if(event.event_type==='step.stop'){
      if(step.arguments!==undefined){try{step.item.arguments=JSON.parse(step.arguments);}catch{throw new Error('Gemini returned invalid tool JSON.');}}
      step.stopped=true;return;
    }
    if(event.event_type!=='step.delta'||!object(event.delta))throw failure();
    const delta=event.delta;
    if(step.item.type==='function_call'&&delta.type==='arguments_delta'&&typeof delta.arguments==='string'){
      step.arguments=(step.arguments??'')+delta.arguments;
      if(new TextEncoder().encode(step.arguments).byteLength>1_000_000)throw new Error('Gemini tool arguments exceeded the allowed size.');return;
    }
    if(step.item.type==='thought'&&delta.type==='thought_signature'&&typeof delta.signature==='string'){
      if(step.item.signature!==undefined&&step.item.signature!==delta.signature)throw failure();step.item.signature=delta.signature;return;
    }
    if(step.item.type==='thought'&&delta.type==='thought_summary'&&object(delta.content)){
      (step.item.summary??=[]).push(delta.content);return;
    }
    if(step.item.type==='model_output'&&delta.type==='text'&&typeof delta.text==='string'){
      const content=step.item.content??=[];const last=content.at(-1);
      if(last?.type==='text')last.text+=delta.text;else content.push({type:'text',text:delta.text});return;
    }
    // Reject unsupported deltas rather than dropping data needed for signed replay.
    throw failure();
  };
  const consumeLine=(line:string)=>{
    if(!line){const data=dataLines.join('\n');dataLines=[];consume(data);return;}
    if(line.startsWith(':'))return;
    const colon=line.indexOf(':'),field=colon===-1?line:line.slice(0,colon);
    if(field!=='data')return;
    let value=colon===-1?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
    dataLines.push(value);
  };
  const append=(text:string)=>{
    if(!text)return;
    // SSE permits CRLF, LF and bare CR; a CRLF split over network chunks is
    // one line ending. Keep partial lines without dispatching them at EOF.
    // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
    if(skipLF){skipLF=false;if(text.startsWith('\n'))text=text.slice(1);}
    lineBuffer+=text;let beginning=0;
    for(let index=0;index<lineBuffer.length;index++){
      const character=lineBuffer.charCodeAt(index);if(character!==10&&character!==13)continue;
      consumeLine(lineBuffer.slice(beginning,index));
      if(character===13){if(lineBuffer.charCodeAt(index+1)===10)index++;else if(index===lineBuffer.length-1)skipLF=true;}
      beginning=index+1;
    }
    lineBuffer=lineBuffer.slice(beginning);
  };
  try{
    while(true){
      signal.throwIfAborted();const {done,value}=await geminiAbortable(reader.read(),signal);signal.throwIfAborted();if(done)break;
      size+=value.byteLength;if(size>4_000_000)throw new Error('Gemini response exceeded the allowed size.');
      append(decoder.decode(value,{stream:true}));
    }
    append(decoder.decode());signal.throwIfAborted();
    if(!terminal)throw new Error('Gemini stream ended without interaction.completed. Try again.');
    if([...steps.values()].some(step=>!step.stopped))throw failure();
    const streamed=[...steps.entries()].sort(([a],[b])=>a-b).map(([,step])=>step.item);
    if(terminal.steps!==undefined&&!Array.isArray(terminal.steps))throw failure();
    const items:Record<string,any>[]=terminal.steps??streamed;
    if(streamed.length&&terminal.steps&&!isDeepStrictEqual(streamed,terminal.steps))throw new Error('Gemini returned conflicting completed steps.');
    const calls:FunctionCall[]=[];const ids=new Set<string>();let text='';
    for(const item of items){
      if(!object(item)||!['thought','function_call','model_output'].includes(item.type))throw failure();
      if(item.type==='model_output'){
        if(!Array.isArray(item.content))throw failure();
        for(const content of item.content)if(content.type==='text'&&typeof content.text==='string')text+=content.text;
      }
      if(item.type!=='function_call')continue;
      const id=identifier(item.id);if(!id||ids.has(id)||!object(item.arguments))throw new Error('Gemini returned an incomplete or conflicting tool call.');
      const args=JSON.stringify(item.arguments);if(new TextEncoder().encode(args).byteLength>1_000_000)throw new Error('Gemini tool arguments exceeded the allowed size.');
      ids.add(id);calls.push({type:'function_call',id,call_id:id,...canonicalGeminiTool(item.name),arguments:args});
    }
    if((calls.length>0&&terminal.status!=='requires_action')||(calls.length===0&&terminal.status==='requires_action'))throw failure();
    const servedModel=identifier(terminal.model),responseId=identifier(terminal.id);
    return {calls,output:[{type:'provider_native',providerId:'gemini',items}],text,...(servedModel?{servedModel}:{}),...(responseId?{responseId}:{})};
  }catch(error){
    if(signal.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
    if(error instanceof Error&&error.message.startsWith('Gemini '))throw error;
    throw geminiError();
  }finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
}
