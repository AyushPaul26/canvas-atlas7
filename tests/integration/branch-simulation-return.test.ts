import {mkdtempSync,readdirSync,rmdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {LessonCoordinator} from '../../apps/desktop/src/main/ai/lesson-coordinator';
import * as teacher from '../../packages/teacher/src/index';
import type {PlaybackCheckpoint,SimulationCheckpoint} from '@living-canvas/protocol';

const experiment=(id:string,value:number):SimulationCheckpoint=>({artifact:{id,title:id,source:'globalThis.simulation = {};',controls:[{id:'strength',label:'Strength',type:'slider',value,min:0,max:10}],assumptions:[],validation:'illustrative'},state:{position:value},tick:4,values:{strength:value},initialValues:{strength:value},inputs:[]});
it.each([false,true])('restores explicit experiment presence for an original append beat after branch return and disk reopen (inherited=%s)',inherited=>{
  const directory=mkdtempSync(join(tmpdir(),'canvas-branch-return-')),path=join(directory,'lessons.sqlite');
  let store=new SessionRepository(path);
  try{
    const session=store.create('Gravity');store.savePlan(session.id,{id:'plan',version:1,title:'Gravity',sourceDocumentIds:[],concepts:[{id:'concept',title:'Gravity',objectives:['Explain'],prerequisiteIds:[],sourceRefs:[]}]});
    const beat={id:'original',conceptId:'concept',narration:'Static continuation.',chunks:[{id:'chunk',text:'Static continuation.'}],cues:[],next:'continue' as const,canvas:{mode:'append' as const,entities:[]}};
    store.commitBeat(session.id,beat,[]);
    const original=inherited?experiment('inherited-original',3):undefined;
    const checkpoint:PlaybackCheckpoint={cursor:{beatId:beat.id,chunkId:'chunk',offsetSeconds:.2,passId:'pass'},completedChunkIds:[],appliedCueIds:[],baselineScene:[],visibleScene:[],...(original?{simulation:original}:{})};
    store.saveBranchPlayback(session.id,{checkpoint,progress:store.loadLearningProgress(session.id)!});
    const branch=experiment('branch-experiment',7);store.saveScene(session.id,[],branch.values,branch);
    // Ordinary scene-only saves must keep the current runtime checkpoint.
    store.saveScene(session.id,[]);expect(store.load(session.id).simulation).toEqual(branch);
    const coordinator=new LessonCoordinator({store,teacher,model:()=> 'model',emit:()=>{},provider:{complete:async()=>{throw new Error('Return must use the saved explanation');}}});
    const restored=coordinator.returnToLesson({sessionId:session.id});
    expect(restored.checkpoint.simulation).toEqual(original);expect(store.load(session.id).simulation).toEqual(original);expect(store.load(session.id).controls).toEqual(original?.values??{});
    store.close();store=new SessionRepository(path);
    expect(store.load(session.id).simulation).toEqual(original);expect(store.load(session.id).controls).toEqual(original?.values??{});
  }finally{
    store.close();for(const file of readdirSync(directory))unlinkSync(join(directory,file));rmdirSync(directory);
  }
});
