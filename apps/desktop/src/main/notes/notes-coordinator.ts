import {randomUUID} from 'node:crypto';
import {NOTES_LIMITS,studyNotesDraftSchema,studyNotesDocumentSchema,type StudyNotesDocument} from '@living-canvas/protocol';
import {buildNotesInstructions,getNotesToolParameters} from '../../../../../packages/teacher/src/notes';
import {parseToolInput} from '../../../../../packages/teacher/src/tool-schema';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SessionRepository} from '../storage/session-repository';
import {ProviderToolGenerationError,sameProviderScope,type ProviderScope,type TeachingProvider} from '../ai/provider-contract';
import {buildStudiedContent,studiedNotesInput} from './studied-content';
import {localStudyRecord,LOCAL_NOTES_SCAFFOLD} from './local-notes';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../safety/contracts';

type Options={sessions:Pick<SessionRepository,'load'>;provider:TeachingProvider;safety?:SafetyGate;model():string|undefined;now?():Date;createId?():string};
const canceled=()=>new Error('Study notes generation was canceled.');
const invalid=()=>new Error('The AI notes could not be validated against the studied explanations. Please try Generate notes again.');
function abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted){void pending.catch(()=>undefined);signal.throwIfAborted();}
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??canceled());signal.addEventListener('abort',abort,{once:true});
    pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
const sameScope=(before:ProviderScope|undefined,after:ProviderScope|undefined)=>before===undefined&&after===undefined||sameProviderScope(before,after);
function notesJson(text:string):unknown{
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>NOTES_LIMITS.draftBytes)throw invalid();
  const trimmed=text.trim(),fence=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return JSON.parse(fence?fence[1]:trimmed);
}

