# Integration contract — implementation batch 1

Product root: C:/Users/Ayush Paul/Desktop/learner guide/living-canvas
Spec/plans: ../docs/superpowers/
Root owns packages/protocol, packages/scene, packages/simulation, packages/teacher, packages/timeline, sandbox runner/preload.
Backend worker owns project config/package files and Electron main/auth/provider/storage/app preload. Do not edit renderer UI.
UI worker owns apps/desktop/src/renderer except simulation.html and sandbox scripts. Do not edit package.json or protocol.
Voice worker owns packages/voice, apps/desktop/src/main/voice, resources/models and native helper/voice scripts. Do not edit UI or main app/IPC router.
No worker may read cached Codex/ChatGPT credentials. Use new official app sign-in. No fake teaching responses in production. No subagents from workers; root handles integration/review.
Use root npm scripts and import protocol from @living-canvas/protocol, teacher from @living-canvas/teacher, scene from @living-canvas/scene. Root exposes these via TS aliases/workspace packages.

## Protocol (root will implement these types)
AppStatus = { connected:boolean; planEnabled:boolean; account?:{id:string;name?:string;email?:string}; model?:string; error?:string; desktop:boolean }
ModelInfo = {id:string; name:string}
SceneEntity = {id:string; kind:'text'|'line'|'arrow'|'circle'|'ellipse'|'rect'|'path'|'equation'|'plot'; x:number; y:number; width?:number; height?:number; radius?:number; text?:string; label?:string; points?:number[]; stroke?:string; fill?:string; fontSize?:number; strokeWidth?:number; opacity?:number; rotation?:number; semanticRole?:string }
Control = {id:string;label:string;type:'slider'|'number'|'toggle'|'select';value:number|boolean|string;min?:number;max?:number;step?:number;options?:string[];unit?:string}
SimulationArtifact = {id:string;title:string;source:string;controls:Control[];assumptions:string[];validation?:'illustrative'|'quantitative_checked'|'unresolved'}
TeachingBeat = {id:string;narration:string;title?:string;canvas:{mode:'replace'|'append'|'update';entities:SceneEntity[]};simulation?:SimulationArtifact;question?:string}
LessonMessage = {id:string;role:'student'|'tutor';text:string;createdAt:string}
LessonSession = {id:string;title:string;topic:string;createdAt:string;updatedAt:string;messages:LessonMessage[];beats:TeachingBeat[];scene:SceneEntity[];controls:Record<string,number|boolean|string>}
SessionSummary = {id:string;title:string;topic:string;updatedAt:string;messageCount:number}
TutorEvent = {type:'status';sessionId:string;phase:'thinking'|'drawing'|'speaking'|'ready'|'paused';epoch:number} | {type:'beat';sessionId:string;beat:TeachingBeat;epoch:number} | {type:'error';sessionId?:string;message:string;epoch?:number} | {type:'done';sessionId:string;epoch:number} | {type:'auth';status:AppStatus}
VoiceStatus (voice worker/root align) = {recognitionReady:boolean; synthesisReady:boolean; downloading?:string; progress?:number; error?:string}

## Window bridge exposed by backend via contextBridge
window.livingCanvas:
  getStatus(): Promise<AppStatus>
  signIn(): Promise<AppStatus>
  signOut(): Promise<AppStatus>
  getModels(): Promise<ModelInfo[]>
  setModel(id:string): Promise<AppStatus>
  getSessions(): Promise<SessionSummary[]>
  loadSession(id:string): Promise<LessonSession>
  createSession(topic:string): Promise<LessonSession>
  sendMessage(input:{sessionId:string;text:string;selectionIds?:string[]}): Promise<void>
  interrupt(sessionId:string): Promise<void>
  saveScene(input:{sessionId:string;scene:SceneEntity[];controls?:Record<string,number|boolean|string>}): Promise<void>
  deleteSession(id:string): Promise<void>
  exportLesson(id:string): Promise<{canceled:boolean;path?:string}>
  onEvent(callback:(event:TutorEvent)=>void): ()=>void
  voiceStatus(): Promise<VoiceStatus>
  installVoiceModel(modelId:string): Promise<VoiceStatus>
  transcribeAudio(audio:ArrayBuffer): Promise<string>  (mono16k WAV)
  synthesizeSpeech(text:string): Promise<{samples:Float32Array;sampleRate:number}|null>
  onVoiceProgress(callback:(status:VoiceStatus)=>void): ()=>void
  runSimulation(input:{runId:string;artifact:SimulationArtifact;action:'init'|'step'|'input'|'render';state?:unknown;tick:number;dt?:number;values?:Record<string,number|boolean|string>}): Promise<{state:unknown;entities:SceneEntity[];measurements?:Record<string,number|string>;error?:string}>

Backend import from @living-canvas/teacher:
  buildTeacherInstructions():string
  buildLessonContext(session:LessonSession, request:string, selectedIds?:string[]):string
  parseTeachingBeat(value:unknown):TeachingBeat
Root will supply these and generic simulation service. Backend can wire dynamic imports until files exist, no fake implementations.
Provider should use official function tool named present_beat, namespaced as required documented route; return a complete validated beat for each completed call and execute only after validation. Root can assist normalization.
Backend should pass actual messages/tool feedback back to subsequent planning calls, detect completed stream. Never return hardcoded gravitation content.

## UI behavior
Use window.livingCanvas only for real data. Browser preview may use a clearly disclosed local preview adapter for persistence/UI; signing in/inference remain unavailable there, no mock lesson injection.
Home => Start => exact prompt "What would you like to learn today?" => free topic => lesson workspace.
Disconnected user can explore/start topic entry, but trying to teach shows clear Connect ChatGPT action. No fabricated tutoring.
Voice browser fallback uses only localService speechSynthesis voices. Never use remote SpeechRecognition.
Root will supply runSimulation bridge; UI evaluates returned scene entities only, never eval/source scripts.

