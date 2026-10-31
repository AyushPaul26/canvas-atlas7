import {describe,it,expect,vi} from 'vitest';
import type {LessonSession,StudyNotesDraft} from '@living-canvas/protocol';
import type {ProviderRequest,ProviderScope} from '../../apps/desktop/src/main/ai/provider-contract';
import {ProviderToolGenerationError} from '../../apps/desktop/src/main/ai/provider-contract';
import {NotesCoordinator} from '../../apps/desktop/src/main/notes/notes-coordinator';

const lesson=():LessonSession=>({id:'session',title:'Gravity',topic:'Gravity',createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',messages:[{id:'heard-one',role:'tutor',text:'Mass attracts mass.',createdAt:'2026-10-31T00:00:00.000Z'}],beats:[{id:'heard-one',narration:'Mass attracts mass. UNHEARD_SUFFIX',title:'UNHEARD_TITLE',canvas:{mode:'replace',entities:[{id:'mass',kind:'circle',x:50,y:50,radius:10}]}}],scene:[],controls:{}});
const draft=():StudyNotesDraft=>({title:'Your gravity notes',overview:'Mass attracts mass.',sections:[{title:'Gravitation',evidenceIds:['heard-one'],explanation:'Gravity is the attraction between masses.',keyPoints:['Mass attracts mass.'],definitions:[{term:'Gravity',meaning:'Attraction between masses.'}],equations:[],examples:[]}],recap:['Masses attract.'],reviewQuestions:[{question:'What attracts?',answer:'Mass attracts mass.',evidenceIds:['heard-one']}]});
const completed=(content:unknown=draft())=>({calls:[{type:'function_call' as const,call_id:'notes-call',namespace:'notes',name:'create_notes',arguments:JSON.stringify(content)}],output:[],text:'',modelMetadata:{providerId:'groq' as const,requestedModel:'exact/model',servedModel:'served/model',completedAt:'2026-10-31T00:01:00.000Z'}});
const setup=(complete=vi.fn(async(_request:ProviderRequest,_signal:AbortSignal)=>completed()))=>{
  const state={lesson:lesson(),model:'exact/model',scope:{providerId:'groq',modelId:'exact/model',credentialRevision:'revision-one'} as ProviderScope};
  const sessions={load:vi.fn(()=>structuredClone(state.lesson))};
  const coordinator=new NotesCoordinator({sessions,provider:{complete,scope:()=>state.scope},model:()=>state.model,now:()=>new Date('2026-10-31T00:02:00.000Z'),createId:()=> '11111111-1111-4111-8111-111111111111'});
  return {state,sessions,coordinator,complete};
};

describe('one-shot lesson notes generation',()=>{
  it('requests exactly one evidence-bound notes tool with no prepared history or unseen suffix',async()=>{
    const {coordinator,complete,sessions}=setup();const document=await coordinator.generate('session');
    expect(complete).toHaveBeenCalledTimes(1);const request=complete.mock.calls[0][0];
    expect(request.model).toBe('exact/model');expect(request.tools[0]).toMatchObject({type:'namespace',name:'notes',tools:[{name:'create_notes',strict:true}]});
    const context=JSON.parse((request.input[0] as any).content);expect(context.explanations).toEqual([{id:'heard-one',text:'Mass attracts mass.'}]);
    expect(JSON.stringify(request)).not.toMatch(/UNHEARD|provider-round|simulation/);
    expect(document).toMatchObject({version:1,id:'11111111-1111-4111-8111-111111111111',sessionId:'session',studiedSteps:1,content:draft(),modelMetadata:{providerId:'groq',requestedModel:'exact/model',servedModel:'served/model'}});
    expect(sessions.load).toHaveBeenCalledTimes(2);
  });
  it('makes no model request without presented study content',async()=>{
    const {coordinator,state,complete}=setup();state.lesson.messages=[];
    await expect(coordinator.generate('session')).rejects.toThrow(/study|presented|explanation/i);expect(complete).not.toHaveBeenCalled();
  });
  it('blocks unsafe saved study before spending a notes request',async()=>{
    const {coordinator,state,complete}=setup();state.lesson.messages[0].text='explicit sexual roleplay';
    await expect(coordinator.generate('session')).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',surface:'saved-content'});expect(complete).not.toHaveBeenCalled();
  });
  it('blocks unsafe generated notes before publication without a repair call',async()=>{
    const content=draft();content.sections[0].explanation='explicit sexual roleplay';
    const {coordinator,complete}=setup(vi.fn(async()=>completed(content)));
    await expect(coordinator.generate('session')).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',surface:'model-output'});expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(['section','question','omitted'])('rejects %s evidence mistakes without a hidden repair request',async kind=>{
    const content=draft();if(kind==='section')content.sections[0].evidenceIds=['future-only'];else if(kind==='question')content.reviewQuestions[0].evidenceIds=['student-question'];
    const {coordinator,state,complete}=setup(vi.fn(async()=>completed(content)));
    if(kind==='omitted')state.lesson.messages.push({...state.lesson.messages[0],id:'heard-two',text:'Distance also matters.'});
    await expect(coordinator.generate('session')).rejects.toThrow(/notes.*(valid|cover|evidence)|evidence|studied/i);expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(['empty','multiple','wrong','malformed'])('rejects %s tool output without retry',async kind=>{
    const response=completed();if(kind==='empty')response.calls=[];else if(kind==='multiple')response.calls.push({...response.calls[0],call_id:'other'});else if(kind==='wrong')response.calls[0].name='present_beat';else response.calls[0].arguments='{bad';
    const {coordinator,complete}=setup(vi.fn(async()=>response));await expect(coordinator.generate('session')).rejects.toThrow(/notes/i);expect(complete).toHaveBeenCalledTimes(1);
  });
  it('does not retry typed generation failure or upstream quota errors',async()=>{
    for(const error of [new ProviderToolGenerationError('groq','Fixed generated tool failure.'),new Error('Groq request or token rate limit reached.')]){
      const {coordinator,complete}=setup(vi.fn(async()=>{throw error;}));await expect(coordinator.generate('session')).rejects.toThrow();expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it('settles cancellation promptly and rejects late results even when the provider ignores abort',async()=>{
    let resolve!:(value:ReturnType<typeof completed>)=>void;
    const {coordinator,complete}=setup(vi.fn(()=>new Promise(r=>{resolve=r;})));
    const pending=coordinator.generate('session');const rejected=expect(pending).rejects.toThrow(/cancel/i);
    await expect(coordinator.generate('session')).rejects.toThrow(/already|progress/i);
    coordinator.cancel('session');await rejected;resolve(completed());expect(complete).toHaveBeenCalledTimes(1);
  });
  it('honors external abort without making a model request when already canceled',async()=>{
    const {coordinator,complete}=setup();const controller=new AbortController();controller.abort(new Error('Notes were canceled.'));
    await expect(coordinator.generate('session',controller.signal)).rejects.toThrow(/cancel/i);expect(complete).not.toHaveBeenCalled();
  });
  it('observes a rejecting transport even if it cancels the request synchronously',async()=>{
    let calls=0;
    const coordinator=new NotesCoordinator({sessions:{load:lesson},model:()=> 'exact/model',provider:{complete:()=>{calls++;coordinator.cancel('session');return Promise.reject(new Error('Synthetic late transport rejection.'));}}});
    await expect(coordinator.generate('session')).rejects.toThrow(/cancel/i);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(calls).toBe(1);
  });
  it('bounds a stalled provider with the notes deadline without hidden retries',async()=>{
    vi.useFakeTimers();try{
      const {coordinator,complete}=setup(vi.fn(()=>new Promise(()=>{})));
      const pending=coordinator.generate('session');const rejected=expect(pending).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(180001);await rejected;expect(complete).toHaveBeenCalledTimes(1);
    }finally{vi.useRealTimers();}
  });
  it.each(['model','credential','content','deleted'])('rejects a stale %s snapshot instead of publishing output',async kind=>{
    let resolve!:(value:ReturnType<typeof completed>)=>void;
    const {coordinator,state,sessions}=setup(vi.fn(()=>new Promise(r=>{resolve=r;})));
    const pending=coordinator.generate('session');
    if(kind==='model')state.model='different/model';else if(kind==='credential')state.scope={...state.scope,credentialRevision:'revision-two'};else if(kind==='content')state.lesson.messages[0].text+=' More studied content.';else sessions.load.mockImplementation(()=>{throw new Error('This lesson was not found.');});
    resolve(completed());await expect(pending).rejects.toThrow(/changed|found|stale|again/i);
  });
});
