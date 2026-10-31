import {createHash} from 'node:crypto';
import {mkdir,writeFile,lstat,realpath,open,unlink,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {contractIdSchema,studyNotesDocumentSchema,lessonNotesRecordSchema,NOTES_LIMITS,type StudyNotesDocument,type LessonNotesRecord} from '@living-canvas/protocol';
import {assertLearnerSafe,LearnerSafetyError} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate} from '../safety/contracts';

type Preferences={getPreference(key:string):string|undefined;setPreference(key:string,value:string):void};
type Options={rootDirectory:string;preferences:Preferences;safety?:SafetyGate};
const missing=()=>new Error('The saved notes PDF is unavailable. Generate notes again to create a new copy.');
const uuid=lessonNotesRecordSchema.shape.id;
async function readBounded(path:string,maximum:number):Promise<Buffer>{
  const handle=await open(path,'r');
  try{
    const initial=await handle.stat();if(!initial.isFile()||initial.size>maximum)throw missing();
    const bytes=Buffer.alloc(initial.size+1);let length=0;
    while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
    const final=await handle.stat();if(length!==initial.size||final.size!==initial.size||final.mtimeMs!==initial.mtimeMs)throw missing();
    return bytes.subarray(0,length);
  }finally{await handle.close();}
}
export class NotesRepository {
  private root:string;
  constructor(private options:Options){this.root=resolve(options.rootDirectory);}
  private key(sessionId:string){return `lesson-notes:${contractIdSchema.parse(sessionId)}`;}
  private record(document:StudyNotesDocument):LessonNotesRecord{
    const {id,sessionId,createdAt,studiedSteps,content,modelMetadata}=document;
    return lessonNotesRecordSchema.parse({id,sessionId,createdAt,studiedSteps,title:content.title,providerId:modelMetadata.providerId,requestedModel:modelMetadata.requestedModel,...(modelMetadata.servedModel?{servedModel:modelMetadata.servedModel}:{})});
  }
  private async directory(sessionId:string,create=false):Promise<string>{
    contractIdSchema.parse(sessionId);
    const directory=join(this.root,createHash('sha256').update(sessionId).digest('hex'));
    if(create){await mkdir(this.root,{recursive:true});await mkdir(directory,{recursive:true});}
    const entry=await lstat(directory);if(!entry.isDirectory()||entry.isSymbolicLink())throw missing();
    const [canonicalRoot,canonicalDirectory]=await Promise.all([realpath(this.root),realpath(directory)]);
    if(dirname(canonicalDirectory)!==canonicalRoot)throw missing();
    return canonicalDirectory;
  }
  async save(input:StudyNotesDocument,pdf:Buffer,signal?:AbortSignal):Promise<LessonNotesRecord>{
    signal?.throwIfAborted();const document=studyNotesDocumentSchema.parse(input),record=this.record(document);
    assertLearnerSafe(document,'saved-content');
    this.options.safety?.assertApproved(document,'saved-content');
    if(!Buffer.isBuffer(pdf)||pdf.length>NOTES_LIMITS.pdfBytes||pdf.length<16||pdf.subarray(0,5).toString('ascii')!=='%PDF-'||!pdf.subarray(-1024).toString('latin1').includes('%%EOF'))throw new Error('The notes renderer did not produce a valid bounded PDF.');
    const artifact={document,pdfSha256:createHash('sha256').update(pdf).digest('hex')};
    this.options.safety?.derive(record,[document],'saved-content');
    this.options.safety?.derive(artifact,[document],'saved-content');
    const directory=await this.directory(document.sessionId,true),pdfPath=join(directory,`${document.id}.pdf`),jsonPath=join(directory,`${document.id}.json`);
    let createdPdf=false,createdJson=false;
    try{
      signal?.throwIfAborted();await writeFile(pdfPath,pdf,{flag:'wx'});createdPdf=true;
      signal?.throwIfAborted();await writeFile(jsonPath,JSON.stringify(document),{flag:'wx',encoding:'utf8'});createdJson=true;
      signal?.throwIfAborted();this.options.safety?.assertApproved(document,'saved-content');this.options.safety?.assertApproved(artifact,'saved-content');
      this.options.preferences.setPreference(this.key(document.sessionId),JSON.stringify(record));
      return record;
    }catch(error){
      // Only this attempt's newly-created files are removed. Never overwrite or
      // delete a previously published artifact on a failed regeneration.
      if(createdJson)await unlink(jsonPath).catch(()=>{});if(createdPdf)await unlink(pdfPath).catch(()=>{});
      signal?.throwIfAborted();if(error instanceof LearnerSafetyError)throw error;
      // eslint-disable-next-line preserve-caught-error -- Filesystem causes may contain private paths; only fixed public copy leaves this service.
      throw new Error('Notes could not be saved on this device. Your previous notes are unchanged; try again.');
    }
  }
  private async verifiedPdf(sessionId:string,notesId:string):Promise<{path:string;bytes:Buffer}>{
    contractIdSchema.parse(sessionId);uuid.parse(notesId);
    try{
      const directory=await this.directory(sessionId),jsonPath=join(directory,`${notesId}.json`),pdfPath=join(directory,`${notesId}.pdf`);
      const [jsonInfo,pdfInfo]=await Promise.all([lstat(jsonPath),lstat(pdfPath)]);
      if(!jsonInfo.isFile()||jsonInfo.isSymbolicLink()||jsonInfo.size>NOTES_LIMITS.documentBytes||!pdfInfo.isFile()||pdfInfo.isSymbolicLink()||pdfInfo.size>NOTES_LIMITS.pdfBytes||pdfInfo.size<16)throw missing();
      const document=studyNotesDocumentSchema.parse(JSON.parse((await readBounded(jsonPath,NOTES_LIMITS.documentBytes)).toString('utf8')));
      assertLearnerSafe(document,'saved-content');
      this.options.safety?.assertApproved(document,'saved-content');
      if(document.id!==notesId||document.sessionId!==sessionId)throw missing();
      const bytes=await readBounded(pdfPath,NOTES_LIMITS.pdfBytes);
      if(bytes.length<16||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||!bytes.subarray(-1024).toString('latin1').includes('%%EOF'))throw missing();
      this.options.safety?.assertApproved({document,pdfSha256:createHash('sha256').update(bytes).digest('hex')},'saved-content');
      return {path:pdfPath,bytes};
    }catch(error){if(error instanceof LearnerSafetyError||error instanceof Error&&'code'in error&&String(error.code).startsWith('LEARNER_'))throw error;throw missing();}
  }
  /** Legacy internal path discovery. Delivery must use pdfBytes instead. */
  async pdfPath(sessionId:string,notesId:string):Promise<string>{return (await this.verifiedPdf(sessionId,notesId)).path;}
  /** Return the exact bytes whose digest was checked; callers never reread a mutable path. */
  async pdfBytes(sessionId:string,notesId:string):Promise<Uint8Array>{return (await this.verifiedPdf(sessionId,notesId)).bytes;}
  async latest(sessionId:string):Promise<LessonNotesRecord|null>{
    const text=this.options.preferences.getPreference(this.key(sessionId));if(!text)return null;
    let record:LessonNotesRecord;
    try{record=lessonNotesRecordSchema.parse(JSON.parse(text));if(record.sessionId!==sessionId)throw missing();}
    catch{throw new Error('Saved notes metadata could not be read. Generate notes again to create a new copy.');}
    assertLearnerSafe(record,'saved-content');this.options.safety?.assertApproved(record,'saved-content');await this.pdfPath(sessionId,record.id);return record;
  }
  async remove(sessionId:string):Promise<void>{
    const key=this.key(sessionId);
    // Resolve and verify the one app-owned lesson directory before recursive
    // removal. This never accepts a path supplied by the renderer.
    let directory:string|undefined;
    try{directory=await this.directory(sessionId);}
    catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    this.options.preferences.setPreference(key,'');
  }
}
