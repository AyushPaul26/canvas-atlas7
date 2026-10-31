import { describe,it,expect } from 'vitest';
import { readResponseStream } from '../../apps/desktop/src/main/ai/tool-stream';
const stream=(events:unknown[])=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')).body!;
const call={id:'fc1',type:'function_call',call_id:'call1',name:'present_beat',namespace:'teaching',arguments:'{"hello":1}'};
describe('complete Responses streams',()=>{
  it('ignores fragmented draft arguments and emits exactly one complete call after success',async()=>{
    const result=await readResponseStream(stream([{type:'response.function_call_arguments.delta',item_id:'fc1',delta:'{"hello"'},{type:'response.output_item.done',item:call},{type:'response.output_item.done',item:call},{type:'response.completed',response:{output:[call]}}]),new AbortController().signal);
    expect(result.calls).toEqual([call]);
  });
  it('takes served model evidence only from the completed response and retains no unrelated response secrets',async()=>{
    const result=await readResponseStream(stream([{type:'response.created',response:{model:'draft-model'}},{type:'response.completed',response:{id:'resp_safe',model:'actual-model',access_token:'must-not-be-retained',output:[]}}]),new AbortController().signal);
    expect(result.servedModel).toBe('actual-model');expect(result.responseId).toBe('resp_safe');expect(JSON.stringify(result)).not.toContain('must-not-be-retained');
    const missing=await readResponseStream(stream([{type:'response.created',response:{model:'draft-only'}},{type:'response.completed',response:{output:[]}}]),new AbortController().signal);
    expect(missing.servedModel).toBeUndefined();
  });
  it.each([false,true])('recovers canonical completed assistant text with empty delta=%s and ignores non-text content',async emptyDelta=>{
    const output=[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"title":'},{type:'unrelated',text:'DO_NOT_USE'},{type:'output_text',text:'"Notes"}'}]}];
    const result=await readResponseStream(stream([...(emptyDelta?[{type:'response.output_text.delta',delta:''}]:[]),{type:'response.completed',response:{output}}]),new AbortController().signal);
    expect(result.text).toBe('{"title":"Notes"}');
  });
  it('does not duplicate streamed text when canonical completed text is also present',async()=>{
    const output=[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"title":"Notes"}'}]}];
    const result=await readResponseStream(stream([{type:'response.output_text.delta',delta:'{"title":'},{type:'response.output_text.delta',delta:'"Notes"}'},{type:'response.completed',response:{output}}]),new AbortController().signal);
    expect(result.text).toBe('{"title":"Notes"}');
  });
  it('rejects disagreement between streamed text and canonical completion',async()=>{
    const output=[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"title":"Different"}'}]}];
    await expect(readResponseStream(stream([{type:'response.output_text.delta',delta:'{"title":"Notes"}'},{type:'response.completed',response:{output}}]),new AbortController().signal)).rejects.toThrow(/conflict|disagree/i);
  });
  it('rejects quota failure after text, malformed JSON, incomplete and aborted streams',async()=>{
    await expect(readResponseStream(stream([{type:'response.output_text.delta',delta:'start'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]),new AbortController().signal)).rejects.toThrow(/usage limit/i);
    await expect(readResponseStream(stream([{type:'response.output_item.done',item:{...call,arguments:'{' }},{type:'response.completed'}]),new AbortController().signal)).rejects.toThrow(/JSON/i);
    await expect(readResponseStream(stream([{type:'response.incomplete'}]),new AbortController().signal)).rejects.toThrow(/incomplete/i);
    const abort=new AbortController();abort.abort();
    await expect(readResponseStream(stream([{type:'response.completed'}]),abort.signal)).rejects.toThrow();
    await expect(readResponseStream(stream([]),new AbortController().signal)).rejects.toThrow(/completed/i);
  });
});
