import {describe,it,expect,vi} from 'vitest';
import * as protocol from '@living-canvas/protocol';
import type {LessonSession} from '@living-canvas/protocol';
import {buildStudiedContent,studiedNotesInput} from '../../apps/desktop/src/main/notes/studied-content';

const lesson=():LessonSession=>({
  id:'lesson-one',title:'Gravity',topic:'Gravity',createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',controls:{},scene:[],
  messages:[
    {id:'question-one',role:'student',text:'Explain gravity',createdAt:'2026-10-31T00:00:00.000Z'},
    {id:'heard-one',role:'tutor',text:'Mass attracts mass.',createdAt:'2026-10-31T00:01:00.000Z'},
    {id:'unanswered',role:'student',text:'UNANSWERED_FUTURE_TOPIC',createdAt:'2026-10-31T00:02:00.000Z'},
  ],
  beats:[
    {id:'heard-one',title:'UNSPOKEN_TITLE',narration:'Mass attracts mass. UNSPOKEN_FUTURE_SUFFIX',question:'UNSPOKEN_CHECK',next:'continue',canvas:{mode:'replace',entities:[{id:'mass',kind:'text',x:20,y:30,text:'Mass'}]},simulation:{id:'future',title:'UNSPOKEN_PROGRAM_TITLE',source:'UNSPOKEN_SOURCE',controls:[],assumptions:[],validation:'illustrative'}},
    {id:'prepared-only',narration:'UNHEARD_PREPARED',canvas:{mode:'replace',entities:[{id:'future-diagram',kind:'text',x:20,y:30,text:'UNHEARD_LABEL'}]}},
  ],
  plan:{id:'plan',version:1,title:'UNSEEN_ROADMAP',sourceDocumentIds:['UNSEEN_DOCUMENT'],concepts:[{id:'future',title:'UNSEEN_CONCEPT',objectives:['UNSEEN_OBJECTIVE'],prerequisiteIds:[],sourceRefs:[]}]},
});

describe('studied notes snapshot',()=>{
  it('uses persisted tutor prefixes and only their matching presented visuals',()=>{
    const snapshot=buildStudiedContent(lesson());
    expect(snapshot.explanations).toEqual([{id:'heard-one',text:'Mass attracts mass.'}]);
    expect(snapshot.learnerQuestions).toEqual([{text:'Explain gravity'}]);
    expect(snapshot.studiedSteps).toBe(1);expect(snapshot.visuals).toHaveLength(1);
    expect(snapshot.visuals[0]).toMatchObject({evidenceId:'heard-one',entities:[{id:'mass',text:'Mass'}]});
    expect(studiedNotesInput(snapshot)).toMatchObject({explanations:[{id:'heard-one',text:'Mass attracts mass.'}],visuals:[{evidenceId:'heard-one',labels:['Mass']}]});
    expect(JSON.stringify(snapshot)).not.toMatch(/UNSPOKEN|UNHEARD|UNSEEN|UNANSWERED/);
  });
  it('rejects an unstudied lesson even if complete prepared beats and a plan exist',()=>{
    const source=lesson();source.messages=source.messages.filter(message=>message.role==='student');
    expect(()=>buildStudiedContent(source)).toThrow(/study|presented|explanation/i);
  });
  it('keeps all studied text or fails explicitly instead of truncating it',()=>{
    const source=lesson();source.messages[1].text='é'.repeat(70_000);
    expect(()=>buildStudiedContent(source)).toThrow(/too long|size|limit/i);
  });
  it('rejects more evidence IDs than the bounded notes sections can cover before requesting a model',()=>{
    const source=lesson();source.beats=[];
    source.messages=Array.from({length:1601},(_,index)=>({id:`heard-${index}`,role:'tutor' as const,text:'Studied.',createdAt:'2026-10-31T00:00:00.000Z'}));
    expect(()=>buildStudiedContent(source)).toThrow(/limit/i);
  });
  it('changes coverage only when studied evidence or its selected diagram changes',()=>{
    const original=lesson(),snapshot=buildStudiedContent(original);
    expect(buildStudiedContent(structuredClone(original)).coverageHash).toBe(snapshot.coverageHash);
    original.plan!.concepts[0].title='A different unstudied title';original.beats[1].narration='Another unpresented beat';
    expect(buildStudiedContent(original).coverageHash).toBe(snapshot.coverageHash);
    original.messages[1].text+=' Gravity acts across distance.';
    expect(buildStudiedContent(original).coverageHash).not.toBe(snapshot.coverageHash);
  });
  it('supports legacy presented tutor messages without claiming a matching diagram',()=>{
    const source=lesson();source.beats=[];
    expect(buildStudiedContent(source)).toMatchObject({studiedSteps:1,visuals:[],explanations:[{id:'heard-one',text:'Mass attracts mass.'}]});
  });
  it('selects no more than six representative studied diagrams without removing explanations',()=>{
    const source=lesson();source.messages=[];source.beats=[];
    for(let i=0;i<12;i++){
      source.messages.push({id:`heard-${i}`,role:'tutor',text:`Studied explanation ${i}.`,createdAt:'2026-10-31T00:00:00.000Z'});
      source.beats.push({id:`heard-${i}`,narration:`Studied explanation ${i}.`,canvas:{mode:'replace',entities:[{id:`label-${i}`,kind:'text',x:10,y:10,text:`Diagram ${i}`}]}});
    }
    const snapshot=buildStudiedContent(source);expect(snapshot.explanations).toHaveLength(12);expect(snapshot.visuals).toHaveLength(6);
    expect(snapshot.visuals[0].evidenceId).toBe('heard-0');expect(snapshot.visuals.at(-1)!.evidenceId).toBe('heard-11');
  });
  it('clones only the selected six boards in a long studied lesson',()=>{
    const source=lesson();source.messages=[];source.beats=[];
    for(let i=0;i<100;i++){
      source.messages.push({id:`heard-${i}`,role:'tutor',text:`Studied explanation ${i}.`,createdAt:'2026-10-31T00:00:00.000Z'});
      source.beats.push({id:`heard-${i}`,narration:`Studied explanation ${i}.`,canvas:{mode:'replace',entities:[{id:`plot-${i}`,kind:'plot',x:10,y:10,points:Array.from({length:1000},(_,index)=>index+i)}]}});
    }
    const parse=vi.spyOn(protocol,'parseScene');
    try{
      const snapshot=buildStudiedContent(source);
      expect(snapshot.explanations).toHaveLength(100);
      expect(snapshot.visuals).toHaveLength(6);
      // Cloning every historical board first would make retained memory grow
      // with the entire lesson rather than the bounded PDF selection.
      expect(parse).toHaveBeenCalledTimes(6);
      expect(snapshot.visuals[0].entities).not.toBe(source.beats[0].canvas.entities);
      expect(snapshot.visuals.at(-1)!.evidenceId).toBe('heard-99');
    }finally{parse.mockRestore();}
  });
  it('deduplicates equal visible boards regardless of entity property insertion order',()=>{
    const source=lesson();
    source.messages.push({id:'heard-two',role:'tutor',text:'Still the same diagram.',createdAt:'2026-10-31T00:03:00.000Z'});
    source.beats.push({id:'heard-two',narration:'Still the same diagram.',canvas:{mode:'replace',entities:[{text:'Mass',y:30,x:20,kind:'text',id:'mass'}]}});
    expect(buildStudiedContent(source).visuals).toHaveLength(1);
  });
});
