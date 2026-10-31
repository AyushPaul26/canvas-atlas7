import {describe,it,expect} from 'vitest';
import {readGeminiStream} from '../../apps/desktop/src/main/ai/gemini-stream';

const stream=(events:unknown[])=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join('')).body!;
const start={event_type:'step.start',index:0,step:{type:'function_call',id:'call-1',name:'teaching_present_beat',arguments:{}}};
const delta={event_type:'step.delta',index:0,delta:{type:'arguments_delta',arguments:'{"title":"Gravity"}'}};
const stop={event_type:'step.stop',index:0};
const terminal={event_type:'interaction.completed',interaction:{id:'interaction-1',model:'gemini-served',status:'requires_action'}};
describe('Gemini native Interactions stream',()=>{
  it('accepts the documented done marker after a complete function response',async()=>{
    const body=new Response([start,delta,stop,terminal].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'event: done\ndata: [DONE]\n\n').body!;
    const result=await readGeminiStream(body,new AbortController().signal);
    expect(result.calls).toHaveLength(1);expect(JSON.parse(result.calls[0].arguments)).toEqual({title:'Gravity'});
  });
  it.each(['\n','\r\n','\r'])('reads standard %j SSE line endings split at every byte',async lineEnding=>{
    const events=[start,{...delta,delta:{type:'arguments_delta',arguments:JSON.stringify({title:'Gravité 🌍'})}},stop,terminal];
    const frames=events.map(event=>`: keepalive${lineEnding}event: ignored-name${lineEnding}data:${JSON.stringify(event)}${lineEnding}${lineEnding}`).join('')+`event: done${lineEnding}data: [DONE]${lineEnding}${lineEnding}`;
    const bytes=new TextEncoder().encode(frames);
    const body=new ReadableStream<Uint8Array>({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}});
    const result=await readGeminiStream(body,new AbortController().signal);
    expect(JSON.parse(result.calls[0].arguments)).toEqual({title:'Gravité 🌍'});
  });
  it('joins multiline data fields and ignores comments, empty data and unknown fields',async()=>{
    const events=[start,delta,stop,terminal];
    const text=events.map(event=>{const json=JSON.stringify(event),at=json.indexOf(',');return `: comment\nretry: 2000\nid: fixture\ndata: ${json.slice(0,at+1)}\ndata: ${json.slice(at+1)}\n\n`;}).join('')+'data:\n\nevent: done\ndata: [DONE]\n\n';
    expect((await readGeminiStream(new Response(text).body!,new AbortController().signal)).calls).toHaveLength(1);
  });
  it('requires a successful completed interaction even when DONE is received',async()=>{
    const text=[start,delta,stop].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n';
    await expect(readGeminiStream(new Response(text).body!,new AbortController().signal)).rejects.toThrow(/completed|terminal/i);
  });
  it('does not let DONE accept unfinished steps or invalid function JSON',async()=>{
    for(const events of [[start,delta,terminal],[start,{...delta,delta:{type:'arguments_delta',arguments:'{' }},stop,terminal]]){
      const text=events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n';
      await expect(readGeminiStream(new Response(text).body!,new AbortController().signal)).rejects.toThrow(/incomplete|JSON/i);
    }
  });
  it('rejects data after DONE',async()=>{
    const complete=[start,delta,stop,terminal].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('');
    await expect(readGeminiStream(new Response(complete+'data: [DONE]\n\ndata: {}\n\n').body!,new AbortController().signal)).rejects.toThrow(/after.*DONE|after.*completed/i);
  });
  it('does not dispatch an unfinished final event at EOF',async()=>{
    const unfinished=[start,delta,stop].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+`data: ${JSON.stringify(terminal)}\n`;
    await expect(readGeminiStream(new Response(unfinished).body!,new AbortController().signal)).rejects.toThrow(/completed|terminal/i);
  });
  it('assembles fragmented arguments only after stopped steps and a successful terminal',async()=>{
    const result=await readGeminiStream(stream([start,{...delta,delta:{type:'arguments_delta',arguments:'{"title":'}},{...delta,delta:{type:'arguments_delta',arguments:'"Gravity"}'}},stop,terminal]),new AbortController().signal);
    expect(result.calls).toEqual([{type:'function_call',id:'call-1',call_id:'call-1',name:'present_beat',namespace:'teaching',arguments:'{"title":"Gravity"}'}]);
    expect(result.servedModel).toBe('gemini-served');expect(result.responseId).toBe('interaction-1');
    expect(result.output).toEqual([{type:'provider_native',providerId:'gemini',items:[{type:'function_call',id:'call-1',name:'teaching_present_beat',arguments:{title:'Gravity'}}]}]);
  });
  it('accepts semantically identical terminal steps with reordered outer and nested object properties',async()=>{
    const finalStep={name:'teaching_present_beat',arguments:{details:{second:2,first:1},title:'Gravity'},id:'call-1',type:'function_call'};
    const result=await readGeminiStream(stream([start,{...delta,delta:{type:'arguments_delta',arguments:'{"title":"Gravity","details":{"first":1,"second":2}}'}},stop,{...terminal,interaction:{...terminal.interaction,steps:[finalStep]}}]),new AbortController().signal);
    expect(result.calls).toHaveLength(1);expect(JSON.parse(result.calls[0].arguments)).toEqual({title:'Gravity',details:{first:1,second:2}});
    expect(result.output[0].items).toEqual([finalStep]);
  });
  it.each([
    {title:'Changed gravity',details:{first:1,second:2},points:[1,2]},
    {title:'Gravity',details:{first:1,second:2},points:[2,1]},
  ])('rejects different field values or array order in terminal steps',async argumentsValue=>{
    await expect(readGeminiStream(stream([start,{...delta,delta:{type:'arguments_delta',arguments:'{"title":"Gravity","details":{"first":1,"second":2},"points":[1,2]}'}},stop,{...terminal,interaction:{...terminal.interaction,steps:[{...start.step,arguments:argumentsValue}]}}]),new AbortController().signal)).rejects.toThrow(/conflicting completed steps/i);
  });
  it('rejects a changed thought signature in terminal steps',async()=>{
    await expect(readGeminiStream(stream([
      {event_type:'step.start',index:0,step:{type:'thought'}},
      {event_type:'step.delta',index:0,delta:{type:'thought_signature',signature:'original-signature'}},stop,
      {...terminal,interaction:{...terminal.interaction,status:'completed',steps:[{signature:'different-signature',type:'thought'}]}}
    ]),new AbortController().signal)).rejects.toThrow(/conflicting completed steps/i);
  });
  it('preserves thought signatures and output privately while exposing only model output text',async()=>{
    const result=await readGeminiStream(stream([
      {event_type:'interaction.created',interaction:{id:'interaction-1',model:'draft-model'}},
      {event_type:'step.start',index:0,step:{type:'thought'}},
      {event_type:'step.delta',index:0,delta:{type:'thought_summary',content:{type:'text',text:'private thought'}}},
      {event_type:'step.delta',index:0,delta:{type:'thought_signature',signature:'opaque-signature'}},stop,
      {event_type:'step.start',index:1,step:{type:'model_output'}},
      {event_type:'step.delta',index:1,delta:{type:'text',text:'Visible explanation'}},
      {event_type:'step.stop',index:1},
      {event_type:'interaction.completed',interaction:{id:'interaction-1',status:'completed',access_token:'never retain'}}
    ]),new AbortController().signal);
    expect(result.text).toBe('Visible explanation');expect(result.servedModel).toBeUndefined();
    expect((result.output[0].items as any[])[0]).toEqual({type:'thought',signature:'opaque-signature',summary:[{type:'text',text:'private thought'}]});
    expect(JSON.stringify(result)).not.toContain('never retain');
  });
  it.each(['failed','incomplete','cancelled','requires_continuation','blocked'])('rejects unsuccessful %s terminal even after a valid call',async status=>{
    await expect(readGeminiStream(stream([start,delta,stop,{...terminal,interaction:{...terminal.interaction,status}}]),new AbortController().signal)).rejects.toThrow(/Gemini.*(incomplete|blocked|failed)/i);
  });
  it('rejects unfinished steps, missing terminal, malformed JSON, unknown tools and conflicting IDs',async()=>{
    for(const events of [[start,delta,terminal],[start,delta,stop],[start,{...delta,delta:{type:'arguments_delta',arguments:'{' }},stop,terminal],[{...start,step:{...start.step,name:'execute_shell'}},delta,stop,terminal],[start,delta,stop,{...start,index:1}, {...delta,index:1,delta:{type:'arguments_delta',arguments:'{"different":1}'}},{...stop,index:1},terminal]]){
      await expect(readGeminiStream(stream(events),new AbortController().signal)).rejects.toThrow(/Gemini/i);
    }
    await expect(readGeminiStream(new Response('data: {broken}\n\n').body!,new AbortController().signal)).rejects.toThrow(/JSON/i);
  });
  it('rejects oversized arguments and response bytes',async()=>{
    await expect(readGeminiStream(stream([start,{...delta,delta:{type:'arguments_delta',arguments:'x'.repeat(1_000_001)}}]),new AbortController().signal)).rejects.toThrow(/size/i);
    await expect(readGeminiStream(new Response('x'.repeat(4_000_001)).body!,new AbortController().signal)).rejects.toThrow(/size/i);
  });
  it('settles cancellation even if a stream read and its cancel promise never settle',async()=>{
    const controller=new AbortController();const body=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})});
    const pending=readGeminiStream(body,controller.signal);controller.abort();await expect(pending).rejects.toThrow();
  });
  it('does not disclose raw stream errors',async()=>{
    await expect(readGeminiStream(stream([{event_type:'error',error:{code:'invalid_argument',message:'secret-key'}}]),new AbortController().signal)).rejects.toThrow(/^Gemini (?!.*secret-key)/);
  });
  it.each([['authentication',/key.*rejected/i],['rate_limit_exceeded',/quota|rate limit/i],['quota_exceeded',/quota/i],['payment_required',/billing|credit/i],['permission_denied',/permission/i],['model_not_found',/model.*unavailable/i],['safety',/blocked/i],['malformed_function_call',/complete.*tool/i]])('maps native %s stream errors to safe actionable recovery',async(code,message)=>{
    await expect(readGeminiStream(stream([{event_type:'error',error:{code,message:'secret-key'}}]),new AbortController().signal)).rejects.toThrow(message);
  });
});
