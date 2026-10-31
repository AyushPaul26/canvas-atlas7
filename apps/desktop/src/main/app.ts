import {app,dialog,safeStorage} from 'electron';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setImmediate as yieldToWindow} from 'node:timers/promises';
import * as teacher from '@living-canvas/teacher';
import type {ModelInfo,TeachingBeat,TutorEvent} from '@living-canvas/protocol';
import {createMainWindow} from './window';
import {CredentialStore} from './auth/credential-store';
import {ChatGPTAuth} from './auth/chatgpt-auth';
import {ChatGPTProvider} from './ai/chatgpt-provider';
import {ProviderManager} from './ai/provider-manager';
import {ApiKeyStore} from './auth/api-key-store';
import {GeminiProvider} from './ai/gemini-provider';
import {GroqProvider} from './ai/groq-provider';
import {LessonCoordinator} from './ai/lesson-coordinator';
import {SessionRepository} from './storage/session-repository';
import {DocumentRepository} from './storage/document-repository';
import {CourseRepository} from './storage/course-repository';
import {DocumentService} from './documents/document-service';
import {ElectronDocumentHost} from './documents/document-host';
import {SourceIndex} from './documents/source-index';
import {LearningPlanCoordinator} from './ai/learning-plan-coordinator';
import {CourseCoordinator} from './ai/course-coordinator';
import {registerIpc} from './ipc-router';
import {installCloseHandshake} from './close-handshake';
import {createDesktopFetch} from './network';
import {APPLICATION_ID,PRODUCT_NAME,resolveUserDataDirectory} from './identity';
import {createWindowActivation} from './startup-lifecycle';
import {createStartupDiagnostics} from './startup-diagnostics';
import {SpeechProvider} from './voice/speech-provider';
import {ElevenLabsKeyStore} from './voice/elevenlabs-key-store';
import {NotesCoordinator} from './notes/notes-coordinator';
import {NotesPdfService} from './notes/notes-pdf';
import {NotesRepository} from './notes/notes-repository';
import {LessonNotesService} from './notes/notes-service';
import {isLearnerSafetyMessage,VOICE_PREVIEW_TEXT} from '@living-canvas/protocol';
import {LearnerSafetyError} from '../../../../packages/teacher/src/learner-safety';
import {SafetyGuardian} from './safety/guardian';
import {loadSafetyReceiptKey} from './safety/receipt-key';
import {createSafetyAudit} from './safety/audit';

