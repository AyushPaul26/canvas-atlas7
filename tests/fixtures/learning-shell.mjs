// Test-only backend. Loads the shipped renderer/preload with deterministic lesson
// content and PCM; never connects an account or performs network inference.
import {app, BrowserWindow, ipcMain} from 'electron';
import {join} from 'node:path';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const root = process.env.ATLAS_FIXTURE_ROOT;
const outputRoot = process.env.ATLAS_PACKAGED_OUT ?? join(process.cwd(),'apps/desktop/out');
mkdirSync(root, {recursive:true});
app.setPath('userData',join(root,'electron'));
const stateFile=join(root,'state.json');
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{sessions:[],accepted:{},checkpoints:{},stats:{plans:0,starts:0,complete:0,continues:0},epoch:0};
state.stats.audioRequests??=[];state.stats.resumes??=[];
globalThis.__atlasFixture=state;
const persist=()=>writeFileSync(stateFile,JSON.stringify(state));
let window;
let closing=false;
const status={connected:true,planEnabled:true,desktop:true,model:'fixture',modelAvailable:true};
const session=id=>{const value=state.sessions.find(item=>item.id===id);if(!value)throw Error('Missing fixture session');return value;};
const emit=event=>window.webContents.send('lc:event',event);
const concept=(id,title)=>({id,title,objectives:[id==='force'?'Predict how mass and distance affect attraction':'Explain how gravity changes a planet’s direction'],prerequisiteIds:id==='orbit'?['force']:[],sourceRefs:[]});
const makeBeat=(conceptId,answer=false)=>{
  const chunks=conceptId==='orbit'?[{id:'orbit-start',text:'Gravity continually changes the direction of a moving planet.'}]:answer?[{id:'answer',text:'Exactly: double the distance and the force becomes one quarter.'}]:[{id:'attraction',text:'Objects with mass attract each other. '},{id:'distance',text:'Double the distance and the force falls to one quarter.'}];
  const entities=[{id:'mass-a',kind:'circle',x:270,y:300,radius:42,fill:'#7775E7',label:'First mass'},{id:'mass-b',kind:'circle',x:620,y:300,radius:27,fill:'#C3E9D7',label:'Second mass'},{id:'equation',kind:'equation',x:310,y:460,text:'F = G \\frac{m_1m_2}{r^2}',fontSize:28},{id:'distance-label',kind:'text',x:380,y:190,text:'Gravity and distance',fontSize:26}];
  const spatialScene=state.spatial?{nodes:[{id:'spatial-mass',kind:'sphere',position:[-1.5,0,0],scale:[.8,.8,.8],material:'blue',label:'First mass',segments:16},{id:'spatial-target',kind:'box',position:[1.5,0,0],scale:[.6,.6,.6],material:'green',label:'Second mass'},{id:'spatial-force',kind:'arrow',position:[-1.5,0,0],scale:[2.5,.3,.3],material:'orange',label:'Attraction'}],camera:{position:[4,3,7],target:[0,0,0]},fallbackDescription:'Two masses attract. Increasing their separation reduces the gravitational force.'}:undefined;
  const movingMass=state.motionPath?{type:'path',targetId:'mass-b',points:[{x:620,y:300},{x:620,y:150},{x:760,y:150},{x:760,y:300}],durationMs:6000}:{type:'tween',targetId:'mass-b',property:'x',from:620,to:760,durationMs:1200};
  return {id:`beat-${++state.epoch}`,conceptId,narration:chunks.map(chunk=>chunk.text).join(''),chunks,cues:chunks.length===2?[{id:'hide-equation',chunkId:'attraction',at:'start',action:{type:'visibility',targetId:'equation',visible:false}},{id:'show-equation',chunkId:'distance',at:'start',action:{type:'visibility',targetId:'equation',visible:true}},{id:'move-mass',chunkId:'distance',at:'start',action:movingMass}]:[],canvas:{mode:'replace',entities},...(spatialScene?{spatialScene}:{}),next:conceptId==='force'&&!answer?'ask':'finish',...(conceptId==='force'&&!answer?{question:'What happens to force when distance doubles?'}:{})};
};
const teach=(id,conceptId,answer=false)=>{
  const value=session(id),beat=makeBeat(conceptId,answer);state.accepted[beat.id]=beat;state.stats.starts++;
  value.learningProgress.activeConceptId=conceptId;value.learningProgress.status='teaching';
  if(value.learningProgress.conceptStates[conceptId]!=='completed')value.learningProgress.conceptStates[conceptId]='teaching';
  emit({type:'beat',sessionId:id,epoch:state.epoch,beat,baselineScene:beat.canvas.entities});emit({type:'done',sessionId:id,epoch:state.epoch});persist();
};
const handlers={
  cancelSafetyAdmission:()=>{},
  getStatus:()=>status,getModels:()=>[{id:'fixture',name:'Fixture'}],setModel:()=>status,signIn:()=>status,signOut:()=>({...status,connected:false}),getLessonNotes:()=>null,
  voiceStatus:()=>({recognitionReady:false,synthesisReady:true,neuralReady:true,voiceName:'Test PCM'}),
  synthesizeSpeech:text=>{if(state.failAudio)throw Error('Fixture audio failure');state.stats.audioRequests.push(text);persist();return {samples:new Float32Array(state.motionPath&&text.startsWith('Double the distance')?240000:48000),sampleRate:24000};},
  getSessions:()=>state.sessions.map(value=>({id:value.id,title:value.title,topic:value.topic,updatedAt:value.updatedAt,messageCount:value.messages.length})),
  createSession:input=>{const topic=typeof input==='string'?input:input.topic;const date=new Date().toISOString();const value={id:`session-${state.sessions.length+1}`,topic,title:topic,createdAt:date,updatedAt:date,messages:[],beats:[],scene:[],controls:{}};state.sessions.push(value);persist();return value;},
  loadSession:id=>({...session(id),playback:state.checkpoints[id]}),
  planTopic:({sessionId})=>{const value=session(sessionId);state.stats.plans++;value.plan={id:'fixture-plan',version:1,title:'Gravitation',sourceDocumentIds:[],concepts:[concept('force','Attraction and distance'),concept('orbit','Planetary motion')]};value.learningProgress={planId:value.plan.id,planVersion:1,activeConceptId:'force',conceptStates:{force:'planned',orbit:'planned'},status:'planned'};persist();return value.plan;},
  startConcept:({sessionId,conceptId})=>teach(sessionId,conceptId),
  savePlayback:({sessionId,checkpoint})=>{state.checkpoints[sessionId]=checkpoint;persist();},
  presentProgress:({sessionId,beatId,scene,narration,complete})=>{const value=session(sessionId),beat=state.accepted[beatId];value.scene=scene;if(!value.beats.some(item=>item.id===beatId))value.beats.push(beat);const message={id:beatId,role:'tutor',text:narration,createdAt:new Date().toISOString()};const index=value.messages.findIndex(item=>item.id===beatId);if(index<0)value.messages.push(message);else value.messages[index]=message;if(complete){const receipt=state.checkpoints[sessionId]?.receipt;if(!receipt||receipt.beatId!==beatId||receipt.audioResult!=='completed'||!receipt.visualComplete||beat.chunks.some(chunk=>!receipt.completedChunkIds.includes(chunk.id)))throw Error('Completion requires actual audio and visual receipts');state.stats.complete++;value.learningProgress.status=beat.next==='ask'?'checking':'paused';if(beat.next==='ask')value.learningProgress.pendingCheck={conceptId:beat.conceptId,question:beat.question};else{value.learningProgress.conceptStates[beat.conceptId]='completed';delete value.learningProgress.pendingCheck;}}persist();},
  continueLesson:({sessionId})=>{state.stats.continues++;const value=session(sessionId);const next=value.plan.concepts.find(item=>value.learningProgress.conceptStates[item.id]==='planned');if(next)teach(sessionId,next.id);},
  sendMessage:({sessionId,text})=>{const value=session(sessionId);value.messages.push({id:`question-${Date.now()}`,role:'student',text,createdAt:new Date().toISOString()});teach(sessionId,value.learningProgress.activeConceptId,true);},
  resumePlayback:({sessionId,mode})=>{const checkpoint=state.checkpoints[sessionId];if(!checkpoint)throw Error('No playback');state.stats.resumes.push({mode,checkpoint});persist();return {beat:state.accepted[checkpoint.cursor.beatId],checkpoint,epoch:++state.epoch,mode:mode==='replay'||checkpoint.receipt?'replay':'resume'};},
  interrupt:()=>{state.epoch++;},readyToClose:()=>{closing=true;window.destroy();},saveScene:({sessionId,scene,controls})=>{Object.assign(session(sessionId),{scene,controls});persist();},
  getCourses:()=>[],getDocuments:()=>[],deleteSession:id=>{state.sessions=state.sessions.filter(value=>value.id!==id);persist();},exportLesson:()=>({canceled:true}),
};
app.whenReady().then(async()=>{
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle(`lc:${name}`,(_event,value)=>handler(value));
  window=new BrowserWindow({width:1440,height:940,show:false,webPreferences:{backgroundThrottling:false,preload:join(outputRoot,'preload/app-bridge.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.on('close',event=>{if(!closing){event.preventDefault();emit({type:'closing'});}});
  await window.loadFile(join(outputRoot,'renderer/index.html'));
});
app.on('window-all-closed',()=>app.quit());
