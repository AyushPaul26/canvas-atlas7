import {dialog,ipcMain,type BrowserWindow,type IpcMainInvokeEvent} from 'electron';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {SafetyGate} from './safety/contracts';
import {z} from 'zod';
import {voiceSettingsSchema,voiceQuerySchema,speechJobSchema,type SpeechJob} from '@living-canvas/protocol';
import type {SpeechProvider} from './voice/speech-provider';
import {canvasSchema,parseScene,assertBoundedJson,controlValuesSchema,LIMITS,PLAYBACK_LIMITS,sourceRefSchema,playbackCheckpointSchema,simulationArtifactSchema,simulationCheckpointSchema,type AppStatus,type ModelInfo,type TutorEvent,type VoiceStatus,type SimulationInput,type SimulationResult} from '@living-canvas/protocol';
import type {ChatGPTAuth} from './auth/chatgpt-auth';
import type {ChatGPTProvider} from './ai/chatgpt-provider';
import type {ProviderManager} from './ai/provider-manager';
import {sameProviderScope} from './ai/provider-contract';
import {apiProviderIdSchema,providerIdSchema,teachingKeyInputSchema,teachingSelectionInputSchema} from '@living-canvas/protocol';
import type {LessonCoordinator} from './ai/lesson-coordinator';
import type {SessionRepository} from './storage/session-repository';
import type {LearningPlanCoordinator} from './ai/learning-plan-coordinator';
import type {CourseCoordinator} from './ai/course-coordinator';
import type {DocumentService} from './documents/document-service';
import type {DocumentRepository} from './storage/document-repository';
import type {CourseRepository} from './storage/course-repository';
import type {LessonNotesService} from './notes/notes-service';
import {assertLearnerSafe} from '../../../../packages/teacher/src/learner-safety';
import {isLearnerSafetyMessage,SAFETY_LEGACY_MESSAGE} from '@living-canvas/protocol';

type Voice={status():Promise<VoiceStatus>;installModel(id:string):Promise<VoiceStatus>;transcribe(audio:ArrayBuffer):Promise<string>;synthesize(text:string,context?:SpeechJob):Promise<{samples:Float32Array;sampleRate:number}|null>;cancel():void};
type Services={safety?:SafetyGate;window:BrowserWindow;auth:ChatGPTAuth;provider:ChatGPTProvider;teaching?:ProviderManager;store:SessionRepository;coordinator:LessonCoordinator;planner?:LearningPlanCoordinator;courses?:CourseCoordinator;notes?:LessonNotesService;documents?:DocumentService;documentsReady?:Promise<void>;documentStore?:DocumentRepository;courseStore?:CourseRepository;voice:Voice;speech?:SpeechProvider;models:{list:ModelInfo[];selected?:string;available?:boolean;error?:string};runSimulation(input:SimulationInput):Promise<SimulationResult>;cancelSimulations?():void;readyToClose?():void};
const id=z.string().min(1).max(160).regex(/^[\w:.-]+$/);
const values=controlValuesSchema;
const notesTarget=z.object({sessionId:id,notesId:z.string().uuid()}).strict();
const message=z.object({sessionId:id,text:z.string().min(1).max(LIMITS.learnerRequestChars).refine(text=>Boolean(text.trim())),selectionIds:z.array(id).max(100).optional()}).strict();
const checkpoint=simulationCheckpointSchema;
const save=z.object({sessionId:id,scene:canvasSchema.shape.entities,controls:values.optional(),simulation:checkpoint.optional()}).strict();
const simulation=z.object({runId:id,artifact:simulationArtifactSchema,action:z.enum(['init','step','input','render']),state:z.unknown().optional(),tick:z.number().int().min(0).max(1e12),dt:z.number().finite().positive().max(.1).optional(),values:values.optional(),replay:checkpoint.optional()}).strict();

