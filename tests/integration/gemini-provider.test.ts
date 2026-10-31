import {describe,it,expect,vi} from 'vitest';
import {GeminiProvider} from '../../apps/desktop/src/main/ai/gemini-provider';
import {courseTool} from '../../packages/teacher/src/course-planner';
import {getTeachingToolParameters} from '../../packages/teacher/src/index';
import {getPlanningToolParameters} from '../../packages/teacher/src/planner';
const scope={providerId:'gemini' as const,modelId:'gemini-exact',credentialRevision:'revision-1'};
const parameters={type:'object',properties:{title:{type:'string',minLength:1,maxLength:100},kind:{const:'beat'}},required:['title','kind'],additionalProperties:false};
const tools=[{type:'namespace',name:'teaching',tools:[{type:'function',name:'present_beat',strict:true,parameters}]}];
const native=[{type:'thought',signature:'opaque'},{type:'function_call',id:'call-1',name:'teaching_present_beat',arguments:{title:'Gravity',kind:'beat'}}];
const response=()=>new Response(`data: ${JSON.stringify({event_type:'interaction.completed',interaction:{id:'interaction-1',status:'requires_action',model:'served',steps:native}})}\n\n`);
const request={model:'gemini-exact',instructions:'Use teaching.present_beat',input:[{role:'user',content:'Teach gravity'}],tools,scope};
describe('Gemini provider',()=>{
  it('prefers returned current stable teaching models over legacy2.5 while retaining exact unknown IDs',async()=>{
    const models=[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-future-exact',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3.8-flash',supportedGenerationMethods:['createInteraction']},{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']}];
    const provider=new GeminiProvider(()=> 'dummy',async()=>Response.json({models}));
    expect((await provider.listModels()).map(model=>model.id)).toEqual(['gemini-3.5-flash-lite','gemini-3.8-flash','gemini-2.5-flash','gemini-future-exact']);
  });
  it('explains a legacy2.5 model404 without exposing the remote message or changing the model',async()=>{
    const sent:string[]=[];const provider=new GeminiProvider(()=> 'dummy',async(_url,init)=>{sent.push(JSON.parse(String(init?.body)).model);return Response.json({error:{message:'secret-key'}},{status:404});});
    await expect(provider.complete({...request,model:'gemini-2.5-flash',scope:undefined},new AbortController().signal)).rejects.toThrow(/Gemini.*2\.5.*previously active.*3\.5.*3\.8/i);
    expect(sent).toEqual(['gemini-2.5-flash']);
  });
  it('uses native Interactions fields and preserves canonical schema constraints',async()=>{
    let sent:any;let url='';let headers:any;
    const provider=new GeminiProvider(()=> 'dummy',async(target,init)=>{url=String(target);headers=init?.headers;sent=JSON.parse(String(init?.body));return response();});
    const result=await provider.complete(request,new AbortController().signal);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse');expect(headers).toMatchObject({'x-goog-api-key':'dummy'});
    expect(sent).toMatchObject({model:'gemini-exact',store:false,stream:true,system_instruction:'Use teaching_present_beat',input:[{type:'user_input',content:[{type:'text',text:'Teach gravity'}]}],tools:[{type:'function',name:'teaching_present_beat',parameters}]});
    expect(sent.instructions).toBeUndefined();expect(sent.previous_interaction_id).toBeUndefined();expect(sent.tools[0].strict).toBeUndefined();
    expect(result.modelMetadata).toMatchObject({providerId:'gemini',requestedModel:'gemini-exact',servedModel:'served',responseId:'interaction-1'});expect(result.historyScope).toEqual(scope);
    expect(result.output[0]).toMatchObject({type:'provider_native',providerId:'gemini',scope,items:native});
  });
  it('replays exact native signed steps and matches repair feedback without forwarding foreign native items',async()=>{
    let sent:any;const provider=new GeminiProvider(()=> 'dummy',async(_target,init)=>{sent=JSON.parse(String(init?.body));return response();});
    await provider.complete({...request,input:[...request.input,{type:'provider_native',providerId:'gemini',scope,items:native},{type:'function_call_output',call_id:'call-1',output:'{"ok":false}'},{role:'developer',content:'Repair teaching.present_beat'}]},new AbortController().signal);
    expect(sent.input).toEqual([{type:'user_input',content:[{type:'text',text:'Teach gravity'}]},...native,{type:'function_result',call_id:'call-1',name:'teaching_present_beat',result:'{"ok":false}'},{type:'user_input',content:[{type:'text',text:'Internal teaching context:\nRepair teaching_present_beat'}]}]);
    for(const item of [{type:'provider_native',providerId:'groq',scope:{...scope,providerId:'groq'},items:[{secret:'foreign'}]},{type:'provider_native',providerId:'gemini',scope:{...scope,credentialRevision:'old'},items:[{secret:'old'}]}]){
      await provider.complete({...request,input:[...request.input,item]},new AbortController().signal);expect(JSON.stringify(sent)).not.toMatch(/foreign|secret|old/);
    }
  });
  it('translates all four real schemas with no canonical constraints removed and rejects unknown tools',async()=>{
    let sent:any;const provider=new GeminiProvider(()=> 'dummy',async(_target,init)=>{sent=JSON.parse(String(init?.body));return new Response(`data: ${JSON.stringify({event_type:'interaction.completed',interaction:{id:'schema-check',status:'completed',steps:[]}})}\n\n`);});
    const sources=[...['summarize_source','plan_course'].map(name=>courseTool(name as 'summarize_source'|'plan_course')),[{type:'namespace',name:'teaching',tools:[{type:'function',name:'present_beat',parameters:getTeachingToolParameters()}]}],[{type:'namespace',name:'planning',tools:[{type:'function',name:'propose_plan',parameters:getPlanningToolParameters()}]}]];
    for(const source of sources){await provider.complete({...request,tools:source},new AbortController().signal);expect(sent.tools[0]).toMatchObject({type:'function',name:`${source[0].name}_${source[0].tools[0].name}`,parameters:source[0].tools[0].parameters});}
    await expect(provider.complete({...request,tools:[{type:'namespace',name:'shell',tools:[{type:'function',name:'exec',parameters:{}}]}]},new AbortController().signal)).rejects.toThrow(/unsupported.*tool/i);
  });
  it('paginates exact model IDs, excludes unsuitable models and validates only the supplied key',async()=>{
    const seen:string[]=[];let saved='old';const provider=new GeminiProvider(()=>saved,async(target,init)=>{
      seen.push(`${target}|${(init?.headers as Record<string,string>)['x-goog-api-key']}`);
      return Response.json(String(target).includes('pageToken=')?{models:[{name:'models/gemini-snapshot-002',displayName:'Snapshot',supportedGenerationMethods:['generateContent']},{name:'models/gemini-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-tts-preview',supportedGenerationMethods:['generateContent']}]}:{models:[{name:'models/gemini-first',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}],nextPageToken:'a +/'});
    });
    expect(await provider.validateKey('candidate')).toEqual([{id:'gemini-first',name:'gemini-first'},{id:'gemini-snapshot-002',name:'Snapshot'}]);expect(saved).toBe('old');expect(seen.every(value=>value.endsWith('|candidate'))).toBe(true);expect(seen[1]).toContain('pageToken=a+%2B%2F');
    seen.length=0;saved='new';await provider.listModels();expect(seen.every(value=>value.endsWith('|new'))).toBe(true);
  });
  it('returns an empty catalog honestly and rejects malformed or looping pagination',async()=>{
    expect(await new GeminiProvider(()=> 'dummy',async()=>Response.json({models:[]})).listModels()).toEqual([]);
    for(const catalog of [{unexpected:[]},{models:[],nextPageToken:'loop'}])await expect(new GeminiProvider(()=> 'dummy',async()=>Response.json(catalog)).listModels()).rejects.toThrow(/catalog/i);
  });
  it.each([401,403,404,429,500])('sanitizes HTTP %s failures without reading echoed keys',async status=>{
    const provider=new GeminiProvider(()=> 'secret-key',async()=>new Response('secret-key',{status}));
    await expect(provider.listModels()).rejects.toThrow(/^Gemini (?!.*secret-key)/);await expect(provider.complete(request,new AbortController().signal)).rejects.toThrow(/^Gemini (?!.*secret-key)/);
  });
  it('recognizes Models API invalid-key reasons from bounded JSON without exposing the raw message',async()=>{
    const provider=new GeminiProvider(()=> 'dummy',async()=>Response.json({error:{status:'INVALID_ARGUMENT',message:'secret-key',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID'}]}},{status:400}));
    await expect(provider.listModels()).rejects.toThrow(/Gemini API key.*rejected/);await expect(provider.complete(request,new AbortController().signal)).rejects.toThrow(/Gemini API key.*rejected/);
  });
  it('enforces the inference deadline through a stalled body even if the transport ignores abort',async()=>{
    vi.useFakeTimers();try{
      const provider=new GeminiProvider(()=> 'dummy',async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})));
      const pending=provider.complete(request,new AbortController().signal);const check=expect(pending).rejects.toThrow(/timed out/i);await vi.advanceTimersByTimeAsync(180_001);await check;
    }finally{vi.useRealTimers();}
  });
  it('bounds fetch and catalog body waits even when transport ignores abort',async()=>{
    vi.useFakeTimers();try{
      const provider=new GeminiProvider(()=> 'dummy',async()=>new Promise(()=>{}));const pending=provider.listModels();const check=expect(pending).rejects.toThrow(/timed out/i);await vi.advanceTimersByTimeAsync(30_001);await check;
      const stalled=new GeminiProvider(()=> 'dummy',async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})));const reading=stalled.listModels();const bodyCheck=expect(reading).rejects.toThrow(/timed out/i);await vi.advanceTimersByTimeAsync(30_001);await bodyCheck;
    }finally{vi.useRealTimers();}
  });
  it('aborts canceled catalog and inference promptly without raw network errors',async()=>{
    const provider=new GeminiProvider(()=> 'dummy',async()=>new Promise(()=>{}));const controller=new AbortController();const pending=provider.listModels(controller.signal);controller.abort();await expect(pending).rejects.toThrow();
    const controller2=new AbortController();const inference=provider.complete(request,controller2.signal);controller2.abort();await expect(inference).rejects.toThrow();
    await expect(new GeminiProvider(()=> 'dummy',async()=>{throw new Error('secret-key');}).listModels()).rejects.toThrow(/^Gemini (?!.*secret-key)/);
  });
});
