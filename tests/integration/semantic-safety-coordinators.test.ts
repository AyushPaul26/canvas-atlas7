import {describe,it,expect} from 'vitest';
import {LessonCoordinator} from '../../apps/desktop/src/main/ai/lesson-coordinator';
import {LearningPlanCoordinator} from '../../apps/desktop/src/main/ai/learning-plan-coordinator';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../../apps/desktop/src/main/safety/contracts';
import type {ProviderRequest} from '../../apps/desktop/src/main/ai/provider-contract';
import type {TutorEvent} from '@living-canvas/protocol';
import {CourseCoordinator} from '../../apps/desktop/src/main/ai/course-coordinator';
import {DocumentRepository} from '../../apps/desktop/src/main/storage/document-repository';
import {CourseRepository} from '../../apps/desktop/src/main/storage/course-repository';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';

function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function guard(){
  const tasks:SafetyTask[]=[],outputs:unknown[]=[];const permit:SafetyPermit={token:'fixture',policyVersion:'v1',binding:'exact'};
  const safety:SafetyGate={authorize:async task=>{tasks.push(structuredClone(task));return permit;},assertCurrent:value=>{if(value!==permit)throw new Error('Stale safety approval.');},inspect:async content=>{outputs.push(content);},isApproved:()=>true,assertApproved:()=>{},derive:()=>{},registerTrusted:()=>{},cancel:()=>{},cancelAll:()=>{}};
  return {safety,tasks,outputs,permit};
}
const plan={id:'plan',version:1,title:'Reactions',sourceDocumentIds:[],concepts:[{id:'reaction',title:'Energy changes',objectives:['Explain energy'],prerequisiteIds:[],sourceRefs:[]}]};
const teacher={buildTeacherInstructions:()=>'',buildLessonContext:()=>'',getTeachingToolParameters:()=>({}),parseTeachingBeat:(value:any)=>value};
const beat={id:'beat',narration:'Energy is conserved.',next:'ask',canvas:{mode:'replace',entities:[]}};
const reply=(value:unknown=beat)=>{const call={type:'function_call' as const,call_id:'one',name:'present_beat',namespace:'teaching',arguments:JSON.stringify(value)};return {calls:[call],output:[call],text:''};};
describe('semantic authorization before coordinator side effects',()=>{
  it('publishes a safe follow-up with real signed provenance for the composed lesson and each spoken chunk',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Energy'),events:TutorEvent[]=[];let classifierCalls=0;
      const safety=new SafetyGuardian({secret:new Uint8Array(32).fill(8),classify:async()=>{classifierCalls++;return {decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};}});
      const coordinator=new LessonCoordinator({store,provider:{complete:async()=>({...reply(),modelMetadata:{requestedModel:'fixture',completedAt:'2026-10-31T00:00:00Z'}})},teacher,model:()=> 'fixture',emit:event=>events.push(event),safety});
      await coordinator.send({sessionId:lesson.id,text:'Explain energy transfer.'});
      const accepted=events.find(event=>event.type==='beat');expect(accepted).toBeDefined();if(accepted?.type!=='beat')throw new Error('Safe beat was not published.');
      expect(()=>safety.assertApproved(accepted.beat.narration,'narration')).not.toThrow();expect(classifierCalls).toBeGreaterThanOrEqual(2);
      expect(()=>safety.assertApproved(store.load(lesson.id),'saved-content')).not.toThrow();
      coordinator.presentProgress({sessionId:lesson.id,epoch:accepted.epoch,beatId:accepted.beat.id,scene:[],narration:'Energy is',complete:false});
      expect(store.load(lesson.id).messages.at(-1)?.text).toBe('Energy is');expect(()=>safety.assertApproved(store.load(lesson.id),'saved-content')).not.toThrow();
    }finally{store.close();}
  });
  it('prepares a safe roadmap with real signed provenance for its newly composed progress record',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Energy');const safety=new SafetyGuardian({secret:new Uint8Array(32).fill(8),classify:async()=>({decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null})});
      const proposed={...plan,title:'Energy',concepts:[{...plan.concepts[0],id:'concept_identifier_without_label'}]};
      const planner=new LearningPlanCoordinator({store,provider:{complete:async()=>({calls:[{type:'function_call' as const,call_id:'plan',name:'propose_plan',namespace:'planning',arguments:JSON.stringify(proposed)}],output:[],text:''})},model:()=> 'fixture',safety});
      const actual=await planner.planTopic({sessionId:lesson.id});expect(actual.title).toBe('Energy');expect(()=>safety.assertApproved(store.load(lesson.id))).not.toThrow();
    }finally{store.close();}
  });
  it('blocks a contextual follow-up before recording any answer, message, provider call or progress change',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Chemical reactions');store.savePlan(lesson.id,plan);const before=store.load(lesson.id);const g=guard();let requests=0;
      g.safety.authorize=async()=>{throw new Error('Contextual request blocked.');};
      const coordinator=new LessonCoordinator({store,provider:{complete:async()=>{requests++;return reply();}},teacher,model:()=> 'fixture',emit:()=>{},safety:g.safety});
      await expect(coordinator.send({sessionId:lesson.id,text:'Now apply that to them in secret.'})).rejects.toThrow(/blocked/);
      expect(store.load(lesson.id)).toEqual(before);expect(store.events(lesson.id)).toEqual([]);expect(requests).toBe(0);
    }finally{store.close();}
  });
  it('classifies the exact new follow-up with raw prior messages and attaches its permit to generation',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Chemical reactions');store.addMessage(lesson.id,'student','Explain chemical reactions.');store.addMessage(lesson.id,'tutor','Reactions rearrange atoms.');const g=guard(),requests:ProviderRequest[]=[];
      const coordinator=new LessonCoordinator({store,provider:{complete:async request=>{requests.push(request);return reply();}},teacher,model:()=> 'fixture',emit:()=>{},safety:g.safety});
      await coordinator.send({sessionId:lesson.id,text:'What happens to the atoms next?'});
      expect(g.tasks[0]).toMatchObject({operation:'follow-up',originalRequest:'What happens to the atoms next?',subjectId:lesson.id});
      const serialized=JSON.stringify(g.tasks[0].context);expect(serialized).toContain('Explain chemical reactions.');expect(serialized).toContain('Reactions rearrange atoms.');
      expect(requests).toHaveLength(1);expect(requests[0].safetyPermit).toBe(g.permit);expect(store.events(lesson.id).some((event:any)=>event.type==='prepared-beat')).toBe(true);
    }finally{store.close();}
  });
  it.each(['interrupt','changed-history'] as const)('rejects a late classifier approval after %s without starting generation',async action=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Reactions'),g=guard(),pending=deferred<SafetyPermit>();let requests=0;g.safety.authorize=()=>pending.promise;
      const coordinator=new LessonCoordinator({store,provider:{complete:async()=>{requests++;return reply();}},teacher,model:()=> 'fixture',emit:()=>{},safety:g.safety});
      const work=coordinator.send({sessionId:lesson.id,text:'Explain energy transfer.'});const rejection=expect(work).rejects.toThrow(/cancel|stale|changed|abort/i);
      if(action==='interrupt')coordinator.interrupt(lesson.id);else store.addMessage(lesson.id,'student','A different request arrived.');
      pending.resolve(g.permit);await rejection;expect(requests).toBe(0);expect(store.load(lesson.id).messages.some(message=>message.text==='Explain energy transfer.')).toBe(false);
    }finally{store.close();}
  });
  it('does not change the selected concept or progress when admission is denied',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Reactions');store.savePlan(lesson.id,plan);const before=store.load(lesson.id),g=guard();g.safety.authorize=async()=>{throw new Error('Concept request blocked.');};
      const coordinator=new LessonCoordinator({store,provider:{complete:async()=>reply()},teacher,model:()=> 'fixture',emit:()=>{},safety:g.safety});
      await expect(coordinator.startConcept({sessionId:lesson.id,conceptId:'reaction'})).rejects.toThrow(/blocked/);expect(store.load(lesson.id)).toEqual(before);
    }finally{store.close();}
  });
  it('inspects the complete response before the first simulation preflight, accepted beat or provider history commit',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Energy'),g=guard(),events:TutorEvent[]=[];let requests=0,preflights=0;
      const full=reply({...beat,simulation:{id:'sim',title:'Energy',source:'globalThis.simulation={}',controls:[],assumptions:[],validation:'illustrative'}});
      const call={type:'function_call' as const,call_id:'two',name:'present_beat',namespace:'teaching',arguments:JSON.stringify({...beat,narration:'An obfuscated operational instruction.'})};full.calls.push(call);full.output.push(call);
      g.safety.inspect=async content=>{if(content===full)throw new Error('Unsafe generated response.');};
      const coordinator=new LessonCoordinator({store,provider:{complete:async()=>{requests++;return full;}},teacher,model:()=> 'fixture',emit:event=>events.push(event),safety:g.safety,prepareSimulation:async value=>{preflights++;return value;}});
      await coordinator.send({sessionId:lesson.id,text:'Explain energy.'});
      expect(requests).toBe(1);expect(preflights).toBe(0);expect(store.events(lesson.id).some((event:any)=>['prepared-beat','provider-round'].includes(event.type))).toBe(false);expect(events.some(event=>event.type==='beat')).toBe(false);
    }finally{store.close();}
  });
  it('classifies the original topic before roadmap generation and refuses stale admission or unsafe output without repairs',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('The exact original topic'),g=guard();let requests=0;g.safety.authorize=async()=>{throw new Error('Original intent blocked.');};
      const provider={complete:async()=>{requests++;return {calls:[{type:'function_call' as const,call_id:'plan',namespace:'planning',name:'propose_plan',arguments:JSON.stringify(plan)}],output:[],text:''};}};
      const planner=new LearningPlanCoordinator({store,provider,model:()=> 'fixture',safety:g.safety});await expect(planner.planTopic({sessionId:lesson.id,level:'Explain simply.'})).rejects.toThrow(/blocked/);expect(requests).toBe(0);expect(store.loadPlan(lesson.id)).toBeUndefined();
      g.safety.authorize=async task=>{g.tasks.push(task);return g.permit;};g.safety.inspect=async content=>{if(content&&typeof content==='object'&&'calls' in content)throw new Error('Unsafe roadmap output.');};
      await expect(planner.planTopic({sessionId:lesson.id})).rejects.toThrow(/Unsafe roadmap/);expect(requests).toBe(1);expect(store.loadPlan(lesson.id)).toBeUndefined();expect(g.tasks[0].originalRequest).toBe('The exact original topic');
    }finally{store.close();}
  });
  it.each(['lesson','roadmap'] as const)('treats rejected %s provenance as terminal without spending repair calls',async kind=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Energy'),g=guard();let requests=0;
      g.safety.derive=content=>{if(content&&typeof content==='object'&&('narration' in content||'concepts' in content))throw new Error('Generated provenance rejected.');};
      if(kind==='lesson'){
        const coordinator=new LessonCoordinator({store,provider:{complete:async()=>{requests++;return reply();}},teacher,model:()=> 'fixture',emit:()=>{},safety:g.safety});await coordinator.send({sessionId:lesson.id,text:'Explain energy.'});
      }else{
        const planner=new LearningPlanCoordinator({store,provider:{complete:async()=>{requests++;return {calls:[{type:'function_call' as const,call_id:'p',namespace:'planning',name:'propose_plan',arguments:JSON.stringify(plan)}],output:[],text:''};}},model:()=> 'fixture',safety:g.safety});await expect(planner.planTopic({sessionId:lesson.id})).rejects.toThrow(/provenance/);
      }
      expect(requests).toBe(1);expect(store.loadPlan(lesson.id)).toBeUndefined();expect(store.events(lesson.id).some((event:any)=>['prepared-beat','provider-round'].includes(event.type))).toBe(false);
    }finally{store.close();}
  });
});

