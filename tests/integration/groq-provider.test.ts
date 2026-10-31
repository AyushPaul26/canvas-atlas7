import {afterEach,describe,it,expect,vi} from 'vitest';
import {GroqProvider,GroqToolGenerationError} from '../../apps/desktop/src/main/ai/groq-provider';
import {courseTool} from '../../packages/teacher/src/course-planner';
import {getPlanningToolParameters} from '../../packages/teacher/src/planner';
import {getTeachingToolParameters} from '../../packages/teacher/src/index';
import {completeTeaching} from '../../apps/desktop/src/main/ai/provider-contract';

const namespaceTool=(namespace:string,name:string,parameters:unknown={type:'object',properties:{},additionalProperties:false})=>({type:'namespace',name:namespace,tools:[{type:'function',name,description:'A local tool.',strict:true,parameters}]});
const teach=namespaceTool('teaching','present_beat');
const request=()=>({model:'exact/model-id',instructions:'Teach using the supplied tools.',input:[{role:'user',content:'Explain motion.'}],tools:[teach]});
const completed=(name='teaching__present_beat',args='{}')=>new Response(`data: ${JSON.stringify({id:'chatcmpl_test',model:'served/model',choices:[{index:0,delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name,arguments:args}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
afterEach(()=>vi.useRealTimers());
describe('Groq teaching adapter',()=>{
  it('validates the candidate key through the exact catalog route without changing the active credential',async()=>{
    const headers:unknown[]=[];
    const provider=new GroqProvider(()=>'saved-key',async(url,init)=>{
      expect(String(url)).toBe('https://api.groq.com/openai/v1/models');expect(init?.method).toBe('GET');headers.push(init?.headers);
      return Response.json({data:[{id:'llama-3.3-70b-versatile',active:true},{id:'future/text-model',active:true},{id:'whisper-large-v3'},{id:'meta-llama/llama-prompt-guard-2-86m'},{id:'canopylabs/orpheus-v1-english'},{id:'inactive',active:false}]});
    });
    expect(await provider.validateKey('candidate-key')).toEqual([{id:'llama-3.3-70b-versatile',name:'llama-3.3-70b-versatile'},{id:'future/text-model',name:'future/text-model'}]);
    await provider.listModels();expect(headers).toEqual([{Authorization:'Bearer candidate-key'},{Authorization:'Bearer saved-key'}]);
  });
  it('excludes the incompatible Allam default and puts documented tool models ahead of unknown manual choices',async()=>{
    const provider=new GroqProvider(()=>'dummy',async()=>Response.json({data:[
      {id:'allam-2-7b',active:true},{id:'future/Exact-Text-v9',active:true},{id:'llama-3.1-8b-instant',active:true},
      {id:'meta-models/muse-spark-open',active:true},{id:'llama-3.3-70b-versatile',active:true},{id:'qwen/qwen3.8-27b',active:true},
      {id:'minimaxai/minimax-m2.7',active:true},{id:'openai/gpt-oss-120b',active:true},{id:'openai/gpt-oss-20b',active:true},
      {id:'openai/gpt-oss-safeguard-20b',active:true},{id:'openai/gpt-oss-20b',active:true},{id:'future/Another-v1',active:true},
    ]}));
    const models=await provider.listModels();
    expect(models.map(model=>model.id)).toEqual(['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b','llama-3.3-70b-versatile','llama-3.1-8b-instant','minimaxai/minimax-m2.7','meta-models/muse-spark-open','future/Exact-Text-v9','future/Another-v1']);
    expect(models.find(model=>model.id==='future/Exact-Text-v9')).toEqual({id:'future/Exact-Text-v9',name:'future/Exact-Text-v9'});
  });
  it('recommends only actually returned active models and preserves an unknown-only catalog',async()=>{
    let result={data:[{id:'allam-2-7b',active:true},{id:'future/Exact-Text-v9',active:true},{id:'openai/gpt-oss-20b',active:false},{id:'llama-3.3-70b-versatile',active:true}]};
    const provider=new GroqProvider(()=>'dummy',async()=>Response.json(result));
    expect((await provider.listModels()).map(model=>model.id)).toEqual(['llama-3.3-70b-versatile','future/Exact-Text-v9']);
    result={data:[{id:'allam-2-7b',active:true},{id:'future/Exact-Text-v9',active:true}]};
    expect(await provider.listModels()).toEqual([{id:'future/Exact-Text-v9',name:'future/Exact-Text-v9'}]);
  });
  it('blocks an explicitly restored incompatible Allam selection before HTTP inference with actionable settings guidance',async()=>{
    let sent=false;const provider=new GroqProvider(()=>'dummy',async()=>{sent=true;return completed();});
    const error=await provider.complete({...request(),model:'allam-2-7b'},new AbortController().signal).catch(error=>error);
    expect(error).toBeInstanceOf(Error);expect(error.message).toMatch(/allam-2-7b.*teaching/i);expect(error.message).toMatch(/choose.*model.*settings/i);
    expect(error).not.toBeInstanceOf(GroqToolGenerationError);expect(sent).toBe(false);
  });
  it.each([
    [400,{code:'context_length_exceeded',message:'private-secret'},/context|token limit/i],
    [422,{code:'context_length_exceeded',message:'private-secret'},/context|token limit/i],
    [413,{message:'private-secret'},/request.*large|size|context/i],
    [400,{code:'invalid_request_error',message:'The model does not support tool use. private-secret'},/tool support/i],
    [400,{code:'tool_use_not_supported',message:'private-secret'},/tool support/i],
    [422,{code:'invalid_request_error',message:'This model has a maximum context length of 4096 tokens. private-secret'},/context|token limit/i],
  ])('classifies HTTP %s model capability or context rejection without exposing the body or entering repair',async(status,error,expected)=>{
    const provider=new GroqProvider(()=>'private-secret',async()=>Response.json({error},{status}));
    const rejection=await provider.complete(request(),new AbortController().signal).catch(error=>error);
    expect(rejection.message).toMatch(expected);expect(rejection.message).toMatch(/settings|shorter|smaller/i);expect(rejection.message).not.toContain('private-secret');expect(JSON.stringify(rejection)).not.toContain('private-secret');expect(rejection).not.toBeInstanceOf(GroqToolGenerationError);
  });
  it('sends native nested tools, translates developer context, and returns canonical complete calls and provenance',async()=>{
    let body:any;
    const provider=new GroqProvider(()=>'dummy',async(url,init)=>{
      expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions');expect(init?.method).toBe('POST');expect(init?.headers).toEqual({Authorization:'Bearer dummy','Content-Type':'application/json'});body=JSON.parse(String(init?.body));return completed();
    });
    const value=request();value.input.push({role:'developer',content:'Current canvas is empty.'});
    const result=await provider.complete(value,new AbortController().signal);
    expect(body).toEqual({model:'exact/model-id',messages:[{role:'system',content:'Teach using the supplied tools.'},{role:'user',content:'Explain motion.'},{role:'system',content:'Current canvas is empty.'}],tools:[{type:'function',function:{name:'teaching__present_beat',description:'A local tool.',parameters:{type:'object',properties:{},additionalProperties:false}}}],tool_choice:'required',stream:true});
    expect(result.calls).toEqual([{type:'function_call',call_id:'call_1',namespace:'teaching',name:'present_beat',arguments:'{}'}]);
    expect(result.modelMetadata).toMatchObject({providerId:'groq',requestedModel:'exact/model-id',servedModel:'served/model',responseId:'chatcmpl_test'});
  });
  it('preserves paired assistant tool calls and tool feedback without unsupported role names or Responses replay',async()=>{
    let body:any;const provider=new GroqProvider(()=>'dummy',async(_url,init)=>{body=JSON.parse(String(init?.body));return completed();});
    const value={...request(),input:[{role:'user',content:'Explain'}, {type:'function_call',call_id:'first',namespace:'teaching',name:'present_beat',arguments:'{"x":1}'},{type:'function_call',call_id:'second',namespace:'teaching',name:'present_beat',arguments:'{"x":2}'},{type:'function_call_output',call_id:'second',output:'{"ok":false}'},{type:'function_call_output',call_id:'first',output:'{"ok":true}'},{role:'developer',content:'Repair the second call.'}]};
    await provider.complete(value,new AbortController().signal);
    expect(body.messages).toEqual([{role:'system',content:'Teach using the supplied tools.'},{role:'user',content:'Explain'},{role:'assistant',content:null,tool_calls:[{id:'first',type:'function',function:{name:'teaching__present_beat',arguments:'{"x":1}'}},{id:'second',type:'function',function:{name:'teaching__present_beat',arguments:'{"x":2}'}}]},{role:'tool',tool_call_id:'second',content:'{"ok":false}'},{role:'tool',tool_call_id:'first',content:'{"ok":true}'},{role:'system',content:'Repair the second call.'}]);
  });
  it('rejects orphaned or duplicate results, unpaired calls, and unknown functions before network inference',async()=>{
    let sent=false;const provider=new GroqProvider(()=>'dummy',async()=>{sent=true;return completed();});
    for(const input of [[{type:'function_call_output',call_id:'orphan',output:'{}'}],[{type:'function_call',call_id:'missing',namespace:'teaching',name:'present_beat',arguments:'{}'}],[{type:'function_call',call_id:'a',namespace:'teaching',name:'present_beat',arguments:'{}'},{type:'function_call_output',call_id:'a',output:'{}'},{type:'function_call_output',call_id:'a',output:'{}'}]])await expect(provider.complete({...request(),input},new AbortController().signal)).rejects.toThrow(/pair|result|orphan/i);
    await expect(provider.complete({...request(),tools:[namespaceTool('evil','run_code')]},new AbortController().signal)).rejects.toThrow(/unsupported|unknown/i);expect(sent).toBe(false);
  });
  it('uses wire function identities in internal instructions and scoped canonical history',async()=>{
    let body:any;const provider=new GroqProvider(()=>'dummy',async(_url,init)=>{body=JSON.parse(String(init?.body));return completed();});
    const scope={providerId:'groq' as const,modelId:'exact/model-id',credentialRevision:'revision-a'};
    const value={...request(),scope,instructions:'Use teaching.present_beat and planning.propose_plan; preserve course.summarize_source and course.plan_course.'};
    const result=await provider.complete(value,new AbortController().signal);
    expect(body.messages[0].content).toBe('Use teaching__present_beat and planning__propose_plan; preserve course__summarize_source and course__plan_course.');
    expect(result.historyScope).toEqual(scope);
    await expect(provider.complete({...value,scope:{...scope,providerId:'gemini'}},new AbortController().signal)).rejects.toThrow(/scope/i);
  });
  it('rejects missing keys before contacting the service',async()=>{
    let sent=false;const provider=new GroqProvider(()=>undefined,async()=>{sent=true;return completed();});
    await expect(provider.listModels()).rejects.toThrow(/key/i);
    await expect(provider.validateKey('   ')).rejects.toThrow(/key/i);expect(sent).toBe(false);
  });
  it('sanitizes broken response-body and fetch errors without retaining arbitrary exception payloads',async()=>{
    for(const fetcher of [async()=>{throw new Error('top-secret');},async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('top-secret'));}}))]){
      const provider=new GroqProvider(()=>'top-secret',fetcher);
      const error=await provider.complete(request(),new AbortController().signal).catch(error=>error);expect(error.message).toMatch(/Groq/);expect(JSON.stringify(error)).not.toContain('top-secret');expect(error.message).not.toContain('top-secret');
    }
  });
  it.each(['model_not_found','model_decommissioned','model_permission_blocked'])('makes %s actionable without generated-content repair',async code=>{
    const provider=new GroqProvider(()=>'dummy',async()=>Response.json({error:{code,message:'do not replay'}},{status:400}));
    const error=await provider.complete(request(),new AbortController().signal).catch(error=>error);expect(error.message).toMatch(/model.*access|model.*available|permission/i);expect(error).not.toBeInstanceOf(GroqToolGenerationError);
  });
  it('serializes all four real schemas without response_format, strict, store, or namespace wire fields',async()=>{
    const schemas=[namespaceTool('teaching','present_beat',getTeachingToolParameters()),namespaceTool('planning','propose_plan',getPlanningToolParameters()),...courseTool('summarize_source'),...courseTool('plan_course')];
    let body:any;const provider=new GroqProvider(()=>'dummy',async(_url,init)=>{body=JSON.parse(String(init?.body));return completed();});
    await provider.complete({...request(),tools:schemas},new AbortController().signal);
    expect(body.tools.map((tool:any)=>tool.function.name)).toEqual(['teaching__present_beat','planning__propose_plan','course__summarize_source','course__plan_course']);
    for(let i=0;i<schemas.length;i++)expect(body.tools[i].function.parameters).toEqual((schemas[i] as any).tools[0].parameters);
    expect(body).not.toHaveProperty('response_format');expect(body).not.toHaveProperty('store');for(const tool of body.tools){expect(tool).not.toHaveProperty('namespace');expect(tool.function).not.toHaveProperty('strict');}
  });
  it('exposes a safe repairable tool-generation diagnostic without executing or leaking failed_generation',async()=>{
    const provider=new GroqProvider(()=>'top-secret',async()=>Response.json({error:{code:'tool_use_failed',failed_generation:'top-secret malicious raw output',message:'top-secret'}},{status:400}));
    const error=await provider.complete(request(),new AbortController().signal).catch(error=>error);
    expect(error).toBeInstanceOf(GroqToolGenerationError);expect(error).toMatchObject({providerId:'groq',code:'tool_use_failed',repairable:true});expect(error.message).not.toContain('top-secret');expect(error).not.toHaveProperty('calls');
  });
  it('routes an HTTP-success streamed tool-generation failure through the coordinator repair boundary without inventing calls',async()=>{
    const provider=new GroqProvider(()=>'private-secret',async()=>new Response('data: '+JSON.stringify({error:{code:'tool_use_failed',message:'private-secret',failed_generation:'private-secret'}})+'\n\n'));
    const result=await completeTeaching(provider,request(),new AbortController().signal);
    expect(result).toMatchObject({calls:[],output:[],text:'',repairDiagnostic:expect.stringMatching(/valid teaching tool call/i)});expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it.each([
    [401,{code:'invalid_api_key'},/API key/i],
    [403,{code:'model_permission_blocked'},/permission|model access/i],
    [404,{code:'model_not_found'},/model access/i],
    [400,{code:'model_decommissioned'},/model access/i],
    [429,{code:'rate_limit_exceeded'},/rate limit/i],
    [402,{code:'insufficient_quota'},/credit|quota/i],
    [400,{code:'context_length_exceeded'},/context.*token limit/i],
    [400,{code:'tool_use_not_supported'},/tool support/i],
    [400,{code:'invalid_request_error'},/request or tool schema/i],
    [503,{code:'service_unavailable'},/temporarily unavailable/i],
    [500,{type:'server_error'},/temporarily unavailable/i],
  ])('uses the same safe classification for HTTP %s and a streamed error without an HTTP failure status',async(status,details,expected)=>{
    const error={...details,message:'private-secret',failed_generation:'private-secret'};
    const errors=[];
    for(const response of [Response.json({error},{status}),new Response('data: '+JSON.stringify({error})+'\n\n')]){
      const provider=new GroqProvider(()=>'private-secret',async()=>response);
      const rejection=await provider.complete(request(),new AbortController().signal).catch(error=>error);
      expect(rejection.message).toMatch(expected);expect(rejection.message).not.toContain('private-secret');expect(JSON.stringify(rejection)).not.toContain('private-secret');expect(rejection).not.toBeInstanceOf(GroqToolGenerationError);errors.push(rejection);
    }
    expect(errors[0].message).toBe(errors[1].message);
  });
  it('keeps an unrecognized stream error actionable and nonrepairable without leaking its unknown code',async()=>{
    const provider=new GroqProvider(()=>'private-secret',async()=>new Response('data: '+JSON.stringify({error:{code:'private-secret',message:'private-secret',failed_generation:'private-secret'}})+'\n\n'));
    const error=await provider.complete(request(),new AbortController().signal).catch(error=>error);
    expect(error.message).toMatch(/streaming error/i);expect(error.message).toMatch(/try again|settings/i);expect(error.message).not.toContain('private-secret');expect(JSON.stringify(error)).not.toContain('private-secret');expect(error).not.toBeInstanceOf(GroqToolGenerationError);
  });
  it.each([[400,'invalid_request_error',/request|schema/i],[401,'invalid_api_key',/key/i],[403,'model_permission_blocked',/permission|access/i],[429,'rate_limit_exceeded',/limit|quota/i],[402,'insufficient_quota',/credit|quota|billing/i],[500,'internal_error',/temporar|unavailable/i]])('sanitizes HTTP %s failures and does not mark request failures repairable',async(status,code,expected)=>{
    const provider=new GroqProvider(()=>'top-secret',async()=>Response.json({error:{code,message:'top-secret',failed_generation:'top-secret'}},{status}));
    const error=await provider.complete(request(),new AbortController().signal).catch(error=>error);expect(error.message).toMatch(expected);expect(error.message).not.toContain('top-secret');expect(error).not.toBeInstanceOf(GroqToolGenerationError);
  });
  it('aborts fetch adapters that ignore their signal and times out stalled catalog and body requests',async()=>{
    vi.useFakeTimers();const controller=new AbortController();const provider=new GroqProvider(()=>'dummy',async()=>new Promise<Response>(()=>{}));
    const pending=provider.complete(request(),controller.signal);const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;
    const catalog=provider.listModels();const catalogRejected=expect(catalog).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(30_001);await catalogRejected;
    const bodyProvider=new GroqProvider(()=>'dummy',async()=>new Response(new ReadableStream()));
    const body=bodyProvider.complete(request(),new AbortController().signal);const bodyRejected=expect(body).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(180_001);await bodyRejected;
  });
});
