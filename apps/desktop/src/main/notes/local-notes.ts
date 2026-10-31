import {NOTES_LIMITS,studyNotesDraftSchema,type StudyNotesDraft} from '@living-canvas/protocol';
import type {StudiedContent} from './studied-content';

/** Compile-time app copy, never an approval of learner/provider/source content. */
export const LOCAL_NOTES_SCAFFOLD=Object.freeze([
  'Study record','Studied explanations','Offline study record of 0 presented explanation. The passages below are copied from your saved lesson. No AI analysis or additional facts were added.',
  'Offline study record of 0 presented explanations. The passages below are copied from your saved lesson. No AI analysis or additional facts were added.',
  'This record includes all 0 presented explanation saved at this point.','This record includes all 0 presented explanations saved at this point.',
  'local','local-extract',
]);

/** Respect UTF-16 schema limits while keeping every Unicode code point whole. */
function boundedSlice(text:string,start:number,length:number):string{
  let end=Math.min(text.length,start+length);
  if(end<text.length&&end>start&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  return text.slice(start,end);
}

/** Explicit offline mode copies saved explanations. It neither summarizes nor
 * invents teaching content, examples, definitions, equations or review answers. */
export function localStudyRecord(snapshot:StudiedContent):StudyNotesDraft{
  const sections:StudyNotesDraft['sections']=[];
  let current:StudyNotesDraft['sections'][number]|undefined;
  const finish=()=>{
    if(!current)return;
    if(sections.length>=NOTES_LIMITS.sections)throw new Error('This study record is too long for one PDF. No studied explanations were omitted.');
    sections.push(current);current=undefined;
  };
  const start=()=>current={title:`Studied explanations · ${sections.length+1}`,evidenceIds:[],explanation:'',keyPoints:[],definitions:[],equations:[],examples:[]};
  for(const explanation of snapshot.explanations){
    const text=explanation.text.trim();let offset=0;
    while(offset<text.length){
      const section=current??start();
      if(!section.evidenceIds.includes(explanation.id)&&section.evidenceIds.length>=100){finish();continue;}
      const separator=section.explanation?'\n\n':'',room=10000-section.explanation.length-separator.length;
      if(room<=0){finish();continue;}
      const part=boundedSlice(text,offset,room);
      if(!part){finish();continue;}
      section.explanation+=separator+part;
      if(!section.evidenceIds.includes(explanation.id))section.evidenceIds.push(explanation.id);
      offset+=part.length;if(offset<text.length)finish();
    }
  }
  finish();
  return studyNotesDraftSchema.parse({
    title:boundedSlice(`Study record · ${snapshot.topic}`,0,240),
    overview:`Offline study record of ${snapshot.studiedSteps} presented ${snapshot.studiedSteps===1?'explanation':'explanations'}. The passages below are copied from your saved lesson. No AI analysis or additional facts were added.`,
    sections,recap:[`This record includes all ${snapshot.studiedSteps} presented ${snapshot.studiedSteps===1?'explanation':'explanations'} saved at this point.`],reviewQuestions:[],
  });
}
