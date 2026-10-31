import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {providerIdSchema,type LessonSession,type SceneEntity,type SessionSummary,type TeachingBeat,type SimulationCheckpoint,type ModelRunMetadata,type LearningPlan,type LearningProgress,type PlaybackCheckpoint,type AdaptedTeachingBeat} from '@living-canvas/protocol';
import {sameProviderScope,type ProviderScope} from '../ai/provider-contract';
import {adaptTeachingBeat,parseTeachingBeat,parseScene,learningPlanSchema,learningProgressSchema,playbackCheckpointSchema,initialLearningProgress,assertProgressForPlan,assertSourceRef,assertBoundedJson,PLAYBACK_LIMITS,learnerEvidenceSchema,type LearnerEvidence} from '@living-canvas/protocol';
import {openDatabase,checkDatabaseVersion,databaseTransaction} from './database';

type Row={snapshot:string;event_seq:number};
export class SessionRepository {
  readonly db:ReturnType<typeof openDatabase>;
  private readonly ownsDatabase:boolean;
  constructor(path:string|DatabaseSync){this.ownsDatabase=typeof path==='string';this.db=typeof path==='string'?openDatabase(path):path;this.checkVersion();}
  checkVersion(){
    checkDatabaseVersion(this.db);
  }
  transaction<T>(work:()=>T):T {
    return databaseTransaction(this.db,work);
  }
  create(topic:string):LessonSession {
    this.checkVersion();
    const now=new Date().toISOString();
    const lesson:LessonSession={id:randomUUID(),title:topic.slice(0,80),topic,createdAt:now,updatedAt:now,messages:[],beats:[],scene:[],controls:{}};
    this.db.prepare('INSERT INTO sessions(id,topic,title,created_at,updated_at,snapshot) VALUES(?,?,?,?,?,?)').run(lesson.id,topic,lesson.title,now,now,JSON.stringify(lesson));
    return lesson;
  }
  list():SessionSummary[]{
    this.checkVersion();
    return (this.db.prepare('SELECT snapshot FROM sessions ORDER BY updated_at DESC').all() as {snapshot:string}[]).map(row=>{
      const lesson=JSON.parse(row.snapshot) as LessonSession;return {id:lesson.id,title:lesson.title,topic:lesson.topic,updatedAt:lesson.updatedAt,messageCount:lesson.messages.length};
    });
  }
  load(id:string):LessonSession {
    this.checkVersion();const row=this.db.prepare('SELECT snapshot FROM sessions WHERE id=?').get(id) as {snapshot:string}|undefined;
    if(!row)throw new Error('This lesson was not found.');
    const lesson=JSON.parse(row.snapshot) as LessonSession;
    lesson.beats=lesson.beats.map(adaptTeachingBeat);
    const plan=this.loadPlan(id),learningProgress=this.loadLearningProgress(id),playback=this.loadPlayback(id);
    if(plan)lesson.plan=plan;if(learningProgress)lesson.learningProgress=learningProgress;if(playback)lesson.playback=playback;
    lesson.learnerEvidence=this.readLearnerEvidence(id,{conceptId:learningProgress?.activeConceptId});
    return lesson;
  }
  private persist(lesson:LessonSession){lesson.updatedAt=new Date().toISOString();this.db.prepare('UPDATE sessions SET updated_at=?,snapshot=? WHERE id=?').run(lesson.updatedAt,JSON.stringify(lesson),lesson.id);}
  sceneRevision(id:string):number{return (this.db.prepare('SELECT revision FROM scene_snapshots WHERE session_id=?').get(id) as {revision:number}|undefined)?.revision??0;}
  append(id:string,expectedSeq:number,event:unknown):number {
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT snapshot,event_seq FROM sessions WHERE id=?').get(id) as Row|undefined;
      if(!row)throw new Error('This lesson was not found.');
      if(row.event_seq!==expectedSeq)throw new Error('Lesson event sequence conflict.');
      const payload=JSON.stringify(event);
      if(payload.length>2_000_000)throw new Error('Lesson event exceeds local storage limit.');
      const seq=expectedSeq+1;
      this.db.prepare('INSERT INTO events(session_id,seq,created_at,payload) VALUES(?,?,?,?)').run(id,seq,new Date().toISOString(),payload);
      this.db.prepare('UPDATE sessions SET event_seq=? WHERE id=?').run(seq,id);return seq;
    });
  }
  events(id:string):unknown[]{return (this.db.prepare('SELECT payload FROM events WHERE session_id=? ORDER BY seq').all(id) as {payload:string}[]).map(row=>JSON.parse(row.payload));}
  private record(id:string,event:unknown){const row=this.db.prepare('SELECT event_seq FROM sessions WHERE id=?').get(id) as {event_seq:number};this.append(id,row.event_seq,event);}
  recordProviderRound(id:string,output:unknown[],feedback:unknown[],metadata?:ModelRunMetadata,scope?:ProviderScope){
    this.transaction(()=>{
      let safe:ModelRunMetadata|undefined;
      if(metadata){
        const valid=(value:unknown):value is string=>typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9][\w:./-]*$/.test(value);
        if(!valid(metadata.requestedModel)||!Number.isFinite(Date.parse(metadata.completedAt)))throw new Error('Invalid completed model metadata.');
        safe={requestedModel:metadata.requestedModel,completedAt:new Date(metadata.completedAt).toISOString(),...(valid(metadata.servedModel)?{servedModel:metadata.servedModel}:{}),...(valid(metadata.responseId)?{responseId:metadata.responseId}:{}),...(providerIdSchema.safeParse(metadata.providerId).success?{providerId:metadata.providerId}:{})};
        const lesson=this.load(id);lesson.modelRuns=[...(lesson.modelRuns??[]),safe];this.persist(lesson);
      }
      const safeScope=scope?{providerId:providerIdSchema.parse(scope.providerId),modelId:String(scope.modelId).slice(0,200),credentialRevision:String(scope.credentialRevision).slice(0,200),...(scope.accountId?{accountId:String(scope.accountId).slice(0,200)}:{})}:undefined;
      this.record(id,{type:'provider-round',output,feedback,...(safe?{modelMetadata:safe}:{}),...(safeScope?{scope:safeScope}:{})});
    });
  }
  providerHistory(id:string,scope?:ProviderScope):unknown[]{
    const rounds=this.events(id).filter((event:any)=>event.type==='provider-round').slice(-4) as {output:unknown[];feedback:unknown[];scope?:ProviderScope}[];
    const result:unknown[]=[];let length=0;
    for(const round of rounds.reverse()){
      if(scope&&!sameProviderScope(scope,round.scope))break;
      const items=[...round.output,...round.feedback];const size=JSON.stringify(items).length;
      if(length+size>48000)break;length+=size;result.unshift(...items);
    }
    return result;
  }
  addMessage(id:string,role:'student'|'tutor',text:string){
    this.transaction(()=>{const lesson=this.load(id);const message={id:randomUUID(),role,text,createdAt:new Date().toISOString()};lesson.messages.push(message);this.persist(lesson);this.record(id,{type:'message',message});});
  }
  commitBeat(id:string,beat:TeachingBeat,acceptedBaseline?:SceneEntity[]){
    this.transaction(()=>{
      const lesson=this.load(id),safe=parseTeachingBeat(beat);
      const existing=this.loadAcceptedBeat(id,safe.id);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(adaptTeachingBeat(safe)))throw new Error('An accepted teaching beat is immutable.');return;}
      const merged=new Map(lesson.scene.filter(entity=>entity.semanticRole!=='learner-note').map(entity=>[entity.id,entity]));
      for(const entity of safe.canvas.entities)merged.set(entity.id,{...merged.get(entity.id),...entity});
      const baseline=parseScene(acceptedBaseline??(safe.canvas.mode==='replace'?safe.canvas.entities:[...merged.values()]));
      this.db.prepare('INSERT INTO accepted_beats(session_id,beat_id,payload,baseline) VALUES(?,?,?,?)').run(id,safe.id,JSON.stringify(safe),JSON.stringify(baseline));
      this.record(id,{type:'prepared-beat',beat:safe});
    });
  }
  loadAcceptedBeat(id:string,beatId:string):AdaptedTeachingBeat|undefined{
    this.checkVersion();
    const row=this.db.prepare('SELECT payload FROM accepted_beats WHERE session_id=? AND beat_id=?').get(id,beatId) as {payload:string}|undefined;
    if(row)return adaptTeachingBeat(JSON.parse(row.payload) as TeachingBeat);
    // Older full prepared segments survive in the event log. Visible snapshots are never promoted to accepted content.
    const prepared=this.events(id).find((event:any)=>event?.type==='prepared-beat'&&event.beat?.id===beatId) as {beat:TeachingBeat}|undefined;
    return prepared?adaptTeachingBeat(prepared.beat):undefined;
  }
  loadAcceptedBaseline(id:string,beatId:string):SceneEntity[]|undefined{
    this.checkVersion();const row=this.db.prepare('SELECT baseline FROM accepted_beats WHERE session_id=? AND beat_id=?').get(id,beatId) as {baseline:string}|undefined;return row?JSON.parse(row.baseline):undefined;
  }
  savePlan(id:string,input:LearningPlan):void{
    const plan=learningPlanSchema.parse(input);
    this.transaction(()=>{
      this.load(id);
      for(const concept of plan.concepts)for(const ref of concept.sourceRefs){const row=this.db.prepare('SELECT payload FROM document_sections WHERE document_id=? AND extraction_version=? AND id=?').get(ref.documentId,ref.extractionVersion,ref.sectionId) as {payload:string}|undefined;assertSourceRef(ref,row?[JSON.parse(row.payload)]:[]);}
      const row=this.db.prepare('SELECT payload FROM learning_plans WHERE id=? AND version=?').get(plan.id,plan.version) as {payload:string}|undefined;
      if(row&&row.payload!==JSON.stringify(plan))throw new Error('An accepted learning plan version is immutable.');
      this.db.prepare('INSERT OR IGNORE INTO learning_plans(id,version,payload) VALUES(?,?,?)').run(plan.id,plan.version,JSON.stringify(plan));
      const previous=this.loadPlan(id);
      this.db.prepare('INSERT INTO session_plans VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET plan_id=excluded.plan_id,plan_version=excluded.plan_version').run(id,plan.id,plan.version);
      if(previous?.id!==plan.id||previous.version!==plan.version){this.db.prepare('INSERT INTO concept_progress VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(initialLearningProgress(plan)));this.db.prepare('DELETE FROM playback_checkpoints WHERE session_id=?').run(id);}
    });
  }
  loadPlan(id:string):LearningPlan|undefined{
    this.checkVersion();const row=this.db.prepare('SELECT p.payload FROM learning_plans p JOIN session_plans s ON s.plan_id=p.id AND s.plan_version=p.version WHERE s.session_id=?').get(id) as {payload:string}|undefined;return row?learningPlanSchema.parse(JSON.parse(row.payload)):undefined;
  }
  loadLearningProgress(id:string):LearningProgress|undefined{
    this.checkVersion();const row=this.db.prepare('SELECT payload FROM concept_progress WHERE session_id=?').get(id) as {payload:string}|undefined;return row?learningProgressSchema.parse(JSON.parse(row.payload)):undefined;
  }
  saveLearningProgress(id:string,input:LearningProgress):void{
    const progress=learningProgressSchema.parse(input);
    this.transaction(()=>{
      const plan=this.loadPlan(id);if(!plan)throw new Error('This lesson has no learning plan.');assertProgressForPlan(progress,plan);
      const previous=this.loadLearningProgress(id),checkpoint=this.loadPlayback(id),receipt=checkpoint?.receipt;
      for(const [conceptId,state] of Object.entries(progress.conceptStates)){
        if(previous?.conceptStates[conceptId]==='completed'&&state!=='completed')throw new Error('Review cannot erase acknowledged concept coverage.');
        if((state==='completed'||state==='checking')&&previous?.conceptStates[conceptId]!==state&&previous?.conceptStates[conceptId]!=='completed'){
          const accepted=receipt&&this.loadAcceptedBeat(id,receipt.beatId);
          if(!accepted||accepted.conceptId!==conceptId||receipt.planId!==plan.id||receipt.planVersion!==plan.version||receipt.audioResult!=='completed'||!receipt.visualComplete||accepted.chunks.some(chunk=>!receipt.completedChunkIds.includes(chunk.id))||accepted.cues.some(cue=>!receipt.appliedCueIds.includes(cue.id)))throw new Error('Concept coverage requires an acknowledged successful presentation.');
        }
      }
      this.db.prepare('INSERT INTO concept_progress VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(progress));
    });
  }
  savePlayback(id:string,input:PlaybackCheckpoint):void{
    const checkpoint=playbackCheckpointSchema.parse(input);
    this.transaction(()=>{
      const beat=this.loadAcceptedBeat(id,checkpoint.cursor.beatId);if(!beat)throw new Error('Playback requires an immutable accepted teaching beat.');
      const chunks=new Set(beat.chunks.map(chunk=>chunk.id)),cues=new Set(beat.cues.map(cue=>cue.id));
      if(!chunks.has(checkpoint.cursor.chunkId)||checkpoint.completedChunkIds.some(chunk=>!chunks.has(chunk))||checkpoint.appliedCueIds.some(cue=>!cues.has(cue)))throw new Error('Playback references an unknown chunk or cue.');
      const baseline=this.loadAcceptedBaseline(id,beat.id);if(baseline&&JSON.stringify(baseline)!==JSON.stringify(checkpoint.baselineScene))throw new Error('Accepted scene baseline is immutable.');
      const plan=this.loadPlan(id),receipt=checkpoint.receipt;
      // Older sessions have no roadmap. Their explicit legacy receipt remains
      // bound to the accepted beat and playback pass, but cannot create coverage.
      if(receipt&&(plan?(receipt.planId!==plan.id||receipt.planVersion!==plan.version):(receipt.planId!=='legacy'||receipt.planVersion!==1)))throw new Error('Playback receipt references a different plan version.');
      this.db.prepare('INSERT INTO playback_checkpoints(session_id,payload) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(checkpoint));
      if(checkpoint.progress)this.saveLearningProgress(id,checkpoint.progress);
    });
  }
  loadPlayback(id:string):PlaybackCheckpoint|undefined{
    this.checkVersion();const row=this.db.prepare('SELECT payload FROM playback_checkpoints WHERE session_id=?').get(id) as {payload:string}|undefined;if(!row)return undefined;
    const parsed=playbackCheckpointSchema.safeParse(JSON.parse(row.payload));return parsed.success?parsed.data:undefined;
  }
  presentProgress(id:string,beat:TeachingBeat,progress:{epoch:number;scene:SceneEntity[];narration:string;complete:boolean}){
    this.transaction(()=>{
      const lesson=this.load(id);const existing=lesson.beats.findIndex(item=>item.id===beat.id);
      const visibleBeat={...beat,chunks:undefined,cues:undefined,narration:progress.narration,canvas:{mode:'replace' as const,entities:progress.scene}};
      if(existing<0){
        lesson.beats.push(visibleBeat);
        if(beat.simulation){const values=Object.fromEntries(beat.simulation.controls.map(control=>[control.id,control.value]));lesson.controls=values;lesson.simulation={artifact:beat.simulation,state:null,tick:0,values,initialValues:values,inputs:[]};}
        else if(beat.canvas.mode==='replace'){delete lesson.simulation;lesson.controls={};}
      }else lesson.beats[existing]=visibleBeat;
      lesson.scene=progress.scene;
      if(progress.narration){
        const index=lesson.messages.findIndex(message=>message.id===beat.id&&message.role==='tutor');
        const message={id:beat.id,role:'tutor' as const,text:progress.narration,createdAt:index<0?new Date().toISOString():lesson.messages[index].createdAt};
        if(index<0)lesson.messages.push(message);else lesson.messages[index]=message;
      }
      this.persist(lesson);this.record(id,{type:'presentation-progress',beatId:beat.id,epoch:progress.epoch,narrationLength:progress.narration.length,visibleEntityIds:progress.scene.map(entity=>entity.id),complete:progress.complete});
      this.db.prepare('INSERT INTO scene_snapshots(session_id,revision,payload) VALUES(?,0,?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(progress.scene));
    });
  }
  // Omission preserves an experiment during ordinary canvas edits; null explicitly restores its absence.
  saveScene(id:string,scene:SceneEntity[],controls?:Record<string,number|string|boolean>,simulation?:SimulationCheckpoint|null){
    this.transaction(()=>{const lesson=this.load(id);lesson.scene=scene;if(controls)lesson.controls=controls;if(simulation===null)delete lesson.simulation;else if(simulation)lesson.simulation=simulation;this.persist(lesson);
      this.db.prepare('INSERT INTO scene_snapshots(session_id,revision,payload) VALUES(?,1,?) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1,payload=excluded.payload').run(id,JSON.stringify(scene));
    });
  }
  getPreference(key:string):string|undefined{return (this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key) as {value:string}|undefined)?.value;}
  recordLearnerEvidence(input:LearnerEvidence):void{
    const evidence=learnerEvidenceSchema.parse(input);assertBoundedJson(JSON.stringify(evidence),64*1024,{maxNodes:32,maxDepth:2});
    const plan=this.loadPlan(evidence.sessionId);if(!plan||plan.id!==evidence.planId||plan.version!==evidence.planVersion||!plan.concepts.some(concept=>concept.id===evidence.conceptId))throw new Error('Understanding evidence does not match this lesson.');
    this.db.prepare('INSERT INTO learner_evidence(id,session_id,observed,inference,created_at) VALUES(?,?,?,NULL,?)').run(evidence.id,evidence.sessionId,JSON.stringify(evidence),evidence.createdAt);
  }
  readLearnerEvidence(sessionId:string,options:{conceptId?:string;limit?:number}={}):LearnerEvidence[]{
    const limit=Math.min(20,Math.max(1,Math.floor(options.limit??20))),result:LearnerEvidence[]=[];
    const rows=this.db.prepare(`SELECT e.observed FROM learner_evidence e WHERE (e.session_id=? OR EXISTS(SELECT 1 FROM course_sessions a JOIN course_sessions b ON a.course_id=b.course_id WHERE a.session_id=? AND b.session_id=e.session_id)) ORDER BY e.created_at DESC,e.rowid DESC LIMIT 200`).all(sessionId,sessionId) as {observed:string}[];
    for(const row of rows){const parsed=learnerEvidenceSchema.safeParse(assertBoundedJson(row.observed,64*1024,{maxNodes:32,maxDepth:2}));if(parsed.success&&(!options.conceptId||parsed.data.conceptId===options.conceptId)){result.push(parsed.data);if(result.length>=limit)break;}}
    return result.reverse();
  }
  saveBranchPlayback(id:string,input:{checkpoint:PlaybackCheckpoint;progress:LearningProgress}):void{
    const value={checkpoint:playbackCheckpointSchema.parse(input.checkpoint),progress:learningProgressSchema.parse(input.progress)};
    assertBoundedJson(JSON.stringify(value),PLAYBACK_LIMITS.bytes+64*1024,{maxNodes:PLAYBACK_LIMITS.nodes+1024,maxDepth:PLAYBACK_LIMITS.depth+1});
    const plan=this.loadPlan(id);if(!plan||!this.loadAcceptedBeat(id,value.checkpoint.cursor.beatId))throw new Error('The interrupted explanation is unavailable.');assertProgressForPlan(value.progress,plan);
    this.setPreference(`branch-playback:${id}`,JSON.stringify(value));
  }
  loadBranchPlayback(id:string):{checkpoint:PlaybackCheckpoint;progress:LearningProgress}|undefined{
    const text=this.getPreference(`branch-playback:${id}`);if(!text)return undefined;
    const value=assertBoundedJson(text,PLAYBACK_LIMITS.bytes+64*1024,{maxNodes:PLAYBACK_LIMITS.nodes+1024,maxDepth:PLAYBACK_LIMITS.depth+1}) as {checkpoint:unknown;progress:unknown};
    const checkpoint=playbackCheckpointSchema.parse(value.checkpoint),progress=learningProgressSchema.parse(value.progress),plan=this.loadPlan(id);
    if(!plan||!this.loadAcceptedBeat(id,checkpoint.cursor.beatId))throw new Error('The interrupted explanation is unavailable.');assertProgressForPlan(progress,plan);return {checkpoint,progress};
  }
  clearBranchPlayback(id:string):void{this.db.prepare('DELETE FROM preferences WHERE key=?').run(`branch-playback:${id}`);}
  setPreference(key:string,value:string){this.db.prepare('INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  delete(id:string){this.transaction(()=>{this.clearBranchPlayback(id);this.db.prepare('DELETE FROM preferences WHERE key=?').run(`lesson-notes:${id}`);this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);});}
  export(id:string):string{return JSON.stringify({format:'living-canvas-lesson',version:1,lesson:this.load(id)},null,2);}
  close(){if(this.ownsDatabase)this.db.close();}
}
