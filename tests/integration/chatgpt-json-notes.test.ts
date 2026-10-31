import {describe,it,expect,vi} from 'vitest';
import {NOTES_LIMITS,type LessonSession} from '@living-canvas/protocol';
import {ChatGPTProvider} from '../../apps/desktop/src/main/ai/chatgpt-provider';
import {NotesCoordinator} from '../../apps/desktop/src/main/notes/notes-coordinator';
import type {ProviderRequest,ProviderScope} from '../../apps/desktop/src/main/ai/provider-contract';
import {notesFixture} from '../fixtures/lesson-notes';

const lesson=():LessonSession=>({id:'lesson-1',title:'Earth',topic:'Earth',createdAt:'2026-10-31T12:00:00.000Z',updatedAt:'2026-10-31T12:00:00.000Z',messages:[{id:'heard-1',role:'tutor',text:'Earth rotates daily.',createdAt:'2026-10-31T12:00:00.000Z'},{id:'heard-2',role:'tutor',text:'Earth follows an orbit.',createdAt:'2026-10-31T12:01:00.000Z'}],beats:[],scene:[],controls:{}});
const draft=()=>notesFixture().content;
const output=(text:string)=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const sse=(events:unknown[])=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''));
const completed=(text:string)=>({calls:[],output:[output(text)],text,servedModel:'gpt-6.1-sol',responseId:'resp_notes'});

describe('ChatGPT notes as one validated JSON report',()=>{
  it.each(['deltas','completed','fenced'] as const)('accepts %s JSON through the real text adapter with zero tool fields',async form=>{
    const json=JSON.stringify(draft()),text=form==='fenced'?`\n\n\`\`\`json\n${json}\n\`\`\`\n`:json;
    let calls=0;
    const provider=new ChatGPTProvider({accessToken:async()=> 'fixture-token'},async(_url,init)=>{
      calls++;const body=JSON.parse(String(init?.body));
      if(Object.hasOwn(body,'tools'))return Response.json({error:{param:'tools'}},{status:400});
      expect(body).toMatchObject({model:'gpt-6.1-sol',store:false,stream:true});expect(body.instructions).toContain('"reviewQuestions"');expect(body.instructions).not.toContain('Use only notes.create_notes');
      const terminal={type:'response.completed',response:{id:'resp_notes',model:'gpt-6.1-sol',output:[output(text)]}};
      return sse(form==='deltas'?[{type:'response.output_text.delta',delta:text.slice(0,31)},{type:'response.output_text.delta',delta:text.slice(31)},terminal]:[terminal]);
    });
    const notes=await new NotesCoordinator({sessions:{load:lesson},provider,model:()=> 'gpt-6.1-sol'}).generate('lesson-1');
    expect(notes.content).toEqual(draft());expect(notes.modelMetadata).toMatchObject({providerId:'chatgpt',requestedModel:'gpt-6.1-sol',servedModel:'gpt-6.1-sol',responseId:'resp_notes'});expect(calls).toBe(1);
  });
  it.each(['malformed','prefix','trailing','multiple','oversized','unknown-id','omitted-id','refusal','mixed-refusal','tool-call'] as const)('rejects %s output without retry or fallback',async kind=>{
    const content=draft();if(kind==='unknown-id')content.sections[0].evidenceIds=['unheard'];if(kind==='omitted-id')content.sections[1].evidenceIds=['heard-1'];
    let text=JSON.stringify(content);
    if(kind==='malformed')text='{"title":';if(kind==='prefix')text=`Here are your notes: ${text}`;if(kind==='trailing')text+=' All done.';if(kind==='multiple')text+=text;if(kind==='oversized')text=' '.repeat(NOTES_LIMITS.draftBytes+1)+text;
    const response=completed(text);
    if(kind==='refusal'){response.text='';response.output=[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'I cannot provide that.'}]} as any];}
    if(kind==='mixed-refusal')(response.output[0].content as any[]).push({type:'refusal',refusal:'I cannot provide that.'});
    if(kind==='tool-call')(response.calls as any[]).push({type:'function_call',namespace:'notes',name:'create_notes',call_id:'unexpected',arguments:text});
    const complete=vi.fn(async()=>response);
    const coordinator=new NotesCoordinator({sessions:{load:lesson},provider:{id:'chatgpt',complete},model:()=> 'gpt-6.1-sol'});
    await expect(coordinator.generate('lesson-1')).rejects.toThrow(/notes|valid|age-appropriate/i);expect(complete).toHaveBeenCalledTimes(1);
  });
  it('chooses JSON from the captured ChatGPT scope when a provider manager hides the adapter ID',async()=>{
    let received:ProviderRequest|undefined;
    const scope:ProviderScope={providerId:'chatgpt',modelId:'gpt-6.1-sol',credentialRevision:'fixture-revision'};
    const coordinator=new NotesCoordinator({sessions:{load:lesson},provider:{scope:()=>scope,complete:async request=>{received=request;return completed(JSON.stringify(draft()));}},model:()=>scope.modelId});
    expect((await coordinator.generate('lesson-1')).modelMetadata.providerId).toBe('chatgpt');expect(received?.tools).toEqual([]);
  });
  it('settles cancellation before an ignored-abort JSON response and never requests again',async()=>{
    let release!:(response:ReturnType<typeof completed>)=>void;
    const complete=vi.fn(()=>new Promise<ReturnType<typeof completed>>(resolve=>{release=resolve;}));
    const coordinator=new NotesCoordinator({sessions:{load:lesson},provider:{id:'chatgpt',complete},model:()=> 'gpt-6.1-sol'});
    const pending=coordinator.generate('lesson-1');const rejected=expect(pending).rejects.toThrow(/cancel/i);coordinator.cancel('lesson-1');await rejected;release(completed(JSON.stringify(draft())));expect(complete).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed ChatGPT credential scope before returning JSON notes',async()=>{
    let scope:ProviderScope={providerId:'chatgpt',modelId:'gpt-6.1-sol',credentialRevision:'one'};
    const complete=vi.fn(async()=>{scope={...scope,credentialRevision:'two'};return completed(JSON.stringify(draft()));});
    const coordinator=new NotesCoordinator({sessions:{load:lesson},provider:{scope:()=>scope,complete},model:()=>scope.modelId});
    await expect(coordinator.generate('lesson-1')).rejects.toThrow(/changed/i);expect(complete).toHaveBeenCalledTimes(1);
  });
});
