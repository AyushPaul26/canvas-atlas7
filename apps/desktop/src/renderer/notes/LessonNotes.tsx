import {useEffect,useRef,useState} from 'react';
import {Download,FileText,LoaderCircle} from 'lucide-react';
import {isLearnerSafetyMessage,type LessonNotesRecord,type LessonSession} from '@living-canvas/protocol';
import {bridge} from '../bridge';
import './lesson-notes.css';

type Props={session:LessonSession;desktop:boolean;canGenerate:boolean;connectionKey:string;disabled?:boolean;beforeGenerate():Promise<LessonSession>;onSafetyBlocked?:(message:string)=>void};
type Job={sessionId:string;connectionKey:string;requested:boolean;mode:'ai'|'local'};
const hasStudy=(lesson:LessonSession)=>lesson.messages.some(message=>message.role==='tutor'&&message.text.trim().length>0);
const message=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method 'lc:[A-Za-z][A-Za-z0-9]*': Error: /,'');

export default function LessonNotes({session,desktop,canGenerate,connectionKey,disabled=false,beforeGenerate,onSafetyBlocked}:Props){
  const [record,setRecord]=useState<LessonNotesRecord|null>(null);
  const [running,setRunning]=useState<'preparing'|'generating'|null>(null);
  const [fileAction,setFileAction]=useState<'open'|'save'|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const pending=useRef<Job|null>(null),filePending=useRef<{sessionId:string}|null>(null),readVersion=useRef(0);
  const scope=useRef({sessionId:session.id,connectionKey});scope.current={sessionId:session.id,connectionKey};
  const current=(job:Job)=>pending.current===job&&scope.current.sessionId===job.sessionId&&scope.current.connectionKey===job.connectionKey;

  useEffect(()=>{
    setRunning(null);setError(null);setNotice(null);
    return ()=>{
      const job=pending.current;
      if(job&&job.sessionId===session.id&&job.connectionKey===connectionKey){
        pending.current=null;
        if(job.requested&&typeof bridge.cancelLessonNotes==='function')void bridge.cancelLessonNotes(job.sessionId).catch(()=>{});
      }
    };
  },[session.id,connectionKey]);
  useEffect(()=>{
    const version=++readVersion.current;let mounted=true;setRecord(null);setFileAction(null);filePending.current=null;
    if(desktop&&typeof bridge.getLessonNotes==='function')void bridge.getLessonNotes(session.id).then(value=>{
      if(mounted&&version===readVersion.current&&(!value||value.sessionId===session.id))setRecord(value);
    }).catch(error=>{if(mounted&&version===readVersion.current)setError(message(error));});
    return ()=>{mounted=false;filePending.current=null;};
  },[session.id,desktop]);

  const generate=async(mode:'ai'|'local'='ai')=>{
    if(pending.current||disabled||!desktop||(mode==='ai'&&!canGenerate)||!hasStudy(session))return;
    const job:Job={sessionId:session.id,connectionKey,requested:false,mode};pending.current=job;
    setRunning('preparing');setError(null);setNotice(null);
    try{
      const saved=await beforeGenerate();if(!current(job))return;
      if(saved.id!==job.sessionId)throw new Error('The lesson changed. Return to it before generating notes.');
      if(!hasStudy(saved))throw new Error('Study part of this lesson to generate notes.');
      if(typeof bridge.generateLessonNotes!=='function')throw new Error('Notes are unavailable. Restart Canvas Atlas to load the updated feature.');
      setRunning('generating');job.requested=true;
      const next=await bridge.generateLessonNotes({sessionId:job.sessionId,...(mode==='local'?{mode}:{})});if(!current(job))return;
      if(next.sessionId!==job.sessionId)throw new Error('The notes belong to another lesson. Please try again.');
      readVersion.current++;setError(null);setRecord(next);setNotice(`${mode==='local'?'Offline study record ready':'Notes ready'} · ${next.studiedSteps} studied ${next.studiedSteps===1?'step':'steps'}`);
    }catch(error){if(current(job)){setError(message(error));if(isLearnerSafetyMessage(error))onSafetyBlocked?.(message(error));}}
    finally{if(current(job)){pending.current=null;setRunning(null);}}
  };
  const cancel=()=>{
    const job=pending.current;if(!job)return;
    pending.current=null;setRunning(null);setError(null);setNotice('Notes generation canceled.');
    if(job.requested&&typeof bridge.cancelLessonNotes==='function')void bridge.cancelLessonNotes(job.sessionId).catch(()=>{});
  };
  const usePdf=async(action:'open'|'save')=>{
    if(!record||record.sessionId!==session.id||filePending.current)return;
    const fileJob={sessionId:session.id};filePending.current=fileJob;setFileAction(action);setError(null);setNotice(null);
    const sessionId=session.id,notesId=record.id;
    const currentFile=()=>filePending.current===fileJob&&scope.current.sessionId===sessionId;
    try{
      if(action==='open')await bridge.openLessonNotes({sessionId,notesId});
      else{const result=await bridge.exportLessonNotes({sessionId,notesId});if(!result.canceled&&currentFile())setNotice('PDF saved.');}
    }catch(error){if(currentFile())setError(message(error));}
    finally{if(currentFile()){filePending.current=null;setFileAction(null);}}
  };
  const saved=record?.sessionId===session.id?record:null;
  const localBusy=Boolean(running)&&pending.current?.mode==='local',aiBusy=Boolean(running)&&!localBusy;
  const hint=!desktop?'Notes are available in the desktop app.':saved?.providerId==='local'?'Offline study record · No AI request used.':!hasStudy(session)?'Study part of this lesson to generate notes.':!canGenerate?'Create an offline study record from saved explanations. No AI request used.':'Uses your selected AI service.';
  return <section className="lesson-notes" aria-label="Lesson notes">
    <div className="lesson-notes-actions">
      <button type="button" className="button secondary compact notes-generate" disabled={disabled||Boolean(running)||!desktop||!canGenerate||!hasStudy(session)} onClick={()=>void generate()} aria-busy={aiBusy} aria-describedby="lesson-notes-hint">{aiBusy?<LoaderCircle size={15} className="spin"/>:<FileText size={15}/>}<span>{aiBusy?'Generating notes…':'Generate notes'}</span></button>
      <button type="button" className="text-button notes-offline" disabled={disabled||Boolean(running)||!desktop||!hasStudy(session)} onClick={()=>void generate('local')} aria-busy={localBusy} aria-describedby="lesson-notes-hint" title="Create a study record from saved explanations on this device. No AI request or quota is used.">{localBusy&&<LoaderCircle size={13} className="spin"/>}{localBusy?'Creating offline record…':'Create notes offline'}</button>
      {running&&<button type="button" className="text-button" onClick={cancel} aria-label="Cancel notes">Cancel</button>}
      {saved&&<><button type="button" className="text-button" disabled={Boolean(fileAction)} onClick={()=>void usePdf('open')}>Open PDF</button><button type="button" className="text-button notes-save" disabled={Boolean(fileAction)} onClick={()=>void usePdf('save')}><Download size={13}/>Save PDF</button></>}
    </div>
    <p id="lesson-notes-hint" className="lesson-notes-hint" aria-live="polite">{fileAction?(fileAction==='open'?'Opening PDF…':'Choose where to save the PDF…'):running?(running==='preparing'?'Saving your study progress…':localBusy?'Creating an offline study record on this device…':'Creating notes from what you studied…'):hint}</p>
    {notice&&<p className="lesson-notes-feedback" role="status">{notice}</p>}
    {error&&<p className="lesson-notes-error" role="alert">{error}</p>}
  </section>;
}
