import {expect,it} from 'vitest';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {LearningPlanCoordinator} from '../../apps/desktop/src/main/ai/learning-plan-coordinator';
import {LessonCoordinator} from '../../apps/desktop/src/main/ai/lesson-coordinator';
import {ProviderToolGenerationError,type ProviderScope} from '../../apps/desktop/src/main/ai/provider-contract';

const scope=(providerId:'gemini'|'groq',credentialRevision='connection-one'):ProviderScope=>({providerId,modelId:'same/model',credentialRevision});
it('never replays unscoped legacy or another provider/credential history and preserves safe provenance',()=>{
  const store=new SessionRepository(':memory:'),lesson=store.create('source');
  store.recordProviderRound(lesson.id,[{legacy:true}],[]);
  expect(store.providerHistory(lesson.id,scope('groq'))).toEqual([]);
  const metadata={providerId:'groq' as const,requestedModel:'same/model',completedAt:new Date().toISOString()};
  store.recordProviderRound(lesson.id,[{name:'paired-call'}],[{name:'paired-result'}],metadata,scope('groq'));
  expect(store.load(lesson.id).modelRuns?.[0].providerId).toBe('groq');
  expect(store.providerHistory(lesson.id,scope('groq'))).toEqual([{name:'paired-call'},{name:'paired-result'}]);
  expect(store.providerHistory(lesson.id,scope('gemini'))).toEqual([]);
  expect(store.providerHistory(lesson.id,scope('groq','replacement'))).toEqual([]);
  store.recordProviderRound(lesson.id,[{gemini:true}],[],{...metadata,providerId:'gemini'},scope('gemini'));
  expect(store.providerHistory(lesson.id,scope('groq'))).toEqual([]);
  store.close();
});
it('drops a whole oversized native round rather than returning incomplete tool pairs',()=>{
  const store=new SessionRepository(':memory:'),lesson=store.create('source');
  store.recordProviderRound(lesson.id,[{arguments:'x'.repeat(48000)}],[{result:'ok'}],undefined,scope('groq'));
  expect(store.providerHistory(lesson.id,scope('groq'))).toEqual([]);store.close();
});
it('repairs provider-generated tool errors without inventing call IDs or replaying failed generation',async()=>{
  const store=new SessionRepository(':memory:'),lesson=store.create('gravity'),requests:unknown[][]=[];
  const provider={complete:async(request:{input:unknown[]})=>{
    requests.push([...request.input]);
    if(requests.length===1)throw new ProviderToolGenerationError('groq','Return a complete tool call.');
    const call={type:'function_call' as const,call_id:'real-call',namespace:'planning',name:'propose_plan',arguments:JSON.stringify({title:'Gravity',sourceDocumentIds:[],concepts:[{id:'force',title:'Force',objectives:['Understand gravity'],prerequisiteIds:[],sourceRefs:[]}]})};
    return {calls:[call],output:[call],text:''};
  }};
  const planner=new LearningPlanCoordinator({store,provider,model:()=> 'same/model'});
  expect((await planner.planTopic({sessionId:lesson.id})).title).toBe('Gravity');
  expect(requests).toHaveLength(2);
  expect(requests[1].some(item=>(item as {type?:string}).type==='function_call_output')).toBe(false);
  expect(JSON.stringify(requests[1])).toContain('Return a complete tool call.');store.close();
});
it('spends at most two teaching repairs on repeated native tool-generation failures',async()=>{
  const store=new SessionRepository(':memory:'),lesson=store.create('gravity');let attempts=0;
  const events:unknown[]=[];
  const provider={complete:async()=>{attempts++;throw new ProviderToolGenerationError('groq','Return a complete tool call.');}};
  const teacher={buildTeacherInstructions:()=> 'teach',buildLessonContext:()=> '{}',getTeachingToolParameters:()=>({}),parseTeachingBeat:()=>{throw new Error('No accepted call.');}};
  const coordinator=new LessonCoordinator({store,provider,teacher,model:()=> 'same/model',emit:event=>events.push(event)});
  await coordinator.send({sessionId:lesson.id,text:'Teach gravity'});
  expect(attempts).toBe(3);expect(store.load(lesson.id).beats).toEqual([]);
  expect(events.some(event=>(event as {type?:string}).type==='error')).toBe(true);store.close();
});
