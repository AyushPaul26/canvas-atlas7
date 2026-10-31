import {randomUUID} from 'node:crypto';
import {canvasSchema,LIMITS,adaptTeachingBeat,playbackCheckpointSchema,type PlaybackCheckpoint,type LessonSession,type TeachingBeat,type TutorEvent,type SourceExcerpt} from '@living-canvas/protocol';
import type {SessionRepository} from '../storage/session-repository';
import {completeTeaching,type TeachingProvider} from './provider-contract';
import {RequestEpochs} from './request-epochs';
import { assertSuppliedSourceRefs } from '../../../../../packages/teacher/src/index';
import {assertLearnerSafe,LearnerSafetyError} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../safety/contracts';
import type {ProviderScope} from './provider-contract';

type Teacher={buildTeacherInstructions():string;buildLessonContext(session:LessonSession,request:string,selectedIds?:string[],evidence?:SourceExcerpt[]):string;getTeachingToolParameters():unknown;parseTeachingBeat(value:unknown):TeachingBeat};
type Options={store:SessionRepository;provider:TeachingProvider;teacher:Teacher;model():string|undefined;emit(event:TutorEvent):void;prepareSimulation?:(beat:TeachingBeat,signal:AbortSignal)=>Promise<TeachingBeat>;cancelLocal?:()=>void;evidence?:(session:LessonSession,request:string)=>Promise<SourceExcerpt[]>;validateSources?:(beat:TeachingBeat,session:LessonSession,evidence:SourceExcerpt[])=>void;safety?:SafetyGate};
type Admission={epoch:number;signal:AbortSignal;model:string;scope?:ProviderScope;identity?:string;permit:SafetyPermit;task:SafetyTask;assertUnchanged():void};
export class LessonCoordinator {
  private epochs=new RequestEpochs();
  private prepared=new Map<string,Map<string,{epoch:number;beat:TeachingBeat;narration:string;complete:boolean;readOnly?:boolean}>>();
  private continuations=new Map<string,{epoch:number;model:string;selectionIds?:string[];conceptId?:string}>();
  private focus=new Map<string,string[]>();
  private continuousRounds=new Map<string,number>();
  private activeSessions=new Set<string>();
  constructor(private options:Options){}
  private async admit(sessionId:string,originalRequest:string,operation:SafetyTask['operation'],details?:unknown):Promise<Admission>{
    const model=this.options.model();if(!model)throw new Error('Choose an available teaching model in Settings before starting your lesson.');
    const {epoch,signal}=this.epochs.begin(sessionId),selectedScope=this.options.provider.scope?.(),scope=selectedScope?{...selectedScope}:undefined,identity=this.options.provider.identity?.();
    this.activeSessions.add(sessionId);this.continuations.delete(sessionId);this.prepared.delete(sessionId);this.options.cancelLocal?.();
    const lesson=this.options.store.load(sessionId),snapshot=JSON.stringify(lesson),task:SafetyTask={operation,originalRequest,subjectId:sessionId,context:{lesson,...(details?{details}:{})}};
    const current=()=>{signal.throwIfAborted();if(!this.epochs.isCurrent(sessionId,epoch)||model!==this.options.model()||identity!==this.options.provider.identity?.()||JSON.stringify(scope)!==JSON.stringify(this.options.provider.scope?.()))throw new Error('The lesson request was canceled because the teaching connection changed.');if(JSON.stringify(this.options.store.load(sessionId))!==snapshot)throw new Error('Your lesson changed while the request was being checked. Try again.');};
    try{
      const permit=await this.options.safety!.authorize(task,signal);current();this.options.safety!.assertCurrent(permit,task);
      await this.options.safety!.inspect(task,'saved-content',signal);current();this.options.safety!.assertCurrent(permit,task);this.options.safety!.derive(lesson,[task],'saved-content');
      return {epoch,signal,model,scope,identity,permit,task,assertUnchanged:()=>{current();this.options.safety!.assertCurrent(permit,task);}};
    }catch(error){if(this.epochs.isCurrent(sessionId,epoch))this.activeSessions.delete(sessionId);throw error;}
  }
  async startConcept(input:{sessionId:string;conceptId:string}):Promise<void>{
    const lesson=this.options.store.load(input.sessionId),plan=lesson.plan;
    assertLearnerSafe(lesson,'saved-content');
    if(!plan||!plan.concepts.some(concept=>concept.id===input.conceptId))throw new Error('Choose a concept from this lesson roadmap.');
    const admission=this.options.safety?await this.admit(lesson.id,lesson.topic,'lesson',{conceptId:input.conceptId}):undefined;
    admission?.assertUnchanged();
    const progress=this.options.store.loadLearningProgress(lesson.id)!;
    progress.activeConceptId=input.conceptId;if(progress.conceptStates[input.conceptId]!=='completed')progress.conceptStates[input.conceptId]='teaching';progress.status='teaching';delete progress.pendingCheck;delete progress.branchReturnPoint;
    this.options.store.saveLearningProgress(lesson.id,progress);this.options.store.clearBranchPlayback(lesson.id);this.continuousRounds.set(lesson.id,0);
    await this.run({sessionId:lesson.id,text:lesson.topic},lesson.messages.some(message=>message.role==='student'),admission);
  }
  savePlayback(input:{sessionId:string;epoch:number;checkpoint:PlaybackCheckpoint}){
    if(!this.epochs.isCurrent(input.sessionId,input.epoch))throw new Error('Playback belongs to a stale lesson turn.');
    const checkpoint=playbackCheckpointSchema.parse(input.checkpoint);
    const prepared=this.prepared.get(input.sessionId)?.get(checkpoint.cursor.beatId);
    if(!prepared||prepared.epoch!==input.epoch)throw new Error('This playback step was not accepted.');
    const beat=adaptTeachingBeat(prepared.beat),completed=checkpoint.completedChunkIds;
    if(completed.some((id,index)=>beat.chunks[index]?.id!==id))throw new Error('Heard chunks must form the accepted narration prefix.');
    if(!beat.chunks.some(chunk=>chunk.id===checkpoint.cursor.chunkId)||checkpoint.appliedCueIds.some(id=>!beat.cues.some(cue=>cue.id===id)))throw new Error('Playback references an unknown chunk or visual cue.');
    const lesson=this.options.store.load(input.sessionId);
    if(this.options.safety){this.options.safety.assertApproved(lesson);this.options.safety.assertApproved(prepared.beat);if(!this.options.safety.isApproved(checkpoint))this.options.safety.derive(checkpoint,[lesson,prepared.beat],'saved-content');}
    this.options.store.transaction(()=>{this.options.store.savePlayback(input.sessionId,checkpoint);this.options.safety?.derive(this.options.store.load(input.sessionId),[lesson,checkpoint],'saved-content');});
  }
  resumePlayback(input:{sessionId:string;mode:'resume'|'replay'}){
    const checkpoint=this.options.store.loadPlayback(input.sessionId);
    if(!checkpoint)throw new Error('There is no saved explanation to resume yet.');
    assertLearnerSafe(checkpoint,'saved-content');
    const beat=this.options.store.loadAcceptedBeat(input.sessionId,checkpoint.cursor.beatId);
    if(!beat)throw new Error('The saved explanation is unavailable. Ask your teacher to continue.');
    assertLearnerSafe(beat,'saved-content');
    this.options.safety?.assertApproved(checkpoint);this.options.safety?.assertApproved(beat);
    const {epoch}=this.epochs.begin(input.sessionId);this.continuations.delete(input.sessionId);
    const mode=input.mode==='replay'||this.hasFullReceipt(beat,checkpoint)?'replay':'resume';
    const narration=mode==='resume'?beat.chunks.filter(chunk=>checkpoint.completedChunkIds.includes(chunk.id)).map(chunk=>chunk.text).join(''):'';
    this.prepared.set(input.sessionId,new Map([[beat.id,{epoch,beat,narration,complete:false,readOnly:mode==='replay'}]]));this.activeSessions.add(input.sessionId);
    return {beat,epoch,checkpoint,mode};
  }
  private hasFullReceipt(beat:TeachingBeat,checkpoint:PlaybackCheckpoint):boolean{
    const receipt=checkpoint.receipt,accepted=adaptTeachingBeat(beat);
    return !!receipt&&receipt.audioResult==='completed'&&receipt.visualComplete&&accepted.chunks.every(chunk=>receipt.completedChunkIds.includes(chunk.id))&&accepted.cues.every(cue=>receipt.appliedCueIds.includes(cue.id));
  }
  returnToLesson(input:{sessionId:string}){
    const saved=this.options.store.loadBranchPlayback(input.sessionId);if(!saved)throw new Error('There is no interrupted explanation to return to.');
    assertLearnerSafe(saved,'saved-content');
    const current=this.options.store.load(input.sessionId),progress=saved.progress;
    assertLearnerSafe(current,'saved-content');
    this.options.safety?.assertApproved(saved);this.options.safety?.assertApproved(current);
    const approvedSaved=this.options.safety?structuredClone(saved):saved;
    for(const [id,state] of Object.entries(current.learningProgress?.conceptStates??{}))if(state==='completed')progress.conceptStates[id]='completed';
    delete progress.branchReturnPoint;
    const notes=current.scene.filter(entity=>entity.semanticRole==='learner-note'),visibleScene=[...saved.checkpoint.visibleScene.filter(entity=>entity.semanticRole!=='learner-note'),...notes];
    const checkpoint={...saved.checkpoint,visibleScene,progress};
    assertLearnerSafe(checkpoint,'saved-content');
    if(this.options.safety){this.options.safety.derive(checkpoint,[approvedSaved,current],'saved-content');this.options.safety.derive(visibleScene,[approvedSaved,current],'saved-content');}
    this.options.store.transaction(()=>{
      this.options.store.savePlayback(input.sessionId,checkpoint);
      this.options.store.saveScene(input.sessionId,visibleScene,checkpoint.simulation?.values??{},checkpoint.simulation??null);
      this.options.store.clearBranchPlayback(input.sessionId);
      this.options.safety?.derive(this.options.store.load(input.sessionId),[approvedSaved,current,checkpoint],'saved-content');
    });this.options.cancelLocal?.();
    return this.resumePlayback({sessionId:input.sessionId,mode:'resume'});
  }
  interrupt(sessionId:string){const epoch=this.epochs.interrupt(sessionId);this.options.safety?.cancel(sessionId);this.activeSessions.delete(sessionId);this.prepared.delete(sessionId);this.continuations.delete(sessionId);this.focus.delete(sessionId);this.options.cancelLocal?.();this.options.emit({type:'status',sessionId,epoch,phase:'paused'});}
  cancelAll(){
    const paused=[...this.activeSessions].map(sessionId=>({sessionId,epoch:this.epochs.interrupt(sessionId)}));
    this.epochs.cancelAll();this.activeSessions.clear();this.prepared.clear();this.continuations.clear();this.focus.clear();this.options.cancelLocal?.();
    for(const {sessionId,epoch} of paused)this.options.emit({type:'status',sessionId,epoch,phase:'paused'});
  }
  presentProgress(input:{sessionId:string;epoch:number;beatId:string;scene:TeachingBeat['canvas']['entities'];narration:string;complete:boolean}){
    if(!this.epochs.isCurrent(input.sessionId,input.epoch))throw new Error('Presentation progress belongs to a stale lesson turn.');
    const prepared=this.prepared.get(input.sessionId)?.get(input.beatId);
    if(!prepared||prepared.epoch!==input.epoch)throw new Error('This teaching step was not accepted for presentation.');
    if(!prepared.beat.narration.startsWith(input.narration)||!input.narration.startsWith(prepared.narration))throw new Error('Presentation transcript must extend the actual accepted narration prefix.');
    if(input.complete&&input.narration!==prepared.beat.narration)throw new Error('A completed step must include its full presented narration.');
    const lesson=this.options.store.load(input.sessionId);
    if(this.options.safety){this.options.safety.assertApproved(lesson);this.options.safety.assertApproved(prepared.beat);if(!this.options.safety.isApproved(input.scene))this.options.safety.derive(input.scene,[lesson,prepared.beat],'saved-content');}
    if(input.complete&&lesson.plan){
      const receipt=this.options.store.loadPlayback(input.sessionId)?.receipt,chunks=adaptTeachingBeat(prepared.beat).chunks;
      if(!receipt||receipt.beatId!==prepared.beat.id||receipt.planId!==lesson.plan.id||receipt.planVersion!==lesson.plan.version||receipt.audioResult!=='completed'||!receipt.visualComplete||receipt.completedChunkIds.length!==chunks.length||chunks.some((chunk,index)=>receipt.completedChunkIds[index]!==chunk.id))throw new Error('Audio and visual playback receipts are required before completing this concept.');
    }
    canvasSchema.parse({mode:'replace',entities:input.scene});if(JSON.stringify(input.scene).length>LIMITS.sceneBytes)throw new Error('Presentation checkpoint exceeds the local size limit.');
    this.options.store.transaction(()=>{
      this.options.store.presentProgress(input.sessionId,prepared.beat,input);
      if(input.complete&&lesson.plan&&!prepared.readOnly){
        const progress=this.options.store.loadLearningProgress(lesson.id)!;
        if(progress.branchReturnPoint){progress.status='paused';}
        else if(prepared.beat.next==='ask'){
          progress.status='checking';if(progress.conceptStates[progress.activeConceptId]!=='completed')progress.conceptStates[progress.activeConceptId]='checking';
          progress.pendingCheck={conceptId:progress.activeConceptId,question:prepared.beat.question??prepared.beat.narration};
        }else if(prepared.beat.next==='finish'){
          progress.conceptStates[progress.activeConceptId]='completed';progress.status=lesson.plan.concepts.every(concept=>progress.conceptStates[concept.id]==='completed')?'completed':'paused';
        }
        this.options.store.saveLearningProgress(lesson.id,progress);
      }
      this.options.safety?.derive(this.options.store.load(input.sessionId),[lesson,prepared.beat,input.scene],'saved-content');
    });prepared.narration=input.narration;prepared.complete=prepared.complete||input.complete;
    const steps=[...this.prepared.get(input.sessionId)!.values()];
    if(steps.length&&steps.every(step=>step.complete)){
      if(steps.at(-1)!.readOnly){this.activeSessions.delete(input.sessionId);}
      else if(steps.at(-1)!.beat.next==='continue'){
        const model=this.options.model();if(model)this.continuations.set(input.sessionId,{epoch:input.epoch,model,selectionIds:this.focus.get(input.sessionId)});
      }else if(steps.at(-1)!.beat.next==='finish'&&lesson.plan){
        const progress=this.options.store.loadLearningProgress(lesson.id)!;
        const next=!progress.branchReturnPoint&&lesson.plan.concepts.find(concept=>progress.conceptStates[concept.id]!=='completed');const model=this.options.model();
        if(next&&model)this.continuations.set(input.sessionId,{epoch:input.epoch,model,conceptId:next.id});else this.activeSessions.delete(input.sessionId);
      }else this.activeSessions.delete(input.sessionId);
    }
  }
  async send(input:{sessionId:string;text:string;selectionIds?:string[]}):Promise<void>{
    assertLearnerSafe(input.text,'learner-input');assertLearnerSafe(this.options.store.load(input.sessionId),'saved-content');
    const admission=this.options.safety?await this.admit(input.sessionId,input.text,'follow-up',{selectionIds:input.selectionIds??[]}):undefined;
    admission?.assertUnchanged();
    const progress=this.options.store.loadLearningProgress(input.sessionId);
    if(progress){
      const checkpoint=this.options.store.loadPlayback(input.sessionId);
      this.options.store.transaction(()=>{
        if(progress.pendingCheck){
          const evidence={kind:input.text==='Skip this understanding check and continue.'?'skipped' as const:/explain.*simpl|help me/i.test(input.text)?'help-requested' as const:'answered' as const,answer:input.text,createdAt:new Date().toISOString()};
          this.options.store.recordLearnerEvidence({id:randomUUID(),sessionId:input.sessionId,planId:progress.planId,planVersion:progress.planVersion,conceptId:progress.pendingCheck.conceptId,question:progress.pendingCheck.question,...evidence});
          delete progress.pendingCheck;
        }else if(checkpoint&&!progress.branchReturnPoint){this.options.store.saveBranchPlayback(input.sessionId,{checkpoint,progress});if(admission)this.options.safety!.derive(this.options.store.loadBranchPlayback(input.sessionId),[admission.task],'saved-content');progress.branchReturnPoint=checkpoint.cursor;}
        progress.status='teaching';this.options.store.saveLearningProgress(input.sessionId,progress);
      });
    }
    this.continuousRounds.set(input.sessionId,0);this.focus.set(input.sessionId,[...(input.selectionIds??[])]);await this.run(input,false,admission);
  }
  async continueLesson(input:{sessionId:string;epoch:number}):Promise<void>{
    const permit=this.continuations.get(input.sessionId);
    if(!permit||permit.epoch!==input.epoch||!this.epochs.isCurrent(input.sessionId,input.epoch)||permit.model!==this.options.model())return;
    const lesson=this.options.store.load(input.sessionId);
    const request=[...lesson.messages].reverse().find(message=>message.role==='student')?.text??lesson.topic;
    const admission=this.options.safety?await this.admit(input.sessionId,request,'continuation',{conceptId:permit.conceptId,selectionIds:permit.selectionIds??[]}):undefined;
    admission?.assertUnchanged();
    this.continuations.delete(input.sessionId);
    if(permit.conceptId){const progress=this.options.store.loadLearningProgress(input.sessionId)!;progress.activeConceptId=permit.conceptId;progress.conceptStates[permit.conceptId]='teaching';progress.status='teaching';delete progress.pendingCheck;this.options.store.saveLearningProgress(input.sessionId,progress);this.continuousRounds.set(input.sessionId,0);}
    const rounds=this.continuousRounds.get(input.sessionId)??0;if(rounds>=8){this.activeSessions.delete(input.sessionId);this.options.emit({type:'status',sessionId:input.sessionId,epoch:input.epoch,phase:'ready'});return;}
    this.continuousRounds.set(input.sessionId,rounds+1);
    await this.run({sessionId:input.sessionId,text:request,selectionIds:permit.selectionIds},true,admission);
  }
  private async run(input:{sessionId:string;text:string;selectionIds?:string[]},continuation:boolean,admission?:Admission):Promise<void>{
    const model=admission?.model??this.options.model();if(!model)throw new Error('Choose an available teaching model in Settings before starting your lesson.');
    const scope=admission?.scope??this.options.provider.scope?.();
    assertLearnerSafe(this.options.store.load(input.sessionId),'saved-content');
    const {epoch,signal}=admission??this.epochs.begin(input.sessionId);this.options.cancelLocal?.();
    this.activeSessions.add(input.sessionId);
    this.continuations.delete(input.sessionId);
    this.prepared.set(input.sessionId,new Map());
    const emit=(event:TutorEvent)=>{if(this.epochs.isCurrent(input.sessionId,epoch))this.options.emit(event);};
    if(!continuation)this.options.store.addMessage(input.sessionId,'student',input.text);
    const lesson=this.options.store.load(input.sessionId);let acceptedScene=lesson.scene.filter(entity=>entity.semanticRole!=='learner-note');let sceneRevision=this.options.store.sceneRevision(lesson.id);emit({type:'status',sessionId:lesson.id,epoch,phase:'thinking'});
    if(admission)this.options.safety!.derive(lesson,[admission.task],'saved-content');
    let expectedSnapshot=JSON.stringify(lesson);
    const current=()=>{signal.throwIfAborted();if(!this.epochs.isCurrent(lesson.id,epoch))throw new Error('The lesson request was canceled.');if(admission){if(model!==this.options.model()||admission.identity!==this.options.provider.identity?.()||JSON.stringify(scope)!==JSON.stringify(this.options.provider.scope?.()))throw new Error('Your teaching connection changed. Ask your question again.');this.options.safety!.assertCurrent(admission.permit,admission.task);if(JSON.stringify(this.options.store.load(lesson.id))!==expectedSnapshot)throw new Error('Your lesson changed while the teacher was preparing a step. Ask your next question to continue.');}};
    const tool={type:'namespace',name:'teaching',description:'Present complete validated teaching steps on the learner’s local canvas.',tools:[{type:'function',name:'present_beat',description:'Present one brief explanation and a meaningful editable visual. Pause at a natural learner interaction point.',strict:true,parameters:this.options.teacher.getTeachingToolParameters()}]};
    const history=this.options.store.providerHistory(lesson.id,scope);
    let evidence:SourceExcerpt[]|undefined;
    if(this.options.evidence)try{evidence=await this.options.evidence(lesson,input.text);}catch(error){if(signal.aborted)return;this.activeSessions.delete(lesson.id);emit({type:'error',sessionId:lesson.id,epoch,message:error instanceof Error?error.message:'The source material could not be read.'});emit({type:'status',sessionId:lesson.id,epoch,phase:'paused'});return;}
    if(signal.aborted)return;
    if(this.options.safety&&evidence?.length){current();await this.options.safety.inspect(evidence,'study-material',signal);current();}
    const context=this.options.teacher.buildLessonContext(lesson,input.text,input.selectionIds,evidence);
    let suppliedEvidence:SourceExcerpt[]=[];
    if(lesson.plan?.sourceDocumentIds.length){try{suppliedEvidence=JSON.parse(context).sourceEvidence??[];}catch{throw new Error('Teaching source context could not be validated.');}}
    const items:unknown[]=[...history,{role:continuation?'developer':'user',content:context}];
    if(continuation)items.push({role:'developer',content:`Continue the ongoing lesson after the previous steps were actually presented. This is internal lesson progression, not a new learner message. Build on the visible explanation instead of restarting or paraphrasing its definition: deepen the mechanism, formal relationship, or worked example as appropriate. Automatic continuation round ${this.continuousRounds.get(lesson.id)??1}; pause with a purposeful prediction/application question before round 8. Use next=continue only while developing the explanation, next=ask when the learner should respond, or next=finish for a natural completed lesson.`});
    let repairs=0;
    try{
      for(let round=0;round<8;round++){
        current();
        const response=await completeTeaching(this.options.provider,{model,instructions:this.options.teacher.buildTeacherInstructions(),input:items,tools:[tool],scope,safetyPermit:admission?.permit,safetyTask:admission?.task},signal);
        current();if(this.options.safety){await this.options.safety.inspect(response,'model-output',signal);current();}
        if(response.modelMetadata)emit({type:'model',sessionId:lesson.id,epoch,metadata:response.modelMetadata});
        if(this.options.store.sceneRevision(lesson.id)!==sceneRevision)throw new Error('Your canvas changed while the teacher was preparing a step. Ask your next question to continue from your edits.');
        items.push(...response.output);const feedback:unknown[]=[];const staged:TeachingBeat[]=[];let accepted=0;
        for(const call of response.calls){
          if(call.namespace!=='teaching'||call.name!=='present_beat')throw new Error('The teaching service requested an unsupported action.');
          let output:Record<string,unknown>;
          let checkingSafety=false;
          try{
            if(accepted>=2)throw new Error('Present at most two short steps before waiting for the learner.');
            let beat=this.options.teacher.parseTeachingBeat(JSON.parse(call.arguments));beat={...beat,id:randomUUID()};
            if(lesson.plan){const progress=this.options.store.loadLearningProgress(lesson.id)!;if(beat.conceptId&&beat.conceptId!==progress.activeConceptId)throw new Error('Teach only the active roadmap concept.');if(!beat.chunks?.length)throw new Error('Provide short narration chunks and teaching cues for this planned concept.');beat={...beat,conceptId:progress.activeConceptId};if(lesson.plan.sourceDocumentIds.length)assertSuppliedSourceRefs(beat.sourceRefs??[],suppliedEvidence.map(item=>item.ref));this.options.validateSources?.(beat,lesson,suppliedEvidence);}
            if(!beat.next||!['continue','ask','finish'].includes(beat.next))throw new Error('Set next explicitly to continue, ask, or finish so the teacher can progress or pause deliberately.');
            if(this.options.safety){checkingSafety=true;this.options.safety.derive(beat,[response,lesson],'model-output');checkingSafety=false;}
            if(beat.simulation){if(!this.options.prepareSimulation)throw new Error('Local experiment runtime is unavailable. Use a static diagram without an experiment.');beat=await this.options.prepareSimulation(beat,signal);}
            current();
            if(this.options.store.sceneRevision(lesson.id)!==sceneRevision)throw new Error('Your canvas changed while the step was prepared. Preserve the learner’s edits and wait for a new question.');
            const merged=new Map(acceptedScene.map(entity=>[entity.id,entity]));for(const entity of beat.canvas.entities)merged.set(entity.id,{...merged.get(entity.id),...entity});
            acceptedScene=beat.canvas.mode==='replace'?beat.canvas.entities:[...merged.values()];
            if(this.options.safety){checkingSafety=true;this.options.safety.derive(beat,[response,lesson],'model-output');this.options.safety.derive(beat.narration,[beat],'narration');for(const chunk of adaptTeachingBeat(beat).chunks)this.options.safety.derive(chunk.text,[beat],'narration');this.options.safety.derive(acceptedScene,[beat,lesson],'saved-content');checkingSafety=false;}
            if(this.options.safety)checkingSafety=true;
            this.options.store.transaction(()=>{this.options.store.commitBeat(lesson.id,beat,acceptedScene);if(this.options.safety){this.options.safety.derive(adaptTeachingBeat(beat),[beat],'saved-content');this.options.safety.derive(this.options.store.load(lesson.id),[lesson,response,beat],'saved-content');}});
            checkingSafety=false;this.prepared.get(lesson.id)!.set(beat.id,{epoch,beat,narration:'',complete:false});sceneRevision=this.options.store.sceneRevision(lesson.id);staged.push(beat);accepted++;
            output={ok:true,prepared:true,presented:false,beatId:beat.id,entityIds:beat.canvas.entities.map(entity=>entity.id),...(beat.simulation?{simulationValidation:beat.simulation.validation}:{})};
          }catch(error){
            if(signal.aborted)return;
            if(checkingSafety||error instanceof LearnerSafetyError)throw error;
            output={ok:false,presented:false,diagnostics:error instanceof Error?error.message:'Teaching step could not be validated.',repairAttemptsRemaining:Math.max(0,2-repairs)};repairs++;
          }
          feedback.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)});
        }
        items.push(...feedback);
        current();
        this.options.store.transaction(()=>{this.options.store.recordProviderRound(lesson.id,response.output,feedback,response.modelMetadata,response.historyScope);this.options.safety?.derive(this.options.store.load(lesson.id),[lesson,response,...staged],'saved-content');});
        expectedSnapshot=JSON.stringify(this.options.store.load(lesson.id));
        if(accepted){emit({type:'status',sessionId:lesson.id,epoch,phase:'drawing'});for(const beat of staged)emit({type:'beat',sessionId:lesson.id,epoch,beat,baselineScene:this.options.store.loadAcceptedBaseline(lesson.id,beat.id)});emit({type:'status',sessionId:lesson.id,epoch,phase:'ready'});emit({type:'done',sessionId:lesson.id,epoch});return;}
        if(!response.calls.length)repairs++;
        if(repairs>2)throw new Error('This teaching step could not be prepared after two repairs. Your canvas is saved. Try asking for a simpler explanation.');
        if(!response.calls.length)items.push({role:'developer',content:response.repairDiagnostic??'Use teaching.present_beat to provide a complete teaching step and visual. Free text cannot be presented by this application.'});
      }
      throw new Error('The teaching service did not finish a step. Your lesson is saved; try again.');
    }catch(error){
      if(signal.aborted||!this.epochs.isCurrent(lesson.id,epoch))return;
      this.activeSessions.delete(lesson.id);
      const message=error instanceof Error?error.message:'The lesson could not continue. Your canvas is saved.';
      emit({type:'error',sessionId:lesson.id,epoch,message});emit({type:'status',sessionId:lesson.id,epoch,phase:'paused'});
    }
  }
}