export function registerIpc(services:Services){
  const {window,auth,provider,store,coordinator,voice,models}=services;
  const admissions=new Map<string,AbortController>();let disposed=false;
  const alive=()=>{if(disposed||window.isDestroyed())throw new Error('Canvas Atlas is closing.');};
  const cancelAdmission=(requestId:string)=>{admissions.get(requestId)?.abort();admissions.delete(requestId);services.safety?.cancel(`admission:${requestId}`);};
  const cancelAdmissions=()=>{for(const requestId of [...admissions.keys()])cancelAdmission(requestId);};
  const onClosed=()=>{disposed=true;cancelAdmissions();};window.once?.('closed',onClosed);
  const cancelTeaching=()=>{cancelAdmissions();services.safety?.cancelAll();coordinator.cancelAll();services.planner?.cancelAll();services.courses?.cancelAll();services.notes?.cancelAll();};
  const requireService=<T>(service:T|undefined):T=>{if(!service)throw new Error('This desktop feature is unavailable. Restart Canvas Atlas.');return service;};
  models.selected??=store.getPreference('selectedModel');
  let accountGeneration=0,catalogRequest=0,selectionRevision=0;
  const emit=(event:TutorEvent)=>{if(!window.isDestroyed())window.webContents.send('lc:event',event);};
  const status=():AppStatus=>services.teaching?.status()??({...auth.status(),...(models.selected?{model:models.selected}:{}),...(models.available!==undefined?{modelAvailable:models.available}:{}),...(models.error?{error:models.error}:{})});
  const refreshModels=async()=>{
    if(services.teaching){const config=await services.teaching.refreshModels();const connection=config.connections.find(item=>item.providerId===config.activeProvider);models.list=connection?.models??[];models.selected=connection?.model;models.available=connection?.modelAvailable;models.error=connection?.error;emit({type:'auth',status:status()});return;}
    const currentRequest=++catalogRequest,account=accountGeneration,accountId=auth.status().account?.id;
    const catalog=await provider.listModels();
    if(currentRequest!==catalogRequest||account!==accountGeneration||accountId!==auth.status().account?.id||!auth.status().planEnabled)return;
    models.list=catalog;
    if(!models.selected&&catalog[0]){models.selected=catalog[0].id;store.setPreference('selectedModel',models.selected);}
    models.available=!!models.selected&&catalog.some(model=>model.id===models.selected);
    models.error=models.available?undefined:models.selected?`The selected model ${models.selected} is not available to this ChatGPT account. Choose another model in Settings.`:'ChatGPT did not provide an available model. Reconnect or check model access in Settings.';
    emit({type:'auth',status:status()});
  };
  const requireTeachingModel=async()=>{
    const account=accountGeneration,selection=selectionRevision;
    if(services.teaching){const scope=await services.teaching.ensureReady();if(!sameProviderScope(scope,services.teaching.scope()))throw new Error('Your teaching connection changed. Try again.');return {account,selection,model:scope.modelId,identity:services.teaching.identity()};}
    if(!auth.status().connected)throw new Error('Continue with ChatGPT to begin your lesson.');
    if(!auth.status().planEnabled)throw new Error('Continue with ChatGPT and enable access to your plan.');
    if(models.available!==true)await refreshModels();
    if(account!==accountGeneration||selection!==selectionRevision)throw new Error('Your account or model selection changed while the request was starting. Try again with the selected model.');
    if(!models.available||!models.selected)throw new Error(models.error??'The selected ChatGPT model is unavailable. Choose a model in Settings.');
    return {account,selection,model:models.selected};
  };
  const assertSelection=(expected:{account:number;selection:number;model:string;identity?:string})=>{if(services.teaching){if(expected.identity!==services.teaching.identity())throw new Error('Your teaching connection changed while the request was starting. Try again.');return;}if(expected.account!==accountGeneration||expected.selection!==selectionRevision||expected.model!==models.selected)throw new Error('Your account or model selection changed while the request was starting. Try again with the selected model.');};
  const ensureLesson=async(sessionId:string)=>{
    const lesson=store.load(sessionId);assertLearnerSafe(lesson,'saved-content');const safety=services.safety;
    if(!safety)return lesson;
    if(safety.isApproved(lesson)){safety.assertApproved(lesson,'saved-content');return lesson;}
    // Local policy still rejects a forbidden original before any online check.
    try{safety.assertApproved(lesson,'saved-content');}catch(error){if(!(error instanceof Error)||error.message!==SAFETY_LEGACY_MESSAGE)throw error;}
    let selected:Awaited<ReturnType<typeof requireTeachingModel>>;
    try{selected=await requireTeachingModel();}catch(error){if(isLearnerSafetyMessage(error))throw error;throw new Error(SAFETY_LEGACY_MESSAGE,{cause:error});}
    assertSelection(selected);const snapshot=JSON.stringify(lesson),task={operation:'saved-content' as const,originalRequest:lesson.topic,subjectId:sessionId,context:{lesson}};
    const permit=await safety.authorize(task);alive();assertSelection(selected);safety.assertCurrent(permit,task);
    await safety.inspect(lesson,'saved-content');alive();assertSelection(selected);safety.assertCurrent(permit,task);
    if(JSON.stringify(store.load(sessionId))!==snapshot)throw new Error('The saved lesson changed during review. Open it again.');
    safety.assertApproved(lesson,'saved-content');return lesson;
  };
  const checkMutation=async(sessionId:string,input:unknown,beatId?:string)=>{
    const prior=await ensureLesson(sessionId),snapshot=JSON.stringify(prior),parents:unknown[]=[prior],safety=services.safety;
    if(safety&&beatId){const accepted=store.loadAcceptedBeat(sessionId,beatId);if(accepted){if(!safety.isApproved(accepted)){try{safety.derive(accepted,[prior],'saved-content');}catch(error){if(!isLearnerSafetyMessage(error))throw error;await safety.inspect(accepted,'saved-content');}}parents.push(accepted);}}
    if(safety&&!safety.isApproved(input)){try{safety.derive(input,parents,'saved-content');}catch(error){if(!isLearnerSafetyMessage(error))throw error;const review={lesson:prior,update:input};await safety.inspect(review,'saved-content');safety.derive(input,[review],'saved-content');}}
    const current=()=>{alive();if(JSON.stringify(store.load(sessionId))!==snapshot)throw new Error('The lesson changed while this update was being checked. Try again.');};
    current();return {prior,input,parents,current};
  };
  const commitMutation=(sessionId:string,checked:Awaited<ReturnType<typeof checkMutation>>,mutation:()=>unknown)=>{
    const operation=()=>{checked.current();const result=mutation();services.safety?.derive(store.load(sessionId),[checked.prior,checked.input,...checked.parents],'saved-content');return result;};
    return services.safety?store.transaction(operation):mutation();
  };
  const ensureRestoration=async(sessionId:string,returning=false)=>{
    const lesson=await ensureLesson(sessionId),safety=services.safety;if(!safety)return lesson;
    const branch=returning?store.loadBranchPlayback(sessionId):undefined,checkpoint=branch?.checkpoint??store.loadPlayback(sessionId);
    if(checkpoint){const accepted=store.loadAcceptedBeat(sessionId,checkpoint.cursor.beatId);if(accepted&&!safety.isApproved(accepted)){try{safety.derive(accepted,[lesson],'saved-content');}catch(error){if(!isLearnerSafetyMessage(error))throw error;await safety.inspect(accepted,'saved-content');}}if(accepted){safety.derive(accepted.narration,[accepted],'narration');for(const chunk of accepted.chunks)safety.derive(chunk.text,[accepted],'narration');}if(branch&&!safety.isApproved(branch)){try{safety.derive(branch,[lesson,...(accepted?[accepted]:[])],'saved-content');}catch(error){if(!isLearnerSafetyMessage(error))throw error;await safety.inspect(branch,'saved-content');}}if(!safety.isApproved(checkpoint)){try{safety.derive(checkpoint,[lesson,...(accepted?[accepted]:[]),...(branch?[branch]:[])],'saved-content');}catch(error){if(!isLearnerSafetyMessage(error))throw error;await safety.inspect(checkpoint,'saved-content');}}}
    alive();if(JSON.stringify(store.load(sessionId))!==JSON.stringify(lesson))throw new Error('The saved explanation changed during review. Open it again.');return lesson;
  };
  const reviewDocuments=async(documentIds:string[])=>{if(!services.safety)return;const documents=requireService(services.documents);for(const documentId of documentIds)await documents.reviewDocument(documentId);alive();};
  const ensureCourse=async(courseId:string)=>{
    const course=requireService(services.courseStore).loadCourse(courseId);if(!course)throw new Error('This course was not found.');assertLearnerSafe(course,'saved-content');
    const safety=services.safety;if(!safety)return course;const snapshot=JSON.stringify(course);await reviewDocuments(course.documentIds);
    if(!safety.isApproved(course)){
      const selected=await requireTeachingModel();assertSelection(selected);const documents=requireService(services.documents);
      const task={operation:'course' as const,originalRequest:course.title,subjectId:`course:${courseId}`,context:{course,materials:course.documentIds.map(documentId=>({documentId,sections:documents.getSections(documentId)}))}};
      const permit=await safety.authorize(task);alive();assertSelection(selected);safety.assertCurrent(permit,task);await safety.inspect(course,'saved-content');alive();assertSelection(selected);safety.assertCurrent(permit,task);
    }
    if(JSON.stringify(requireService(services.courseStore).loadCourse(courseId))!==snapshot)throw new Error('The saved course changed during review. Open it again.');safety.assertApproved(course,'saved-content');return course;
  };
  const trusted=(event:IpcMainInvokeEvent)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Untrusted desktop request.');};
  const handlers:Record<string,(value:any,context?:unknown)=>unknown>={
    getLessonNotes:value=>requireService(services.notes).latest(id.parse(value)),
    generateLessonNotes:(value:unknown)=>{const input=z.object({sessionId:id,mode:z.enum(['ai','local']).optional()}).strict().parse(value);return requireService(services.notes).generate(input.sessionId,async()=>{const selected=await requireTeachingModel();assertSelection(selected);},input.mode??'ai');},
    cancelSafetyAdmission:value=>cancelAdmission(id.parse(value)),
    cancelLessonNotes:value=>requireService(services.notes).cancel(id.parse(value)),
    openLessonNotes:value=>{const input=notesTarget.parse(value);return requireService(services.notes).open(input.sessionId,input.notesId);},
    exportLessonNotes:async(value:unknown)=>{const input=notesTarget.parse(value),notes=requireService(services.notes),record=await notes.latest(input.sessionId);const title=(record?.title??'Study notes').replace(/[^\p{L}\p{N}\s_-]/gu,'').slice(0,70).trim();const result=await dialog.showSaveDialog(window,{title:'Save study notes PDF',defaultPath:`Canvas Atlas - ${title||'Study notes'}.pdf`,filters:[{name:'PDF document',extensions:['pdf']}]});if(result.canceled||!result.filePath)return {canceled:true};const bytes=await notes.pdfBytes(input.sessionId,input.notesId);await writeFile(result.filePath,bytes);return {canceled:false,path:result.filePath};},
    planTopic:async(value:unknown)=>{const input=z.object({sessionId:id,level:z.string().max(2000).optional()}).strict().parse(value);assertLearnerSafe(store.load(input.sessionId),'saved-content');if(input.level)assertLearnerSafe(input.level,'learner-input');const selected=await requireTeachingModel();assertSelection(selected);return requireService(services.planner).planTopic(input);},
    startConcept:async(value:unknown)=>{const input=z.object({sessionId:id,conceptId:id}).strict().parse(value);assertLearnerSafe(store.load(input.sessionId),'saved-content');const selected=await requireTeachingModel();assertSelection(selected);services.notes?.cancel(input.sessionId);await coordinator.startConcept(input);},
    savePlayback:async(value:unknown)=>{assertBoundedJson(JSON.stringify(value),PLAYBACK_LIMITS.bytes+1024,{maxNodes:PLAYBACK_LIMITS.nodes+10,maxDepth:PLAYBACK_LIMITS.depth+1});const input=z.object({sessionId:id,epoch:z.number().int().min(0),checkpoint:playbackCheckpointSchema}).strict().parse(value);assertLearnerSafe(input.checkpoint,'saved-content');if(!services.safety)return coordinator.savePlayback(input);const checked=await checkMutation(input.sessionId,input,input.checkpoint.cursor.beatId);return commitMutation(input.sessionId,checked,()=>coordinator.savePlayback(input));},
    resumePlayback:async(value:unknown)=>{const input=z.object({sessionId:id,mode:z.enum(['resume','replay'])}).strict().parse(value);await ensureRestoration(input.sessionId);return coordinator.resumePlayback(input);},
    returnToLesson:async(value:unknown)=>{const input=z.object({sessionId:id}).strict().parse(value),prior=await ensureRestoration(input.sessionId,true);if(!services.safety)return coordinator.returnToLesson(input);const branch=store.loadBranchPlayback(input.sessionId);return store.transaction(()=>{alive();const restored=coordinator.returnToLesson(input),parents=[prior,restored.beat,...(branch?[branch]:[])];if(restored.checkpoint)services.safety!.derive(restored.checkpoint,parents,'saved-content');services.safety!.derive(store.load(input.sessionId),[...parents,...(restored.checkpoint?[restored.checkpoint]:[])],'saved-content');return restored;});},
    importStudyMaterial:async(value:unknown)=>{
      const input=z.object({jobId:id.optional()}).strict().optional().parse(value);const documents=requireService(services.documents);
      const selected=await dialog.showOpenDialog(window,{title:'Upload Study Material',properties:['openFile','multiSelections'],filters:[{name:'Study material',extensions:['pdf','txt','md','markdown']}]});
      if(selected.canceled||!selected.filePaths.length)return [];
      const imported=await documents.importPaths(selected.filePaths,{jobId:input?.jobId,existingDocumentIds:[]});
      for(const manifest of imported)requireService(services.documentStore).saveDocument(manifest,documents.getSections(manifest.id));return imported;
    },
    cancelDocumentImport:value=>requireService(services.documents).cancelImport(id.parse(value)),
    getDocuments:()=>requireService(services.documents).listDocuments(),
    getSourceExcerpt:async(value:unknown)=>{const ref=sourceRefSchema.parse(value);await reviewDocuments([ref.documentId]);return requireService(services.documents).getSourceExcerpt(ref);},
    getSourcePreview:async(value:unknown)=>{const ref=sourceRefSchema.parse(value);await reviewDocuments([ref.documentId]);return requireService(services.documents).getSourcePreview(ref);},
    planCourse:async(value:unknown)=>{const input=z.object({documentIds:z.array(id).min(1).max(5)}).strict().parse(value);const selected=await requireTeachingModel();assertSelection(selected);await reviewDocuments(input.documentIds);assertSelection(selected);return requireService(services.courses).planCourse(input);},
    getCourses:()=>requireService(services.courseStore).listCourses().map(course=>{if(!services.safety)return requireService(services.courses).loadCourse(course.id);if(services.safety.isApproved(course))return course;const title='Course awaiting safety review';return {id:course.id,title,documentIds:[],sessionIds:[],lessons:[],createdAt:course.createdAt,updatedAt:course.updatedAt,plan:{id:'review',version:1,title,sourceDocumentIds:[],concepts:[]},progress:{planId:'review',planVersion:1,activeConceptId:'review',conceptStates:{},status:'planned'}};}),
    loadCourse:async(value:unknown)=>{const courseId=id.parse(value),raw=services.safety?await ensureCourse(courseId):undefined,result=requireService(services.courses).loadCourse(courseId);if(raw)services.safety!.derive(result,[raw],'saved-content');return result;},
    startCourseLesson:async(value:unknown)=>{const input=z.object({courseId:id,lessonId:id}).strict().parse(value);if(!services.safety)return requireService(services.courses).startCourseLesson(input);const course=await ensureCourse(input.courseId),linked=course.lessons?.find(lesson=>lesson.id===input.lessonId)?.sessionId,linkedLesson=linked?await ensureLesson(linked):undefined;return store.transaction(()=>{alive();const lesson=requireService(services.courses).startCourseLesson(input);services.safety!.derive(lesson,[course,...(linkedLesson?[linkedLesson]:[])],'saved-content');const updated=requireService(services.courseStore).loadCourse(course.id);services.safety!.derive(updated,[course,lesson],'saved-content');return lesson;});},
    readyToClose:()=>services.readyToClose?.(),
    getStatus:()=>status(),
    getTeachingConfiguration:()=>requireService(services.teaching).configuration(),
    refreshTeachingModels:value=>requireService(services.teaching).refreshModels(providerIdSchema.parse(value)),
    selectTeachingProvider:value=>{cancelAdmissions();return requireService(services.teaching).select(teachingSelectionInputSchema.parse(value));},
    connectTeachingKey:value=>{cancelAdmissions();const input=teachingKeyInputSchema.parse(value);return requireService(services.teaching).connectKey(input.providerId,input.key);},
    clearTeachingKey:value=>{cancelAdmissions();return requireService(services.teaching).clearKey(apiProviderIdSchema.parse(value));},
    signIn:async()=>{if(services.teaching){await auth.signIn();services.teaching.authChanged();if(services.teaching.id==='chatgpt')await refreshModels();const result=status();emit({type:'auth',status:result});return result;}const account=++accountGeneration;catalogRequest++;cancelTeaching();await auth.signIn();if(account!==accountGeneration)return status();models.list=[];models.available=undefined;models.error=undefined;let error:string|undefined;if(auth.status().planEnabled)try{await refreshModels();}catch(e){error=e instanceof Error?e.message:'ChatGPT models are unavailable.';}const result={...status(),...(error?{error}:{})};emit({type:'auth',status:result});return result;},
    signOut:async()=>{cancelAdmissions();if(services.teaching){await auth.signOut();services.teaching.authChanged();const result=status();emit({type:'auth',status:result});return result;}accountGeneration++;catalogRequest++;cancelTeaching();voice.cancel();services.cancelSimulations?.();models.list=[];models.available=undefined;models.error=undefined;const result=await auth.signOut();emit({type:'auth',status:result});return result;},
    getModels:async()=>{if(services.teaching)return services.teaching.getModels();if(!auth.status().planEnabled)return [];await refreshModels();return models.list;},
    setModel:async(value:unknown)=>{cancelAdmissions();const selected=z.string().min(1).max(200).parse(value);if(services.teaching){await services.teaching.select({providerId:services.teaching.id,modelId:selected});return status();}if(!auth.status().planEnabled||!models.list.some(model=>model.id===selected))throw new Error('Choose a model available to this ChatGPT account.');cancelTeaching();selectionRevision++;catalogRequest++;models.selected=selected;models.available=true;models.error=undefined;store.setPreference('selectedModel',selected);const result=status();emit({type:'auth',status:result});return result;},
    getSessions:()=>store.list().map(summary=>{try{assertLearnerSafe(summary,'saved-content');if(!services.safety||services.safety.isApproved({id:summary.id,title:summary.title,topic:summary.topic}))return summary;}catch(error){if(!isLearnerSafetyMessage(error))throw error;if(!services.safety)return {...summary,title:'Lesson hidden by safety checks',topic:'Choose another learning topic or delete this lesson.'};}return {...summary,title:'Lesson awaiting safety review',topic:'Connect your teaching service to review this saved lesson.'};}),
    loadSession:value=>ensureLesson(id.parse(value)),
    createSession:async(value:unknown)=>{const input=typeof value==='string'?{topic:value,requestId:randomUUID()}:z.object({topic:z.string(),requestId:id}).strict().parse(value),raw=z.string().min(1).max(LIMITS.learnerRequestChars).refine(text=>Boolean(text.trim())).parse(input.topic);assertLearnerSafe(raw,'learner-input');if(!services.safety)return store.create(raw.trim());cancelAdmission(input.requestId);const controller=new AbortController();admissions.set(input.requestId,controller);const task={operation:'topic' as const,originalRequest:raw,subjectId:`admission:${input.requestId}`};try{const permit=await services.safety.authorize(task,controller.signal);controller.signal.throwIfAborted();alive();services.safety.assertCurrent(permit,task);return store.transaction(()=>{controller.signal.throwIfAborted();alive();services.safety!.assertCurrent(permit,task);const created=store.create(raw.trim()),lesson=store.load(created.id);services.safety!.derive(lesson,[raw],'saved-content');return lesson;});}finally{if(admissions.get(input.requestId)===controller)admissions.delete(input.requestId);}},
    sendMessage:async(value:unknown)=>{const input=message.parse(value);assertLearnerSafe(input.text,'learner-input');assertLearnerSafe(store.load(input.sessionId),'saved-content');const selected=await requireTeachingModel();assertSelection(selected);services.notes?.cancel(input.sessionId);await coordinator.send(input);},
    continueLesson:async(value:unknown)=>{const input=z.object({sessionId:id,epoch:z.number().int().min(0)}).strict().parse(value);const selected=await requireTeachingModel();assertSelection(selected);await coordinator.continueLesson(input);},
    interrupt:value=>{const sessionId=id.parse(value);services.safety?.cancel(sessionId);coordinator.interrupt(sessionId);services.notes?.cancel(sessionId);},
    presentProgress:async(value:unknown)=>{const input=z.object({sessionId:id,epoch:z.number().int().min(0),beatId:id,scene:canvasSchema.shape.entities,narration:z.string().max(8000),complete:z.boolean()}).strict().parse(value);assertLearnerSafe(input,'saved-content');if(!services.safety)return coordinator.presentProgress(input);const checked=await checkMutation(input.sessionId,input,input.beatId);return commitMutation(input.sessionId,checked,()=>coordinator.presentProgress(input));},
    saveScene:async(value:unknown)=>{assertBoundedJson(JSON.stringify(value),LIMITS.saveBytes,{maxNodes:LIMITS.saveNodes,maxDepth:LIMITS.envelopeDepth});const input=save.parse(value);parseScene(input.scene);assertLearnerSafe(input,'saved-content');const current=await ensureLesson(input.sessionId);if(JSON.stringify(current.scene)===JSON.stringify(input.scene)&&JSON.stringify(current.controls)===JSON.stringify(input.controls??current.controls)&&JSON.stringify(current.simulation)===JSON.stringify(input.simulation??current.simulation))return;if(!services.safety)return store.saveScene(input.sessionId,input.scene,input.controls,input.simulation);const checked=await checkMutation(input.sessionId,input);return commitMutation(input.sessionId,checked,()=>store.saveScene(input.sessionId,input.scene,input.controls,input.simulation));},
    deleteSession:async value=>{const sessionId=id.parse(value);coordinator.interrupt(sessionId);services.planner?.cancel(sessionId);await services.notes?.remove(sessionId);store.delete(sessionId);},
    exportLesson:async(value:unknown)=>{const sessionId=id.parse(value);const lesson=await ensureLesson(sessionId);const data=store.export(sessionId);const result=await dialog.showSaveDialog(window,{title:'Export lesson',defaultPath:`${lesson.title.replace(/[^\w\s-]/g,'').slice(0,60)||'Lesson'}.canvas-atlas.json`,filters:[{name:'Canvas Atlas lesson',extensions:['json']}]});if(result.canceled||!result.filePath)return {canceled:true};await writeFile(result.filePath,data,{encoding:'utf8'});return {canceled:false,path:result.filePath};},
    voiceStatus:()=>voice.status(),installVoiceModel:value=>voice.installModel(id.parse(value)),
    transcribeAudio:value=>{if(!(value instanceof ArrayBuffer)||value.byteLength>16*1024*1024)throw new Error('Microphone recording exceeds the allowed size.');return voice.transcribe(value);},
    synthesizeSpeech:(value,context)=>{const text=z.string().max(8000).parse(value);assertLearnerSafe(text,'narration');services.safety?.assertApproved(text,'narration');return voice.synthesize(text,context===undefined?undefined:speechJobSchema.parse(context));},
    cancelSpeech:value=>requireService(services.speech).cancelSpeech(id.parse(value)),
    getVoiceConfiguration:()=>requireService(services.speech).configuration(),
    saveVoiceConfiguration:value=>requireService(services.speech).configure(voiceSettingsSchema.parse(value)),
    setElevenLabsKey:value=>requireService(services.speech).setKey(z.string().trim().min(16).max(512).regex(/^\S+$/).parse(value)),
    clearElevenLabsKey:()=>requireService(services.speech).clearKey(),
    listElevenLabsVoices:value=>requireService(services.speech).listVoices(voiceQuerySchema.parse(value??{})),
    runSimulation:value=>{assertBoundedJson(JSON.stringify(value),LIMITS.simulationRequestBytes,{maxNodes:LIMITS.simulationRequestNodes,maxDepth:LIMITS.envelopeDepth});return services.runSimulation(simulation.parse(value));},
  };
  const needsMaterials=new Set(['importStudyMaterial','getDocuments','getSourceExcerpt','getSourcePreview','planCourse','getCourses','loadCourse','startCourseLesson']);
  const teachingCommands=new Set(['startConcept','sendMessage','continueLesson']);
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle(`lc:${name}`,async(event,value,context?:unknown)=>{
    trusted(event);
    const sourceLesson=services.documentsReady&&teachingCommands.has(name)&&value&&typeof value==='object'&&'sessionId' in value&&store.load(id.parse(value.sessionId)).plan?.sourceDocumentIds.length;
    if(services.documentsReady&&(needsMaterials.has(name)||sourceLesson)){
      await services.documentsReady;
      if(window.isDestroyed())throw new Error('Canvas Atlas is closing.');
    }
    return handler(value,context);
  });
  return {refreshModels,status,dispose(){disposed=true;cancelAdmissions();window.removeListener?.('closed',onClosed);for(const name of Object.keys(handlers))ipcMain.removeHandler(`lc:${name}`);}};
}
