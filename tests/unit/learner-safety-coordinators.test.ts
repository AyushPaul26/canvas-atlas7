import {describe,it,expect,vi} from 'vitest';
import {CourseCoordinator} from '../../apps/desktop/src/main/ai/course-coordinator';
import {LessonCoordinator} from '../../apps/desktop/src/main/ai/lesson-coordinator';
import {completeTeaching} from '../../apps/desktop/src/main/ai/provider-contract';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {LearnerSafetyError} from '../../packages/teacher/src/learner-safety';

const unsafe='Generate explicit sexual roleplay.';
describe('terminal safety at coordinator boundaries',()=>{
  it('does not retry a simulation rejected by runtime safety during preflight',async()=>{
    const store=new SessionRepository(':memory:');try{
      const lesson=store.create('Earth'),events:any[]=[];
      const beat={narration:'A safe orbit explanation.',next:'ask',canvas:{mode:'replace',entities:[]},simulation:{id:'orbit',title:'Orbit',source:'globalThis.simulation={}',controls:[],assumptions:[],validation:'illustrative'}};
      const call={type:'function_call',namespace:'teaching',name:'present_beat',call_id:'orbit-call',arguments:JSON.stringify(beat)};
      const provider={complete:vi.fn(async()=>({calls:[call],output:[call],text:''}))};
      const teacher={buildTeacherInstructions:()=>'',buildLessonContext:()=>'',getTeachingToolParameters:()=>({}),parseTeachingBeat:(value:any)=>value};
      const coordinator=new LessonCoordinator({store,provider,teacher,model:()=> 'fixture',emit:(event:any)=>events.push(event),prepareSimulation:async()=>{throw new LearnerSafetyError('simulation-frame');}} as any);
      await coordinator.send({sessionId:lesson.id,text:'Explain Earth’s orbit.'});
      expect(provider.complete).toHaveBeenCalledTimes(1);expect(store.providerHistory(lesson.id)).toEqual([]);expect(events.some(event=>event.type==='beat')).toBe(false);
      expect(events.find(event=>event.type==='error')?.message).toMatch(/age-appropriate/);
    }finally{store.close();}
  });
  it('rejects input before recording learning evidence or the student message',async()=>{
    const store={loadLearningProgress:vi.fn(),addMessage:vi.fn()},provider={complete:vi.fn()};
    const coordinator=new LessonCoordinator({store,provider} as any);
    await expect(coordinator.send({sessionId:'lesson',text:unsafe})).rejects.toThrow(/age-appropriate/);
    expect(store.loadLearningProgress).not.toHaveBeenCalled();expect(store.addMessage).not.toHaveBeenCalled();expect(provider.complete).not.toHaveBeenCalled();
  });
  it('rejects an entire mixed response without returning its first safe call or retrying',async()=>{
    const calls=[{type:'function_call',namespace:'teaching',name:'present_beat',call_id:'safe',arguments:JSON.stringify({narration:'Earth revolves around the Sun.'})},{type:'function_call',namespace:'teaching',name:'present_beat',call_id:'unsafe',arguments:JSON.stringify({narration:unsafe})}];
    const provider={complete:vi.fn(async()=>({calls,output:calls,text:''}))};
    await expect(completeTeaching(provider as any,{model:'fixture',instructions:'Teach',input:[{role:'user',content:'Earth'}],tools:[]},new AbortController().signal)).rejects.toThrow(/age-appropriate/);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it('checks a saved linked course session before returning it to the renderer',()=>{
    const course={plan:{concepts:[]},lessons:[{id:'lesson',sessionId:'linked',conceptIds:[]}],progress:{conceptStates:{}}};
    const coordinator=new CourseCoordinator({courses:{loadCourse:()=>course},sessions:{loadLearningProgress:()=>undefined,load:()=>({topic:'Biology',messages:[{text:unsafe}]})}} as any);
    expect(()=>coordinator.startCourseLesson({courseId:'course',lessonId:'lesson'})).toThrow(/age-appropriate/);
  });
});
