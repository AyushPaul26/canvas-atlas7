import {describe,it,expect} from 'vitest';
import {studyNotesDraftSchema,studyNotesDocumentSchema,lessonNotesRecordSchema} from '@living-canvas/protocol';

const content={title:'Earth’s yearly journey',overview:'Notes from the explanation you heard.',sections:[{title:'Revolution',evidenceIds:['heard-1'],explanation:'Earth travels around the Sun in about one year.',keyPoints:['One orbit takes about a year.'],definitions:[{term:'Revolution',meaning:'Travel around another body.'}],equations:[{latex:'T\\approx 1\\text{ year}',explanation:'T is the orbital period.'}],examples:[{title:'A quarter orbit',explanation:'About three months corresponds to a quarter of a year.'}]}],recap:['Revolution and rotation describe different motions.'],reviewQuestions:[{question:'What does revolution describe?',answer:'Motion around another body.',evidenceIds:['heard-1']}]};
const document={version:1,id:'ab84c5a1-d0e1-447f-b75b-309568fe4a70',sessionId:'lesson-1',topic:'Earth around the Sun',createdAt:'2026-10-31T12:00:00.000Z',coverageHash:'a'.repeat(64),studiedSteps:1,content,visuals:[{evidenceId:'heard-1',title:'Your orbit diagram',entities:[{id:'sun',kind:'circle',x:100,y:100,radius:20,fill:'#D78A64'}]}],modelMetadata:{providerId:'gemini',requestedModel:'gemini-3.5-flash-lite',servedModel:'gemini-3.5-flash-lite',completedAt:'2026-10-31T12:00:00.000Z'}};
describe('lesson notes contracts',()=>{
  it('accepts bounded structured multilingual notes and printable presented diagrams',()=>{
    expect(studyNotesDraftSchema.parse(content).sections[0].evidenceIds).toEqual(['heard-1']);
    expect(studyNotesDocumentSchema.parse(document).visuals[0].entities[0].kind).toBe('circle');
    expect(studyNotesDraftSchema.parse({...content,title:'पृथ्वी की गति — Earth’s journey'}).title).toContain('पृथ्वी');
  });
  it('rejects uncited sections, duplicate evidence, empty study and oversized content',()=>{
    for(const section of [{...content.sections[0],evidenceIds:[]},{...content.sections[0],evidenceIds:['heard-1','heard-1']},{...content.sections[0],explanation:'x'.repeat(10001)}])expect(studyNotesDraftSchema.safeParse({...content,sections:[section]}).success).toBe(false);
    expect(studyNotesDocumentSchema.safeParse({...document,studiedSteps:0}).success).toBe(false);
    expect(studyNotesDraftSchema.safeParse({...content,sections:Array.from({length:17},()=>content.sections[0])}).success).toBe(false);
  });
  it('does not accept executable artifact fields, arbitrary paths or malformed IDs',()=>{
    expect(studyNotesDraftSchema.safeParse({...content,html:'<script>bad()</script>'}).success).toBe(false);
    expect(studyNotesDocumentSchema.safeParse({...document,id:'../escape'}).success).toBe(false);
    expect(studyNotesDocumentSchema.safeParse({...document,pdfPath:'C:/secret'}).success).toBe(false);
    const {id,sessionId,title,createdAt,studiedSteps,providerId,requestedModel}={...document,...document.modelMetadata,title:content.title};
    const record={id,sessionId,title,createdAt,studiedSteps,providerId,requestedModel};
    expect(lessonNotesRecordSchema.parse(record)).toEqual(record);
    expect(lessonNotesRecordSchema.safeParse({...record,key:'secret'}).success).toBe(false);
  });
});
