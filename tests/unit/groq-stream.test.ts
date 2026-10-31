import {describe, it, expect} from 'vitest';
import {readGroqStream} from '../../apps/desktop/src/main/ai/groq-stream';
import {ProviderToolGenerationError} from '../../apps/desktop/src/main/ai/provider-contract';

const allowed = new Map([['teaching__present_beat', {namespace:'teaching', name:'present_beat'}], ['planning__propose_plan', {namespace:'planning', name:'propose_plan'}]]);
const signal = () => new AbortController().signal;
const chunk = (tool_calls:unknown[], finish_reason:string|null=null) => ({id:'chatcmpl_safe', model:'served/exact', choices:[{index:0, delta:{tool_calls}, finish_reason}]});
const call = (index=0, id='call_a', name='teaching__present_beat', args='{}') => ({index, id, type:'function', function:{name, arguments:args}});
const stream = (events:unknown[], done=true) => new Response(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join('')+(done?'data: [DONE]\r\n\r\n':'')).body!;
describe('Groq terminal tool streams',()=>{
  it('assembles interleaved argument fragments and reverses allowed tool names only after both terminal markers',async()=>{
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(chunk([call(0,'call_a','teaching__present_beat','{"x":'), call(1,'call_b','planning__propose_plan','{"y":')]))}\r\n\r\ndata: ${JSON.stringify(chunk([{index:1,function:{arguments:'2}'}},{index:0,function:{arguments:'1}'}}], 'tool_calls'))}\r\n\r\ndata: [DONE]\r\n\r\n`);
    const body = new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}});
    const result = await readGroqStream(body,signal(),allowed);
    expect(result.calls).toEqual([{type:'function_call',call_id:'call_a',namespace:'teaching',name:'present_beat',arguments:'{"x":1}'},{type:'function_call',call_id:'call_b',namespace:'planning',name:'propose_plan',arguments:'{"y":2}'}]);
    expect(result.output).toEqual(result.calls);expect(result.servedModel).toBe('served/exact');expect(result.responseId).toBe('chatcmpl_safe');
  });
  it.each(['length','content_filter','stop'])('rejects tool calls with %s finish reason',async reason=>{
    await expect(readGroqStream(stream([chunk([call()],reason)]),signal(),allowed)).rejects.toThrow(/incomplete|finish|blocked/i);
  });
  it('rejects missing DONE, missing tool finish, malformed JSON, duplicate call IDs and unknown tools',async()=>{
    await expect(readGroqStream(stream([chunk([call()],'tool_calls')],false),signal(),allowed)).rejects.toThrow(/DONE|terminal/i);
    await expect(readGroqStream(stream([chunk([call()])]),signal(),allowed)).rejects.toThrow(/finish|terminal/i);
    await expect(readGroqStream(stream([chunk([call(0,'a','teaching__present_beat','{')],'tool_calls')]),signal(),allowed)).rejects.toThrow(/JSON/i);
    await expect(readGroqStream(stream([chunk([call(0),call(1)],'tool_calls')]),signal(),allowed)).rejects.toThrow(/duplicate/i);
    await expect(readGroqStream(stream([chunk([call(0,'a','unknown')],'tool_calls')]),signal(),allowed)).rejects.toThrow(/unknown|unsupported/i);
    await expect(readGroqStream(new Response('data: {bad}\n\n').body!,signal(),allowed)).rejects.toThrow(/JSON/i);
  });
  it('rejects conflicting identity fragments and calls arriving after terminal finish',async()=>{
    await expect(readGroqStream(stream([chunk([call()]),chunk([{index:0,id:'changed'}],'tool_calls')]),signal(),allowed)).rejects.toThrow(/conflict/i);
    await expect(readGroqStream(stream([chunk([call()],'tool_calls'),chunk([call(1,'other')])]),signal(),allowed)).rejects.toThrow(/terminal|finish/i);
  });
  it('returns no teaching calls from text-only stop and never includes reasoning text',async()=>{
    const result=await readGroqStream(stream([{choices:[{index:0,delta:{content:'Answer',reasoning:'private thought'},finish_reason:'stop'}]}]),signal(),allowed);
    expect(result.calls).toEqual([]);expect(result.text).toBe('Answer');expect(JSON.stringify(result)).not.toContain('private thought');
  });
  it('bounds response bytes and assembled arguments',async()=>{
    await expect(readGroqStream(stream([chunk([call(0,'a','teaching__present_beat',JSON.stringify({s:'x'.repeat(1_000_000)}))],'tool_calls')]),signal(),allowed)).rejects.toThrow(/arguments.*size/i);
    await expect(readGroqStream(new Response('x'.repeat(4_000_001)).body!,signal(),allowed)).rejects.toThrow(/response.*size/i);
  });
  it('aborts a pending body read even when a stream does not complete',async()=>{
    const controller=new AbortController();let canceled=false;
    const pending=readGroqStream(new ReadableStream({cancel(){canceled=true;}}),controller.signal,allowed);
    controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(canceled).toBe(true);
  });
  it('discards partial calls when streamed tool_use_failed arrives and exposes only a typed safe repair diagnostic',async()=>{
    const error=await readGroqStream(stream([chunk([call(0,'partial','teaching__present_beat','{"x":')]),{error:{code:'tool_use_failed',message:'private-secret',failed_generation:'private-secret'}}],false),signal(),allowed).catch(error=>error);
    expect(error).toBeInstanceOf(ProviderToolGenerationError);expect(error).toMatchObject({providerId:'groq',code:'tool_use_failed',repairable:true});expect(error.message).not.toContain('private-secret');expect(JSON.stringify(error)).not.toContain('private-secret');expect(error).not.toHaveProperty('calls');expect(error).not.toHaveProperty('failed_generation');
  });
  it('rejects streamed errors after tool finish but before DONE rather than accepting staged actions',async()=>{
    const error=await readGroqStream(stream([chunk([call()],'tool_calls'),{error:{code:'rate_limit_exceeded',message:'private-secret'}}]),signal(),allowed).catch(error=>error);
    expect(error.message).toMatch(/rate limit/i);expect(error).not.toBeInstanceOf(ProviderToolGenerationError);expect(error).not.toHaveProperty('calls');
  });
});