export interface DesktopLaunchOptions {userDataPath?:string;show?:boolean;onWindowCreated?:(window:ReturnType<typeof createMainWindow>)=>void}
let startupDiagnostics:ReturnType<typeof createStartupDiagnostics>|undefined;
export async function launchDesktop(options:DesktopLaunchOptions={}){
  app.setPath('userData',resolveUserDataDirectory(app.getPath('appData'),options.userDataPath??process.env.LIVING_CANVAS_USER_DATA));
  await app.whenReady();
  const startup=startupDiagnostics=createStartupDiagnostics(app.getPath('userData'));startup.mark('starting');
  const directory=fileURLToPath(new URL('.',import.meta.url));
  const {shell}=await import('electron');
  const request=createDesktopFetch();
  const auth=new ChatGPTAuth({store:new CredentialStore(join(app.getPath('userData'),'chatgpt-credentials.enc'),safeStorage),openExternal:url=>shell.openExternal(url),fetch:request});
  const store=new SessionRepository(join(app.getPath('userData'),'lessons.sqlite'));
  startup.mark('database-ready');
  const window=createMainWindow({preloadPath:join(directory,'../preload/app-bridge.cjs'),rendererPath:join(directory,'../renderer'),devUrl:process.env.ELECTRON_RENDERER_URL,show:options.show,deferLoad:true});
  options.onWindowCreated?.(window);startup.mark('window-created');
  let disposed=false;
  const emit=(event:TutorEvent)=>{if(!window.isDestroyed())window.webContents.send('lc:event',event);};
  const provider=new ChatGPTProvider(auth,request);const models:{list:ModelInfo[];selected?:string;available?:boolean;error?:string}={list:[]};
  const keyStores={gemini:new ApiKeyStore(join(app.getPath('userData'),'gemini-key.enc'),safeStorage),groq:new ApiKeyStore(join(app.getPath('userData'),'groq-key.enc'),safeStorage)};
  let cancelForTeachingChange=()=>{};
  const teaching=new ProviderManager({auth,providers:{chatgpt:provider,gemini:new GeminiProvider(()=>keyStores.gemini.load()?.key,request),groq:new GroqProvider(()=>keyStores.groq.load()?.key,request)},keyStores,preferences:store,onBeforeChange:()=>cancelForTeachingChange(),onChange:()=>emit({type:'auth',status:teaching.status()})});
  const receiptKey=loadSafetyReceiptKey(join(app.getPath('userData'),'safety-receipts-key.enc'),safeStorage);
  const safety=new SafetyGuardian({classify:(evaluation,signal)=>teaching.classifySafety(evaluation,signal),identity:()=>teaching.identity(),secret:receiptKey.secret,audit:createSafetyAudit(store),...(receiptKey.persistent?{preferences:store}:{})});
  for(const phrase of [VOICE_PREVIEW_TEXT,'What would you like to learn today?'])safety.registerTrusted(phrase);
  teaching.attachSafety(safety);
  const documentStore=new DocumentRepository(store.db),courseStore=new CourseRepository(store.db);
  const documents=new DocumentService({safety,rootDirectory:join(app.getPath('userData'),'materials'),onProgress:progress=>emit({type:'document-progress',progress}),hostFactory:()=>new ElectronDocumentHost({rendererHtml:join(directory,'../renderer/document.html'),preloadPath:join(directory,'../preload/document-port-bootstrap.cjs'),devUrl:process.env.ELECTRON_RENDERER_URL?new URL('document.html',process.env.ELECTRON_RENDERER_URL).toString():undefined})});
  // Materials can be numerous; their readiness gates material operations, not home.
  const documentsReady=documents.initialize().then(async()=>{
    for(const manifest of documents.listDocuments()){
      await yieldToWindow();if(disposed)return;
      documentStore.saveDocument(manifest,documents.getSections(manifest.id));
    }
    startup.mark('materials-ready');
  }).catch(error=>{
    startup.mark('materials-failed',error);
    throw new Error('Saved study materials could not load. Restart Canvas Atlas and check startup.log in the app data folder.',{cause:error});
  });
  void documentsReady.catch(()=>{});
  const sourceIndex=new SourceIndex(store.db);
  const {createVoiceService}=await import('./voice/voice-worker-manager');
  let speech:SpeechProvider|undefined;
  const localVoice=createVoiceService({modelDirectory:join(app.getPath('userData'),'voice'),resourcesPath:app.isPackaged?process.resourcesPath:resolve('resources'),fetch:request,onProgress:status=>speech?.handleLocalStatus(status)});
  const voice=speech=new SpeechProvider({safety,local:localVoice,keyStore:new ElevenLabsKeyStore(join(app.getPath('userData'),'elevenlabs-key.enc'),safeStorage),preferences:store,request,onStatus:status=>{if(!window.isDestroyed())window.webContents.send('lc:voiceProgress',status);}});
  const {createSimulationService}=await import('./sandbox/sandbox-window');
  const simulations=createSimulationService({safety,rendererUrl:process.env.ELECTRON_RENDERER_URL?new URL('simulation.html',process.env.ELECTRON_RENDERER_URL).toString():undefined,rendererFile:join(directory,'../renderer/simulation.html'),preloadPath:join(directory,'../preload/port-bootstrap.cjs')});
  const selectedModel=()=>teaching.status().model;
  const planner=new LearningPlanCoordinator({safety,store,provider:teaching,model:selectedModel});
  const courses=new CourseCoordinator({safety,sessions:store,documents:documentStore,courses:courseStore,provider:teaching,model:selectedModel});
  const notes=new LessonNotesService({safety,sessions:store,coordinator:new NotesCoordinator({safety,sessions:store,provider:teaching,model:selectedModel}),pdf:new NotesPdfService({parent:window}),repository:new NotesRepository({safety,rootDirectory:join(app.getPath('userData'),'notes'),preferences:store})});
  const coordinator=new LessonCoordinator({safety,store,provider:teaching,teacher,model:selectedModel,emit,cancelLocal:()=>{voice.cancel();},evidence:async(lesson,question)=>{
    const plan=lesson.plan;if(!plan?.sourceDocumentIds.length)return [];
    for(const id of plan.sourceDocumentIds){const source=documentStore.loadDocument(id);if(!source)throw new Error('The study material is unavailable.');await safety.inspect(source,'study-material');}
    sourceIndex.replace(plan.sourceDocumentIds.flatMap(id=>documentStore.getSections(id)));
    const concept=plan.concepts.find(concept=>concept.id===lesson.learningProgress?.activeConceptId);
    return sourceIndex.retrieveEvidence({documentIds:plan.sourceDocumentIds,query:`${concept?.title??''} ${question}`,sourceRefs:concept?.sourceRefs});
  },validateSources:(beat,lesson)=>{if(!lesson.plan?.sourceDocumentIds.length)return;if(!beat.sourceRefs?.length)throw new Error('A source-based teaching step must cite the supplied material.');for(const ref of beat.sourceRefs){if(!lesson.plan.sourceDocumentIds.includes(ref.documentId))throw new Error('Teaching cites an unselected source.');documentStore.assertSourceRef(ref);}},prepareSimulation:async(beat:TeachingBeat,signal:AbortSignal)=>{
    signal.throwIfAborted();const artifact=beat.simulation!;
    const result=await simulations.run({runId:`preflight:${randomUUID()}`,artifact,action:'init',tick:0,values:Object.fromEntries(artifact.controls.map(control=>[control.id,control.value]))});
    signal.throwIfAborted();if(result.error){if(isLearnerSafetyMessage(result.error))throw new LearnerSafetyError('simulation-frame');throw new Error(`Experiment could not run: ${result.error}. Correct it or use a static visual.`);}
    return {...beat,simulation:{...artifact,validation:'illustrative'}};
  }});
  cancelForTeachingChange=()=>{safety.cancelAll();coordinator.cancelAll();planner.cancelAll();courses.cancelAll();notes.cancelAll();voice.cancel();simulations.cancelAll();};
  const closing=installCloseHandshake(window,emit);
  const router=registerIpc({safety,window,auth,provider,teaching,store,coordinator,planner,courses,notes,documents,documentsReady,documentStore,courseStore,voice,speech:voice,models,runSimulation:input=>simulations.run(input),cancelSimulations:()=>simulations.cancelAll(),readyToClose:()=>closing.acknowledge()});
  const dispose=()=>{if(disposed)return;disposed=true;safety.dispose();closing.dispose();router.dispose();notes.dispose();teaching.dispose();coordinator.cancelAll();planner.cancelAll();courses.cancelAll();voice.dispose();simulations.dispose();store.close();};
  window.on('closed',dispose);
  startup.mark('services-ready');
  if(process.env.ELECTRON_RENDERER_URL)await window.loadURL(process.env.ELECTRON_RENDERER_URL);else await window.loadFile(join(directory,'../renderer/index.html'));
  startup.mark('renderer-ready');
  return {window,auth,store,close:()=>{dispose();if(!window.isDestroyed())window.destroy();}};
}

app.setName(PRODUCT_NAME);
app.setPath('userData',resolveUserDataDirectory(app.getPath('appData'),process.env.LIVING_CANVAS_USER_DATA));
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.setAppUserModelId(APPLICATION_ID);
  const activation=createWindowActivation();
  app.on('second-instance',activation.activate);
  void launchDesktop({onWindowCreated:activation.attach}).catch(error=>{
    const startup=startupDiagnostics??createStartupDiagnostics(app.getPath('userData'));startup.mark('failed',error);
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`,`The local desktop runtime could not be initialized. Restart the app or run the installer to repair its files. Startup details: ${startup.path}`);app.quit();
  });
  app.on('window-all-closed',()=>app.quit());
}
