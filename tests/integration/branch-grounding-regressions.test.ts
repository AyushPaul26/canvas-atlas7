import { describe, expect, it } from 'vitest';
import { LessonCoordinator } from '../../apps/desktop/src/main/ai/lesson-coordinator';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';
import { SourceIndex } from '../../apps/desktop/src/main/documents/source-index';
import * as teacher from '../../packages/teacher/src/index';
import type { LearningPlan, PlaybackCheckpoint, TutorEvent } from '@living-canvas/protocol';

const plan: LearningPlan = { id:'plan',version:1,title:'Gravity',sourceDocumentIds:[],concepts:['a','b'].map(id=>({id,title:id,objectives:['Explain'],prerequisiteIds:[],sourceRefs:[]})) };
const fixture = () => {
  const store = new SessionRepository(':memory:'), session=store.create('Gravity'),events:TutorEvent[]=[];
  store.savePlan(session.id,plan); let next:'continue'|'ask'|'finish'='continue';
  const coordinator = new LessonCoordinator({store,teacher,model:()=> 'model',emit:event=>events.push(event),provider:{complete:async()=>({text:'',output:[],calls:[{type:'function_call',namespace:'teaching',name:'present_beat',call_id:'call',arguments:JSON.stringify({conceptId:store.loadLearningProgress(session.id)?.activeConceptId,narration:'Masses attract.',chunks:[{id:'chunk',text:'Masses attract.'}],cues:[],next,question:next==='ask'?'Why?':undefined,canvas:{mode:'replace',entities:[]}})}]})}});
  const latest=()=>events.filter(event=>event.type==='beat').at(-1) as Extract<TutorEvent,{type:'beat'}>;
  const checkpoint=(event=latest(),complete=false):PlaybackCheckpoint=>({cursor:{beatId:event.beat.id,chunkId:'chunk',offsetSeconds:.5,passId:'pass'},completedChunkIds:complete?['chunk']:[],appliedCueIds:[],baselineScene:[],visibleScene:[],...(complete?{receipt:{beatId:event.beat.id,planId:'plan',planVersion:1,passId:'pass',completedChunkIds:['chunk'],appliedCueIds:[],audioResult:'completed' as const,visualComplete:true}}:{})});
  const finish=()=>{const event=latest();coordinator.savePlayback({sessionId:session.id,epoch:event.epoch,checkpoint:checkpoint(event,true)});coordinator.presentProgress({sessionId:session.id,epoch:event.epoch,beatId:event.beat.id,scene:[],narration:event.beat.narration,complete:true});};
  return {store,session,coordinator,latest,checkpoint,finish,setNext:(value:typeof next)=>{next=value;}};
};
describe('reviewed branch and grounding regressions',()=>{
  it('finishes a branch without awarding original coverage and restores its first durable checkpoint after nested questions',async()=>{
    const f=fixture();try{
      await f.coordinator.startConcept({sessionId:f.session.id,conceptId:'a'});const original=f.checkpoint();
      f.coordinator.savePlayback({sessionId:f.session.id,epoch:f.latest().epoch,checkpoint:original});f.setNext('finish');
      await f.coordinator.send({sessionId:f.session.id,text:'Why?'});f.finish();
      expect(f.store.loadLearningProgress(f.session.id)?.conceptStates).toEqual({a:'teaching',b:'planned'});
      await f.coordinator.continueLesson({sessionId:f.session.id,epoch:f.latest().epoch});
      await f.coordinator.send({sessionId:f.session.id,text:'Another question'});f.finish();
      const restarted=new LessonCoordinator({store:f.store,teacher,provider:{complete:async()=>{throw new Error('Return must use accepted content');}},model:()=> 'model',emit:()=>{}});
      const restored=restarted.returnToLesson({sessionId:f.session.id});
      expect(restored.checkpoint.cursor).toEqual(original.cursor);expect(restored.beat.id).toBe(original.cursor.beatId);expect(restored.mode).toBe('resume');
      expect(f.store.loadLearningProgress(f.session.id)?.branchReturnPoint).toBeUndefined();expect(f.store.getPreference(`branch-playback:${f.session.id}`)).toBeUndefined();
    }finally{f.store.close();}
  });
  it('retains structured check responses through replacements and concept transitions without passive mastery',async()=>{
    const f=fixture();try{
      f.setNext('ask');await f.coordinator.startConcept({sessionId:f.session.id,conceptId:'a'});f.finish();
      expect(f.store.readLearnerEvidence(f.session.id)).toEqual([]);
      await f.coordinator.send({sessionId:f.session.id,text:'More mass increases force'});f.finish();
      await f.coordinator.send({sessionId:f.session.id,text:'Help me understand'});f.finish();
      f.setNext('finish');await f.coordinator.send({sessionId:f.session.id,text:'Skip this understanding check and continue.'});f.finish();
      await f.coordinator.continueLesson({sessionId:f.session.id,epoch:f.latest().epoch});
      const reopened=new SessionRepository(f.store.db),records=reopened.readLearnerEvidence(f.session.id);expect(records.map(item=>item.kind)).toEqual(['answered','help-requested','skipped']);expect(records.every(item=>item.conceptId==='a'&&item.question==='Why?')).toBe(true);
      expect(reopened.loadLearningProgress(f.session.id)?.activeConceptId).toBe('b');
      expect(f.store.loadLearningProgress(f.session.id)?.branchReturnPoint).toBeUndefined();
    }finally{f.store.close();}
  });
  it('returns a fully acknowledged original as read-only replay without advancing its unfinished concept',async()=>{
    const f=fixture();try{
      await f.coordinator.startConcept({sessionId:f.session.id,conceptId:'a'});f.finish();const original=f.store.loadPlayback(f.session.id)!;
      f.setNext('finish');await f.coordinator.send({sessionId:f.session.id,text:'A quick question'});f.finish();
      const returned=f.coordinator.returnToLesson({sessionId:f.session.id});expect(returned.mode).toBe('replay');expect(returned.checkpoint.cursor).toEqual(original.cursor);
      f.coordinator.presentProgress({sessionId:f.session.id,epoch:returned.epoch,beatId:returned.beat.id,scene:[],narration:returned.beat.narration,complete:true});
      await f.coordinator.continueLesson({sessionId:f.session.id,epoch:returned.epoch});expect(f.store.loadLearningProgress(f.session.id)?.conceptStates).toEqual({a:'teaching',b:'planned'});
    }finally{f.store.close();}
  });
  it('retrieves query matches deep inside a section and fits UTF-8 budgets without splitting surrogate pairs',()=>{
    const index=new SourceIndex();const text='开'.repeat(30000)+'😀 deepneedle example '+'结'.repeat(10000);
    index.replace([{id:'section',documentId:'doc',extractionVersion:1,text}]);
    const evidence=index.retrieveEvidence({documentIds:['doc'],query:'deepneedle'},2000);
    expect(evidence.some(item=>item.text.includes('deepneedle'))).toBe(true);expect(new TextEncoder().encode(JSON.stringify(evidence)).byteLength).toBeLessThanOrEqual(2000);
    for(const item of evidence){expect(item.text).toBe(text.slice(item.ref.start,item.ref.end));expect(item.ref.start).toBeGreaterThan(12000);expect(item.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);}
    expect(index.retrieveEvidence({documentIds:['doc'],query:'absentterm'})).toEqual([]);
  });
  it('retains the active concept excerpt while retrieving a deep follow-up match in that same section',()=>{
    const index=new SourceIndex(),text='Gravity '+ 'opening material '.repeat(2200)+' deepneedle example '+ 'ending '.repeat(2000);
    const ref={documentId:'doc',extractionVersion:1,sectionId:'section',start:0,end:text.length};index.replace([{id:'section',documentId:'doc',extractionVersion:1,text}]);
    const evidence=index.retrieveEvidence({documentIds:['doc'],query:'Gravity deepneedle',sourceRefs:[ref]});
    expect(evidence[0].ref.start).toBe(0);expect(evidence.some(item=>item.text.includes('deepneedle'))).toBe(true);
  });
});
