import {describe,it,expect,vi} from 'vitest';
import type {LessonSession} from '@living-canvas/protocol';
import {ChatGPTProvider} from '../../apps/desktop/src/main/ai/chatgpt-provider';
import {NotesCoordinator} from '../../apps/desktop/src/main/notes/notes-coordinator';
import {readResponseStream} from '../../apps/desktop/src/main/ai/tool-stream';
import {notesFixture} from '../fixtures/lesson-notes';

const lesson=():LessonSession=>({id:'lesson-1',title:'Earth',topic:'Earth’s journey around the Sun',createdAt:'2026-10-31T12:00:00.000Z',updatedAt:'2026-10-31T12:00:00.000Z',messages:[{id:'heard-1',role:'tutor',text:'Earth rotates each day and revolves around the Sun each year.',createdAt:'2026-10-31T12:00:00.000Z'},{id:'heard-2',role:'tutor',text:'The diagram marks four positions through the year.',createdAt:'2026-10-31T12:01:00.000Z'}],beats:[],scene:[],controls:{}});
const request={model:'gpt-6.1-sol',instructions:'Create studied notes.',input:[],tools:[]};
const signal=()=>new AbortController().signal;
const fail=async(provider:ChatGPTProvider)=>provider.complete(request,signal()).then(()=>{throw new Error('Expected the synthetic request to fail.');},error=>error as Error&{diagnostic?:unknown});

describe('ChatGPT notes route and safe rejection diagnostics',()=>{
  it('runs real ChatGPT notes as a text report without requesting rejected tool capabilities',async()=>{
    let calls=0;
    const provider=new ChatGPTProvider({accessToken:async()=> 'synthetic-token'},async(_url,init)=>{
      calls++;const body=JSON.parse(String(init?.body));
      if(Object.hasOwn(body,'tools'))return Response.json({error:{param:'tools'}},{status:400});
      expect(Object.keys(body).sort()).toEqual(['input','instructions','model','store','stream']);
      expect(body).toMatchObject({model:'gpt-6.1-sol',store:false,stream:true});
      const content=notesFixture().content;
      return new Response(`data: ${JSON.stringify({type:'response.completed',response:{id:'resp_notes',model:'gpt-6.1-sol',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(content)}]}]}})}\n\n`);
    });
    const notes=await new NotesCoordinator({sessions:{load:lesson},provider,model:()=> 'gpt-6.1-sol'}).generate('lesson-1');
    expect(notes.content).toEqual(notesFixture().content);expect(notes.modelMetadata).toMatchObject({providerId:'chatgpt',requestedModel:'gpt-6.1-sol',responseId:'resp_notes'});expect(calls).toBe(1);
  });
  it('retains a rejected notes schema status/code/parameter without remote text or credentials',async()=>{
    const fetch=vi.fn(async()=>Response.json({error:{code:'invalid_function_parameters',type:'invalid_request_error',param:'tools[0].tools[0].parameters',message:'PRIVATE_RAW_ERROR',access_token:'PRIVATE_ACCESS_TOKEN'}},{status:400}));
    const error=await fail(new ChatGPTProvider({accessToken:async()=> 'synthetic-token'},fetch));
    expect(error).toMatchObject({name:'ChatGPTAPIError',diagnostic:{status:400,code:'invalid_function_parameters',param:'tools[0].tools[0].parameters'}});
    expect(error.message).toMatch(/tool.*(?:format|schema)|schema/i);
    expect(error.message).toContain('HTTP 400');expect(error.message).toContain('invalid_function_parameters');
    expect(JSON.stringify(error)+error.message).not.toMatch(/PRIVATE|synthetic-token|access_token|message.*PRIVATE/);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('distinguishes unavailable models from request-format errors without guessing at quota',async()=>{
    const error=await fail(new ChatGPTProvider({accessToken:async()=> 'fixture'},async()=>Response.json({error:{code:'model_not_found',param:'model'}},{status:404})));
    expect(error).toMatchObject({diagnostic:{status:404,code:'model_not_found',param:'model'}});
    expect(error.message).toMatch(/model.*(?:available|unavailable)|choose.*model/i);expect(error.message).not.toMatch(/quota|usage limit/i);
  });
  it('discards unknown error tokens, parameters, direct-admission text and extra response fields',async()=>{
    const error=await fail(new ChatGPTProvider({accessToken:async()=> 'fixture'},async()=>Response.json({detail:'PRIVATE_DETAIL',error:{code:'sk-PRIVATE_KEY',param:'tools[0].PRIVATE_FIELD',message:'PRIVATE_MESSAGE'}},{status:400})));
    expect(error).toMatchObject({diagnostic:{status:400}});expect(error.diagnostic).not.toHaveProperty('code');expect(error.diagnostic).not.toHaveProperty('param');
    expect(error).not.toHaveProperty('detail');expect(JSON.stringify(error)+error.message).not.toMatch(/PRIVATE|sk-/);
  });
  it('bounds rejected HTTP bodies and cancels the remaining response without retrying',async()=>{
    let chunks=0;const canceled=vi.fn();
    const body=new ReadableStream<Uint8Array>({pull(controller){chunks++;controller.enqueue(new Uint8Array(8192).fill(65));},cancel:canceled});
    const fetch=vi.fn(async()=>new Response(body,{status:400}));
    const error=await fail(new ChatGPTProvider({accessToken:async()=> 'fixture'},fetch));
    expect(error).toMatchObject({diagnostic:{status:400}});expect(chunks).toBeLessThanOrEqual(4);expect(canceled).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels an unread error body promptly when the caller aborts',async()=>{
    const canceled=vi.fn(),controller=new AbortController();
    const body=new ReadableStream<Uint8Array>({start(){},cancel:canceled});
    const fetch=vi.fn(async()=>new Response(body,{status:400}));
    const provider=new ChatGPTProvider({accessToken:async()=> 'fixture'},fetch);
    const pending=provider.complete(request,controller.signal);const rejected=expect(pending).rejects.toThrow('Canceled notes diagnostics.');
    await vi.waitFor(()=>expect(body.locked).toBe(true));controller.abort(new Error('Canceled notes diagnostics.'));await rejected;
    expect(canceled).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('settles stalled error JSON within five seconds with only the known HTTP status',async()=>{
    vi.useFakeTimers();try{
      const canceled=vi.fn(),body=new ReadableStream<Uint8Array>({start(){},cancel:canceled});
      const fetch=vi.fn(async()=>new Response(body,{status:400}));
      const pending=fail(new ChatGPTProvider({accessToken:async()=> 'fixture'},fetch));
      await vi.advanceTimersByTimeAsync(5001);
      const error=await pending;expect(error).toMatchObject({diagnostic:{status:400}});expect(canceled).toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();}
  });
  it('preserves nested streaming failure codes instead of hiding an unsupported-capability rejection',async()=>{
    const body=new Response(`data: ${JSON.stringify({type:'error',error:{code:'subscription_sharing_unsupported_capability',param:'tools',message:'PRIVATE_STREAM_MESSAGE'}})}\n\n`).body!;
    const error=await readResponseStream(body,signal()).catch(error=>error);
    expect(error).toMatchObject({diagnostic:{code:'subscription_sharing_unsupported_capability',param:'tools'}});expect(error.message).toMatch(/unsupported|not supported|feature/i);
    expect(JSON.stringify(error)+error.message).not.toContain('PRIVATE');
  });
});
