import {contractIdSchema,studyNotesDocumentSchema,type LessonNotesRecord} from '@living-canvas/protocol';
import type {SessionRepository} from '../storage/session-repository';
import type {NotesCoordinator} from './notes-coordinator';
import type {NotesPdfService} from './notes-pdf';
import type {NotesRepository} from './notes-repository';
import {buildStudiedContent} from './studied-content';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate} from '../safety/contracts';

type Options={sessions:Pick<SessionRepository,'load'>;safety?:SafetyGate;coordinator:Pick<NotesCoordinator,'generate'|'generateLocal'|'cancel'|'cancelAll'>;pdf:Pick<NotesPdfService,'render'|'open'|'dispose'>&Partial<Pick<NotesPdfService,'openBytes'>>;repository:Pick<NotesRepository,'save'|'latest'|'pdfPath'|'remove'>&Partial<Pick<NotesRepository,'pdfBytes'>>};
const canceled=()=>new Error('Study notes generation was canceled.');
function abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted){void pending.catch(()=>{});signal.throwIfAborted();}
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??canceled());signal.addEventListener('abort',abort,{once:true});
    pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** Owns generation through local rendering and publication, including cancellation
 * after AI completion. No read/open/export operation invokes the provider. */
export class LessonNotesService {
  private jobs=new Map<string,AbortController>();private disposed=false;
  constructor(private options:Options){}
  private alive(){if(this.disposed)throw canceled();}
  cancel(sessionId:string){this.jobs.get(sessionId)?.abort(canceled());this.jobs.delete(sessionId);this.options.coordinator.cancel(sessionId);}
  cancelAll(){for(const job of this.jobs.values())job.abort(canceled());this.jobs.clear();this.options.coordinator.cancelAll();}
  async generate(sessionId:string,beforeStart?:()=>Promise<unknown>,mode:'ai'|'local'='ai'):Promise<LessonNotesRecord>{
    this.alive();contractIdSchema.parse(sessionId);this.options.sessions.load(sessionId);
    if(this.jobs.has(sessionId))throw new Error('Study notes are already being generated for this lesson.');
    const controller=new AbortController();this.jobs.set(sessionId,controller);const signal=controller.signal;
    try{
      // Reserve the job before asynchronous model/catalog readiness, so a user
      // cancellation cannot be followed by a newly-started paid inference.
      if(mode==='ai'&&beforeStart)await abortable(beforeStart(),signal);signal.throwIfAborted();
      const generated=mode==='local'?this.options.coordinator.generateLocal(sessionId,signal):this.options.coordinator.generate(sessionId,signal);
      const document=studyNotesDocumentSchema.parse(await abortable(generated,signal));
      assertLearnerSafe(document,'model-output');
      if(this.options.safety){
        if(mode==='local')this.options.safety.assertApproved(document,'model-output');
        else if(!this.options.safety.isApproved(document))await abortable(this.options.safety.inspect(document,'model-output',signal),signal);
        signal.throwIfAborted();this.options.safety.assertApproved(document,'model-output');
      }
      signal.throwIfAborted();if(document.sessionId!==sessionId)throw new Error('Notes do not belong to this lesson.');
      const pdf=await abortable(this.options.pdf.render(document,signal),signal);signal.throwIfAborted();
      this.options.safety?.assertApproved(document,'model-output');
      if(buildStudiedContent(this.options.sessions.load(sessionId)).coverageHash!==document.coverageHash)throw new Error('Your studied lesson changed while the PDF was being prepared. Generate notes again to include the latest study.');
      return await this.options.repository.save(document,pdf,signal);
    }finally{if(this.jobs.get(sessionId)===controller)this.jobs.delete(sessionId);}
  }
  async latest(sessionId:string){this.alive();contractIdSchema.parse(sessionId);this.options.sessions.load(sessionId);return this.options.repository.latest(sessionId);}
  async pdfPath(sessionId:string,notesId:string){this.alive();contractIdSchema.parse(sessionId);this.options.sessions.load(sessionId);return this.options.repository.pdfPath(sessionId,notesId);}
  async pdfBytes(sessionId:string,notesId:string):Promise<Uint8Array>{
    this.alive();contractIdSchema.parse(sessionId);this.options.sessions.load(sessionId);
    if(!this.options.repository.pdfBytes)throw new Error('Verified notes PDF bytes are unavailable. Restart Canvas Atlas.');
    const bytes=await this.options.repository.pdfBytes(sessionId,notesId);this.alive();this.options.sessions.load(sessionId);return bytes;
  }
  async open(sessionId:string,notesId:string){
    const record=await this.options.repository.latest(sessionId),title=record?.id===notesId?record.title:'Study notes';this.alive();
    if(this.options.pdf.openBytes&&this.options.repository.pdfBytes){const bytes=await this.pdfBytes(sessionId,notesId);await this.options.pdf.openBytes(bytes,title);return;}
    if(this.options.safety)throw new Error('Verified notes PDF viewing is unavailable. Restart Canvas Atlas.');
    await this.options.pdf.open(await this.pdfPath(sessionId,notesId),title);
  }
  async remove(sessionId:string){this.alive();contractIdSchema.parse(sessionId);this.cancel(sessionId);await this.options.repository.remove(sessionId);}
  dispose(){if(this.disposed)return;this.disposed=true;this.cancelAll();this.options.pdf.dispose();}
}