/** One explicit action owns one provider request. Notes never enter teaching-native history. */
export class NotesCoordinator {
  private jobs=new Map<string,AbortController>();
  constructor(private options:Options){options.safety?.registerTrusted(LOCAL_NOTES_SCAFFOLD);}
  cancel(sessionId:string){this.jobs.get(sessionId)?.abort(canceled());this.jobs.delete(sessionId);this.options.safety?.cancel(`notes:${sessionId}`);}
  cancelAll(){for(const job of this.jobs.values())job.abort(canceled());this.jobs.clear();}
  /** A separately selected offline action never consults credentials or models. */
  async generateLocal(sessionId:string,signal?:AbortSignal):Promise<StudyNotesDocument>{
    signal?.throwIfAborted();
    if(this.jobs.has(sessionId))throw new Error('Study notes are already being generated for this lesson.');
    const session=this.options.sessions.load(sessionId),snapshot=buildStudiedContent(session);assertLearnerSafe(snapshot,'saved-content');
    if(this.options.safety){this.options.safety.assertApproved(session,'saved-content');this.options.safety.derive(snapshot,[session],'saved-content');}
    const content=localStudyRecord(snapshot);assertLearnerSafe(content,'model-output');
    this.options.safety?.derive(content,[snapshot,LOCAL_NOTES_SCAFFOLD],'model-output');
    signal?.throwIfAborted();
    const now=(this.options.now?.()??new Date()).toISOString();
    const document=studyNotesDocumentSchema.parse({version:1,id:this.options.createId?.()??randomUUID(),sessionId,topic:snapshot.topic,createdAt:now,coverageHash:snapshot.coverageHash,studiedSteps:snapshot.studiedSteps,content,visuals:snapshot.visuals,modelMetadata:{providerId:'local',requestedModel:'local-extract',completedAt:now}});
    this.options.safety?.derive(document,[snapshot,content,LOCAL_NOTES_SCAFFOLD],'model-output');return document;
  }
  async generate(sessionId:string,externalSignal?:AbortSignal):Promise<StudyNotesDocument>{
    externalSignal?.throwIfAborted();
    if(this.jobs.has(sessionId))throw new Error('Study notes are already being generated for this lesson.');
    const model=this.options.model();if(!model)throw new Error('Choose an available teaching model in Settings before generating notes.');
    const scope=this.options.provider.scope?.();const captured=scope?{...scope}:undefined;
    const jsonMode=captured?.providerId==='chatgpt'||this.options.provider.id==='chatgpt';
    const identity=this.options.provider.identity?.();
    if(captured&&captured.modelId!==model)throw new Error('Your teaching connection changed. Generate notes again with the selected model.');
    const originalSession=this.options.sessions.load(sessionId),snapshot=buildStudiedContent(originalSession);
    assertLearnerSafe(snapshot,'saved-content');
    const controller=new AbortController();this.jobs.set(sessionId,controller);
    const signal=externalSignal?AbortSignal.any([controller.signal,externalSignal]):controller.signal;
    const rawContext={topic:originalSession.topic,messages:originalSession.messages};
    const safetyTask:SafetyTask={operation:'notes',originalRequest:originalSession.topic,context:{...studiedNotesInput(snapshot),originalConversation:rawContext},subjectId:`notes:${sessionId}`};
    const originalContext=JSON.stringify(rawContext);
    let safetyPermit:SafetyPermit|undefined;
    const timer=setTimeout(()=>controller.abort(new Error('Study notes generation timed out. Try again when ready.')),180000);
    const current=()=>{
      signal.throwIfAborted();
      if(this.options.model()!==model||!sameScope(captured,this.options.provider.scope?.())||identity!==this.options.provider.identity?.())throw new Error('Your teaching connection changed while notes were being generated. Please try again.');
      if(safetyPermit)this.options.safety?.assertCurrent(safetyPermit,safetyTask);
      if(this.options.safety){const current=this.options.sessions.load(sessionId);if(JSON.stringify({topic:current.topic,messages:current.messages})!==originalContext)throw new Error('Your conversation changed during notes review. Generate notes again.');}
    };
    try{
      current();
      if(this.options.safety){
        safetyPermit=await abortable(this.options.safety.authorize(safetyTask,signal),signal);current();
        if(!this.options.safety.isApproved(snapshot))await abortable(this.options.safety.inspect(snapshot,'saved-content',signal),signal);
        current();
      }
      // Notes are a validated data report, not an executable action. ChatGPT's
      // text route avoids requesting the tool capability rejected by admission.
      const tools=jsonMode?[]:[{type:'namespace',name:'notes',description:'Create faithful revision notes from explanations actually presented.',tools:[{type:'function',name:'create_notes',description:'Organize every supplied studied explanation into detailed notes with evidence IDs.',strict:true,parameters:getNotesToolParameters()}]}];
      const response=await abortable(this.options.provider.complete({model,instructions:buildNotesInstructions(jsonMode?'json':'tool'),input:[{role:'user',content:JSON.stringify(studiedNotesInput(snapshot))}],tools,scope:captured,...(safetyPermit?{safetyPermit,safetyTask}:{})},signal),signal);
      current();
      assertLearnerSafe(response,'model-output');
      if(response.historyScope&&captured&&!sameProviderScope(captured,response.historyScope))throw new Error('Your teaching connection changed while notes were being generated. Please try again.');
      let content;
      try{
        if(jsonMode){if(response.calls.length)throw invalid();content=parseToolInput(studyNotesDraftSchema,notesJson(response.text));}
        else{if(response.calls.length!==1)throw invalid();const call=response.calls[0];if(call.namespace!=='notes'||call.name!=='create_notes')throw invalid();content=parseToolInput(studyNotesDraftSchema,JSON.parse(call.arguments));}
      }catch{throw invalid();}
      const evidence=new Set(snapshot.explanations.map(item=>item.id)),covered=new Set<string>();
      for(const section of content.sections)for(const id of section.evidenceIds){if(!evidence.has(id))throw invalid();covered.add(id);}
      for(const question of content.reviewQuestions)if(question.evidenceIds.some(id=>!evidence.has(id)))throw invalid();
      if([...evidence].some(id=>!covered.has(id)))throw invalid();
      if(buildStudiedContent(this.options.sessions.load(sessionId)).coverageHash!==snapshot.coverageHash)throw new Error('Your studied lesson changed while notes were being generated. Generate notes again to include the latest study.');
      current();
      const now=(this.options.now?.()??new Date()).toISOString(),metadata=response.modelMetadata;
      const document=studyNotesDocumentSchema.parse({version:1,id:this.options.createId?.()??randomUUID(),sessionId,topic:snapshot.topic,createdAt:now,coverageHash:snapshot.coverageHash,studiedSteps:snapshot.studiedSteps,content,visuals:snapshot.visuals,modelMetadata:{providerId:captured?.providerId??metadata?.providerId??'chatgpt',requestedModel:model,...(metadata?.servedModel??response.servedModel?{servedModel:metadata?.servedModel??response.servedModel}:{}),...(metadata?.responseId??response.responseId?{responseId:metadata?.responseId??response.responseId}:{}),completedAt:metadata?.completedAt??now}});
      if(this.options.safety)await abortable(this.options.safety.inspect(document,'model-output',signal),signal);current();
      if(this.options.safety&&buildStudiedContent(this.options.sessions.load(sessionId)).coverageHash!==snapshot.coverageHash)throw new Error('Your studied lesson changed during notes review. Generate notes again.');
      return document;
    }catch(error){
      signal.throwIfAborted();
      // Generated-content rejection is actionable, but never spends another model call.
      if(error instanceof ProviderToolGenerationError)throw invalid();
      throw error;
    }finally{clearTimeout(timer);if(this.jobs.get(sessionId)===controller)this.jobs.delete(sessionId);}
  }
}
