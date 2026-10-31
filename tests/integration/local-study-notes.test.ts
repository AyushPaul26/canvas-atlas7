import {describe,it,expect,vi} from 'vitest';
import {lessonNotesRecordSchema,studyNotesDocumentSchema,providerIdSchema,type LessonSession} from '@living-canvas/protocol';
import {NotesCoordinator} from '../../apps/desktop/src/main/notes/notes-coordinator';

const lesson=():LessonSession=>({id:'local-lesson',title:'Gravity',topic:'Gravity',createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',messages:[{id:'heard',role:'tutor',text:'Mass attracts mass.',createdAt:'2026-10-31T00:01:00.000Z'},{id:'question',role:'student',text:'UNANSWERED_QUESTION',createdAt:'2026-10-31T00:02:00.000Z'}],beats:[{id:'heard',narration:'Mass attracts mass. UNHEARD_SUFFIX',canvas:{mode:'replace',entities:[{id:'mass',kind:'text',x:10,y:20,text:'Mass'}]}},{id:'future',narration:'UNHEARD_PREPARED',canvas:{mode:'replace',entities:[{id:'future',kind:'text',x:10,y:20,text:'UNHEARD_LABEL'}]}}],scene:[],controls:{}});
function setup(){const state={lesson:lesson()};const complete=vi.fn(async()=>{throw new Error('Offline notes must never invoke an AI service.');});const coordinator=new NotesCoordinator({sessions:{load:()=>structuredClone(state.lesson)},provider:{complete},model:()=>undefined,now:()=>new Date('2026-10-31T12:00:00.000Z'),createId:()=> 'ab84c5a1-d0e1-447f-b75b-309568fe4a70'});return {state,complete,coordinator};}

describe('explicit offline study record',()=>{
  it('creates a faithful local PDF document without credentials, model selection or inference',async()=>{
    const {coordinator,complete}=setup();const notes=await coordinator.generateLocal('local-lesson');
    expect(notes).toMatchObject({version:1,sessionId:'local-lesson',studiedSteps:1,createdAt:'2026-10-31T12:00:00.000Z',modelMetadata:{providerId:'local',requestedModel:'local-extract',completedAt:'2026-10-31T12:00:00.000Z'}});
    expect(notes.content.title).toMatch(/study record/i);expect(notes.content.overview).toMatch(/offline|no AI/i);
    expect(notes.content.sections).toMatchObject([{evidenceIds:['heard'],explanation:'Mass attracts mass.',keyPoints:[],definitions:[],equations:[],examples:[]}]);
    expect(notes.content.reviewQuestions).toEqual([]);expect(notes.visuals[0].entities[0].text).toBe('Mass');
    expect(JSON.stringify(notes)).not.toMatch(/UNANSWERED|UNHEARD/);expect(complete).not.toHaveBeenCalled();
    expect(studyNotesDocumentSchema.safeParse(notes).success).toBe(true);
    expect(lessonNotesRecordSchema.safeParse({id:notes.id,sessionId:notes.sessionId,title:notes.content.title,createdAt:notes.createdAt,studiedSteps:notes.studiedSteps,providerId:'local',requestedModel:'local-extract'}).success).toBe(true);
    expect(providerIdSchema.safeParse('local').success).toBe(false);
  });
  it('preserves every character of a long explanation across bounded sections',async()=>{
    const {state,coordinator,complete}=setup();const text='a'.repeat(9995)+' Important final qualification. '+'b'.repeat(9995)+' The final taught detail.';
    state.lesson.messages=[{...state.lesson.messages[0],text}];const notes=await coordinator.generateLocal('local-lesson');
    expect(notes.content.sections.length).toBeGreaterThan(1);expect(notes.content.sections.length).toBeLessThanOrEqual(16);
    expect(notes.content.sections.map(section=>section.explanation).join('')).toBe(text);
    expect(notes.content.sections.every(section=>section.explanation.length<=10000&&section.evidenceIds.includes('heard'))).toBe(true);expect(complete).not.toHaveBeenCalled();
  });
  it('retains all evidence when grouping many short explanations',async()=>{
    const {state,coordinator}=setup();state.lesson.beats=[];
    state.lesson.messages=Array.from({length:201},(_,index)=>({id:`heard-${index}`,role:'tutor',text:`Exact taught passage ${index}.`,createdAt:'2026-10-31T00:00:00.000Z'}));
    const notes=await coordinator.generateLocal('local-lesson');
    const ids=notes.content.sections.flatMap(section=>section.evidenceIds);expect(new Set(ids).size).toBe(201);
    expect(notes.content.sections.every(section=>section.evidenceIds.length<=100)).toBe(true);
    for(let index=0;index<201;index++)expect(notes.content.sections.some(section=>section.explanation.includes(`Exact taught passage ${index}.`))).toBe(true);
  });
  it('keeps an emoji intact when an explanation crosses the section character boundary',async()=>{
    const {state,coordinator}=setup();const text='a'.repeat(9999)+'🪐 completes this taught idea.';
    state.lesson.messages=[{...state.lesson.messages[0],text}];const notes=await coordinator.generateLocal('local-lesson');
    expect(notes.content.sections.map(section=>section.explanation).join('')).toBe(text);
    expect(notes.content.sections[0].explanation).toBe('a'.repeat(9999));expect(notes.content.sections[1].explanation).toBe('🪐 completes this taught idea.');
  });
  it('starts a new section when the remaining single character cannot hold the next emoji',async()=>{
    const {state,coordinator}=setup();state.lesson.messages=[{...state.lesson.messages[0],text:'a'.repeat(9997)},{...state.lesson.messages[0],id:'heard-next',text:'🪐 Orbit.'}];
    const notes=await coordinator.generateLocal('local-lesson');
    expect(notes.content.sections[0]).toMatchObject({evidenceIds:['heard'],explanation:'a'.repeat(9997)});
    expect(notes.content.sections[1]).toMatchObject({evidenceIds:['heard-next'],explanation:'🪐 Orbit.'});
  });
  it('truncates a long study-record title before an emoji instead of writing half of it',async()=>{
    const {state,coordinator}=setup();state.lesson.topic='k'.repeat(224)+'🪐 final topic';
    const notes=await coordinator.generateLocal('local-lesson');
    expect(notes.content.title).toBe('Study record · '+'k'.repeat(224));expect(notes.topic).toBe(state.lesson.topic);
  });
  it('rejects empty, oversized and pre-cancelled study records without requesting a model',async()=>{
    const {state,coordinator,complete}=setup();state.lesson.messages=[];
    await expect(coordinator.generateLocal('local-lesson')).rejects.toThrow(/study|presented/i);
    state.lesson=lesson();state.lesson.messages[0].text='文'.repeat(45_000);
    await expect(coordinator.generateLocal('local-lesson')).rejects.toThrow(/too long|limit/i);
    const controller=new AbortController();controller.abort(new Error('Canceled offline notes.'));
    await expect(coordinator.generateLocal('local-lesson',controller.signal)).rejects.toThrow(/cancel/i);expect(complete).not.toHaveBeenCalled();
  });
  it('applies the saved-content guard before copying an unsafe passage into offline notes',async()=>{
    const {state,coordinator,complete}=setup();state.lesson.messages[0].text='explicit sexual roleplay';
    await expect(coordinator.generateLocal('local-lesson')).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED',surface:'saved-content'});expect(complete).not.toHaveBeenCalled();
  });
});
