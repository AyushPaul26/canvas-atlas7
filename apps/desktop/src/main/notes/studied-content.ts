import {createHash} from 'node:crypto';
import {contractIdSchema,LIMITS,NOTES_LIMITS,parseScene,sceneEntitySchema,type LessonSession,type NotesVisual,type SceneEntity} from '@living-canvas/protocol';

export type StudiedContent={
  topic:string;
  explanations:Array<{id:string;text:string}>;
  learnerQuestions:Array<{text:string}>;
  visuals:NotesVisual[];
  coverageHash:string;
  studiedSteps:number;
};

/** Provider context contains heard text and labels from selected visible diagrams.
 * Geometry remains local for PDF rendering; no accepted beat/program/history is read. */
export function studiedNotesInput(snapshot:StudiedContent){
  return {
    topic:snapshot.topic,
    explanations:snapshot.explanations,
    learnerQuestions:snapshot.learnerQuestions,
    visuals:snapshot.visuals.map(visual=>({evidenceId:visual.evidenceId,labels:visual.entities.flatMap(entity=>[entity.text,entity.label].filter((value):value is string=>!!value?.trim()))})),
  };
}

const sceneFields=Object.keys(sceneEntitySchema.shape) as Array<keyof SceneEntity>;
const sceneFieldNames=new Set<string>(sceneFields);

/** Keep only fixed-size fingerprints for historical boards. Serializing one
 * bounded entity at a time avoids retaining copies of every studied scene. */
function sceneFingerprint(entities:SceneEntity[]){
  if(entities.length>LIMITS.entities)throw new Error('The studied diagram exceeds the scene entity limit.');
  const hash=createHash('sha256').update('[');let bytes=2,points=0;
  for(const [index,entity] of entities.entries()){
    for(const [key,value] of Object.entries(entity)){
      if(!sceneFieldNames.has(key))throw new Error('The studied diagram contains an invalid entity field.');
      if(key==='points'){
        if(value===undefined)continue;
        if(!Array.isArray(value)||(points+=value.length)>LIMITS.points||value.some(point=>typeof point!=='number'||!Number.isFinite(point)||Math.abs(point)>1_000_000))throw new Error('The studied diagram exceeds its path sample limit.');
      }else if(value!==undefined&&!(typeof value==='string'&&value.length<=LIMITS.labelChars)&&!(typeof value==='number'&&Number.isFinite(value)))throw new Error('The studied diagram contains an invalid entity value.');
    }
    // Schema field order preserves deduplication for equivalent persisted
    // entities with different property insertion order, without cloning points.
    const serialized=JSON.stringify(Object.fromEntries(sceneFields.filter(key=>entity[key]!==undefined).map(key=>[key,entity[key]])));
    bytes+=Buffer.byteLength(serialized,'utf8')+(index?1:0);
    if(bytes>LIMITS.sceneBytes)throw new Error('The studied diagram exceeds the scene size limit.');
    if(index)hash.update(',');hash.update(serialized);
  }
  return {key:hash.update(']').digest('hex'),bytes};
}

export function buildStudiedContent(session:LessonSession):StudiedContent{
  const explanations:Array<{id:string;text:string}>=[];
  const positions=new Map<string,number>();let lastTutorIndex=-1;
  for(const [index,message] of session.messages.entries()){
    if(message.role!=='tutor'||!message.text.trim())continue;
    const id=contractIdSchema.parse(message.id),existing=positions.get(id);
    const explanation={id,text:message.text};
    if(existing===undefined){positions.set(id,explanations.length);explanations.push(explanation);}else explanations[existing]=explanation;
    lastTutorIndex=index;
  }
  if(!explanations.length)throw new Error('Study part of this lesson before generating notes. At least one presented explanation is needed.');
  // Each bounded section can cite at most100IDs. Reject an impossible request
  // locally rather than spending quota or silently dropping studied evidence.
  if(explanations.length>NOTES_LIMITS.sections*100)throw new Error('This lesson exceeds the study notes evidence limit. No studied explanations were omitted.');
  const candidates:Array<NotesVisual&{bytes:number}>=[];
  const seenScenes=new Set<string>();
  for(const explanation of explanations){
    const beat=session.beats.find(item=>item.id===explanation.id);
    if(!beat?.canvas.entities.length)continue;
    const entities=beat.canvas.entities,{key,bytes}=sceneFingerprint(entities);
    if(seenScenes.has(key))continue;seenScenes.add(key);
    // The accepted title/question/full narration may refer to an unspoken suffix.
    // A caption derived from persisted heard text cannot expose those fields.
    candidates.push({evidenceId:explanation.id,title:explanation.text.trim().split(/\r?\n/)[0].slice(0,240),entities,bytes});
  }
  const selected=candidates.length<=NOTES_LIMITS.visuals?candidates:Array.from({length:NOTES_LIMITS.visuals},(_,index)=>candidates[Math.round(index*(candidates.length-1)/(NOTES_LIMITS.visuals-1))]);
  const visualBytes=2+Math.max(0,selected.length-1)+selected.reduce((sum,visual)=>sum+visual.bytes+Buffer.byteLength(JSON.stringify({evidenceId:visual.evidenceId,title:visual.title,entities:[]}),'utf8')-2,0);
  if(visualBytes>NOTES_LIMITS.documentBytes-NOTES_LIMITS.draftBytes-65536)throw new Error('The studied diagrams exceed the notes document size limit.');
  const visuals=selected.map(({evidenceId,title,entities})=>({evidenceId,title,entities:parseScene(entities)}));
  const learnerQuestions=session.messages.slice(0,lastTutorIndex).filter(message=>message.role==='student'&&message.text.trim()).slice(-12).map(message=>({text:message.text.slice(0,1000)}));
  const snapshot:StudiedContent={topic:session.topic,explanations,learnerQuestions,visuals,coverageHash:'',studiedSteps:explanations.length};
  const input=JSON.stringify(studiedNotesInput(snapshot));
  if(new TextEncoder().encode(input).byteLength>NOTES_LIMITS.contextBytes)throw new Error('This lesson is too long for one notes request. No studied explanations were omitted.');
  if(new TextEncoder().encode(JSON.stringify(visuals)).byteLength>NOTES_LIMITS.documentBytes-NOTES_LIMITS.draftBytes-65536)throw new Error('The studied diagrams exceed the notes document size limit.');
  snapshot.coverageHash=createHash('sha256').update(JSON.stringify({input,visuals})).digest('hex');
  return snapshot;
}