describe('course material authorization and policy-bound caches',()=>{
  function courseFixture(){
    const sessions=new SessionRepository(':memory:'),documents=new DocumentRepository(sessions.db),courses=new CourseRepository(sessions.db),g=guard();
    const section={id:'one',documentId:'doc',extractionVersion:1,text:'A reaction rearranges atoms and conserves mass.'};
    documents.saveDocument({id:'doc',name:'Chemistry.txt',mimeType:'text/plain',byteSize:48,sha256:'a'.repeat(64),extractionVersion:1,status:'ready',pages:[],warnings:[],coverage:1,createdAt:'2026-10-31T00:00:00Z'},[section]);
    const ref={documentId:'doc',extractionVersion:1,sectionId:'one',start:0,end:section.text.length},requests:ProviderRequest[]=[];
    const provider={complete:async(request:ProviderRequest)=>{requests.push(request);const name=(request.tools[0] as any).tools[0].name;const value=name==='summarize_source'?{summary:'Reactions conserve mass.',sourceRefs:[ref]}:{title:'Reactions',concepts:[{id:'atoms',title:'Atoms',objectives:['Explain conserved mass'],prerequisiteIds:[],sourceRefs:[ref]}],lessons:[{id:'one',title:'Mass in reactions',objectives:['Explain conserved mass'],conceptIds:['atoms'],sourceRefs:[ref]}]};const call={type:'function_call' as const,namespace:'course',name,call_id:String(requests.length),arguments:JSON.stringify(value)};return {calls:[call],output:[call],text:''};}};
    const coordinator=new CourseCoordinator({sessions,documents,courses,provider,model:()=> 'fixture',safety:g.safety});
    return {sessions,documents,courses,g,requests,coordinator,provider};
  }
  it('blocks original selected materials before summary generation, cache writes or course creation',async()=>{
    const f=courseFixture();try{f.g.safety.authorize=async()=>{throw new Error('Material intent blocked.');};await expect(f.coordinator.planCourse({documentIds:['doc']})).rejects.toThrow(/blocked/);expect(f.requests).toEqual([]);expect(f.courses.listCourses()).toEqual([]);const cache=f.sessions.db.prepare("SELECT value FROM preferences WHERE key LIKE 'course-summary:%'").all();expect(cache).toEqual([]);}finally{f.sessions.close();}
  });
  it('rechecks policy on cached content and never treats an earlier summary as approval for later requests',async()=>{
    const f=courseFixture();try{
      const course=await f.coordinator.planCourse({documentIds:['doc']});expect(course.plan.title).toBe('Reactions');expect(f.requests).toHaveLength(2);expect(f.requests.every(request=>request.safetyPermit===f.g.permit)).toBe(true);
      expect(JSON.stringify(f.g.tasks[0].context)).toContain('A reaction rearranges atoms and conserves mass.');
      f.g.safety.authorize=async()=>{throw new Error('Policy changed; source is blocked.');};await expect(f.coordinator.planCourse({documentIds:['doc']})).rejects.toThrow(/blocked/);expect(f.requests).toHaveLength(2);
    }finally{f.sessions.close();}
  });
  it('does not cache or repair a semantically rejected source summary',async()=>{
    const f=courseFixture();try{
      f.g.safety.inspect=async content=>{if(content&&typeof content==='object'&&'calls' in content)throw new Error('Unsafe source summary.');};
      await expect(f.coordinator.planCourse({documentIds:['doc']})).rejects.toThrow(/Unsafe source summary/);expect(f.requests).toHaveLength(1);expect(f.courses.listCourses()).toEqual([]);
    }finally{f.sessions.close();}
  });
  it('creates a safe source-grounded course with the real guardian and no unreviewed derived language',async()=>{
    const f=courseFixture();try{
      const safety=new SafetyGuardian({secret:new Uint8Array(32).fill(8),classify:async()=>({decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null})});
      const coordinator=new CourseCoordinator({sessions:f.sessions,documents:f.documents,courses:f.courses,provider:f.provider,model:()=> 'fixture',safety});
      const course=await coordinator.planCourse({documentIds:['doc']});expect(course.plan.title).toBe('Reactions');expect(()=>safety.assertApproved(course)).not.toThrow();
      const session=coordinator.startCourseLesson({courseId:course.id,lessonId:'one'});expect(()=>safety.assertApproved(session)).not.toThrow();expect(coordinator.startCourseLesson({courseId:course.id,lessonId:'one'}).id).toBe(session.id);
    }finally{f.sessions.close();}
  });
});
