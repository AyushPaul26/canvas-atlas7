import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {dialog} from 'electron';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {SAFETY_DANGEROUS_MESSAGE,SAFETY_LEGACY_MESSAGE,SAFETY_REVIEW_MESSAGE,SAFETY_SEXUAL_MESSAGE} from '@living-canvas/protocol';
import {IntentSafetyError,reviewDecision} from '../../packages/teacher/src/intent-policy';
const mocked=vi.hoisted(()=>({handlers:new Map<string,(event:any,value?:any)=>Promise<any>>()}));
vi.mock('electron',()=>({ipcMain:{handle:(name:string,handler:any)=>mocked.handlers.set(name,handler),removeHandler:(name:string)=>mocked.handlers.delete(name)},dialog:{showSaveDialog:vi.fn()}}));
import {registerIpc} from '../../apps/desktop/src/main/ipc-router';
const allowed={decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:1,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};
const disposals:Array<()=>void>=[];
function setup(connected=true,extra:Record<string,unknown>={}){
  const store=new SessionRepository(':memory:'),frame={},state={connected,destroyed:false};
  const window={webContents:{mainFrame:frame,send:vi.fn()},isDestroyed:()=>state.destroyed};
  const classify=vi.fn(async(_input:any,_signal:AbortSignal):Promise<unknown>=>allowed);
  const safety=new SafetyGuardian({secret:new Uint8Array(32).fill(7),classify,preferences:store});
  const coordinator={cancelAll:vi.fn(),interrupt:vi.fn(),send:vi.fn(async()=>{}),startConcept:vi.fn(async()=>{}),continueLesson:vi.fn(async()=>{}),resumePlayback:vi.fn(),returnToLesson:vi.fn(),presentProgress:vi.fn(),savePlayback:vi.fn()};
  const voice={synthesize:vi.fn(async()=>null),cancel:vi.fn()};
  const registration=registerIpc({window,store,safety,coordinator,voice,auth:{status:()=>({desktop:true,connected:state.connected,planEnabled:state.connected})},provider:{},models:{list:[{id:'fixture',name:'Fixture'}],selected:'fixture',available:true},runSimulation:vi.fn(),...extra} as any);
  disposals.push(()=>{registration.dispose();safety.dispose();store.close();});
  const event={sender:window.webContents,senderFrame:frame};const invoke=(name:string,value?:unknown)=>mocked.handlers.get(`lc:${name}`)!(event,value);
  return {store,state,safety,classify,coordinator,voice,window,invoke};
}
beforeEach(()=>mocked.handlers.clear());afterEach(()=>{for(const dispose of disposals.splice(0))dispose();});
describe('intent-aware trusted IPC admission',()=>{
  it('evaluates the exact original topic before creating any session or roadmap',async()=>{
    const f=setup(),original='  A context-dependent request about a bicycle  ';
    f.classify.mockResolvedValueOnce({...allowed,decision:'BLOCK',category:'DANGEROUS_INSTRUCTIONS',reason_code:'ACTIONABLE_HARM',risks:['ACTIONABLE_HARM']});
    await expect(f.invoke('createSession',{topic:original,requestId:'admission-one'})).rejects.toThrow(SAFETY_DANGEROUS_MESSAGE);
    expect(f.classify.mock.calls[0][0]).toMatchObject({kind:'intent',originalRequest:original});expect(f.store.list()).toEqual([]);expect(f.coordinator.send).not.toHaveBeenCalled();expect(f.voice.synthesize).not.toHaveBeenCalled();
  });
  it('cancels an outstanding request before any late classifier result can store a session',async()=>{
    const f=setup();let approve!:(value:unknown)=>void;f.classify.mockImplementationOnce(()=>new Promise(resolve=>{approve=resolve;}));
    const pending=f.invoke('createSession',{topic:'Explain inertia',requestId:'admission-delayed'});const rejected=expect(pending).rejects.toThrow();await vi.waitFor(()=>expect(f.classify).toHaveBeenCalled());
    await f.invoke('cancelSafetyAdmission','admission-delayed');approve(allowed);await rejected;expect(f.store.list()).toEqual([]);
  });
  it('commits approved topics atomically and loads them offline without another classifier request',async()=>{
    const f=setup(),lesson=await f.invoke('createSession',{topic:'  Explain DNA in cells  ',requestId:'admission-allowed'});expect(lesson.topic).toBe('Explain DNA in cells');expect(f.safety.isApproved(lesson)).toBe(true);
    f.state.connected=false;const calls=f.classify.mock.calls.length;await expect(f.invoke('loadSession',lesson.id)).resolves.toMatchObject({id:lesson.id});expect(f.classify).toHaveBeenCalledTimes(calls);expect((await f.invoke('getSessions'))[0].title).toBe(lesson.title);
  });
  it('hides unreviewed saved text offline and reviews the original only after connecting',async()=>{
    const f=setup(false),legacy=f.store.create('Explain cell division');
    expect((await f.invoke('getSessions'))[0]).toMatchObject({id:legacy.id,title:'Lesson awaiting safety review'});await expect(f.invoke('loadSession',legacy.id)).rejects.toThrow(SAFETY_LEGACY_MESSAGE);expect(f.classify).not.toHaveBeenCalled();
    f.state.connected=true;await expect(f.invoke('loadSession',legacy.id)).resolves.toMatchObject({id:legacy.id,topic:legacy.topic});expect(f.classify.mock.calls[0][0]).toMatchObject({kind:'intent',originalRequest:legacy.topic});
  });
  it('never restores a sanitized explanation from a forbidden original topic',async()=>{
    const f=setup(),lesson=f.store.create('Explain human reproduction in detail');
    await expect(f.invoke('resumePlayback',{sessionId:lesson.id,mode:'replay'})).rejects.toThrow(SAFETY_SEXUAL_MESSAGE);expect(f.coordinator.resumePlayback).not.toHaveBeenCalled();expect(f.classify).not.toHaveBeenCalled();
  });
  it('propagates awaited coordinator denial instead of resolving before admission',async()=>{
    const f=setup(),lesson=f.store.create('Explain DNA');f.coordinator.send.mockRejectedValueOnce(new Error(SAFETY_REVIEW_MESSAGE));
    await expect(f.invoke('sendMessage',{sessionId:lesson.id,text:'Clarify the previous idea'})).rejects.toThrow(SAFETY_REVIEW_MESSAGE);expect(f.coordinator.send).toHaveBeenCalledOnce();
  });
  it('requires approved narration instead of allowing arbitrary paid synthesis',async()=>{
    const f=setup();await expect(f.invoke('synthesizeSpeech','An unreviewed narration')).rejects.toThrow(SAFETY_LEGACY_MESSAGE);expect(f.voice.synthesize).not.toHaveBeenCalled();
    await f.safety.inspect('An approved narration','narration');await f.invoke('synthesizeSpeech','An approved narration');expect(f.voice.synthesize).toHaveBeenCalledWith('An approved narration',undefined);
  });
  it('saves numeric edits and acknowledged narration prefixes without another classifier call',async()=>{
    const f=setup(),lesson=await f.invoke('createSession','Explain coordinates');
    const scene=[{id:'point',kind:'circle' as const,x:1,y:1,radius:2}],beat={id:'approved-point',narration:'The point moves along the axis.',next:'ask' as const,canvas:{mode:'replace' as const,entities:scene}};
    f.store.commitBeat(lesson.id,beat);const accepted=f.store.loadAcceptedBeat(lesson.id,beat.id)!;await f.safety.inspect(accepted,'saved-content');
    f.coordinator.presentProgress.mockImplementation((input:any)=>{f.store.presentProgress(input.sessionId,accepted,input);});
    const calls=f.classify.mock.calls.length;
    await f.invoke('presentProgress',{sessionId:lesson.id,epoch:1,beatId:beat.id,scene,narration:'The point moves',complete:false});
    await f.invoke('saveScene',{sessionId:lesson.id,scene:[{...scene[0],x:6}]});expect(f.classify).toHaveBeenCalledTimes(calls);expect(f.safety.isApproved(f.store.load(lesson.id))).toBe(true);expect(f.store.load(lesson.id).scene[0].x).toBe(6);
  });
  it('checks new annotation language with the original lesson context before saving',async()=>{
    const f=setup(),lesson=await f.invoke('createSession','Explain how bicycle brakes work safely');f.classify.mockClear();
    f.classify.mockResolvedValueOnce({...allowed,decision:'BLOCK',category:'DANGEROUS_INSTRUCTIONS',reason_code:'ACTIONABLE_HARM',risks:['ACTIONABLE_HARM']});
    const update={sessionId:lesson.id,scene:[{id:'annotation',kind:'text',x:1,y:1,text:'Apply that to the rider from the previous example.'}]};
    await expect(f.invoke('saveScene',update)).rejects.toThrow(SAFETY_DANGEROUS_MESSAGE);
    expect(f.classify.mock.calls[0][0]).toMatchObject({kind:'content',content:{lesson:{topic:'Explain how bicycle brakes work safely',messages:[]},update}});expect(f.store.load(lesson.id).scene).toEqual([]);
  });
  it('rejects a checked annotation when the lesson changed before its review completed',async()=>{
    const f=setup(),lesson=await f.invoke('createSession','Explain coordinates');let approve!:(value:unknown)=>void;
    f.classify.mockImplementationOnce(()=>new Promise(resolve=>{approve=resolve;}));
    const pending=f.invoke('saveScene',{sessionId:lesson.id,scene:[{id:'note',kind:'text',x:1,y:1,text:'My new explanation'}]});const rejected=expect(pending).rejects.toThrow(/changed/);await vi.waitFor(()=>expect(approve).toBeTypeOf('function'));
    f.store.saveScene(lesson.id,[{id:'newer-point',kind:'circle',x:3,y:2,radius:2}]);approve(allowed);await rejected;expect(f.store.load(lesson.id).scene[0].id).toBe('newer-point');
  });
  it('does not create a session if its window closes while the admission is pending',async()=>{
    const f=setup();let approve!:(value:unknown)=>void;f.classify.mockImplementationOnce(()=>new Promise(resolve=>{approve=resolve;}));const pending=f.invoke('createSession',{topic:'Explain momentum',requestId:'closing-admission'});const rejected=expect(pending).rejects.toThrow();await vi.waitFor(()=>expect(approve).toBeTypeOf('function'));f.state.destroyed=true;approve(allowed);await rejected;expect(f.store.list()).toEqual([]);
  });
  it('reapproves a returned checkpoint composed from the saved branch and current safe notes',async()=>{
    const f=setup(),lesson=await f.invoke('createSession','Explain points on an axis'),scene=[{id:'point',kind:'circle' as const,x:1,y:1,radius:2}];
    const beat={id:'branch-beat',narration:'A point has a position.',canvas:{mode:'replace' as const,entities:scene}};f.store.commitBeat(lesson.id,beat);const accepted=f.store.loadAcceptedBeat(lesson.id,beat.id)!;await f.safety.inspect(accepted,'saved-content');
    const checkpoint={cursor:{beatId:beat.id,chunkId:accepted.chunks[0].id},visibleScene:scene},branch={checkpoint,progress:{status:'paused'}};await f.safety.inspect(branch,'saved-content');vi.spyOn(f.store,'loadBranchPlayback').mockReturnValue(branch as any);
    f.coordinator.returnToLesson.mockImplementation(()=>{const merged={...checkpoint,visibleScene:[...scene,{id:'returned-point',kind:'circle' as const,x:3,y:3,radius:2}]};f.store.saveScene(lesson.id,merged.visibleScene);return {beat:accepted,epoch:2,checkpoint:merged,mode:'resume'};});
    const calls=f.classify.mock.calls.length;await expect(f.invoke('returnToLesson',{sessionId:lesson.id})).resolves.toMatchObject({mode:'resume'});expect(f.classify).toHaveBeenCalledTimes(calls);expect(f.safety.isApproved(f.store.load(lesson.id))).toBe(true);await expect(f.invoke('synthesizeSpeech',accepted.chunks[0].text)).resolves.toBeNull();
  });
  it('revalidates exact PDF bytes after a deferred export dialog instead of reusing an earlier path',async()=>{
    let tampered=false,choose!:(result:{canceled:boolean;filePath:string})=>void;
    const notes={latest:vi.fn(async()=>({title:'Reviewed notes'})),pdfPath:vi.fn(async()=>'/untrusted-after-dialog.pdf'),pdfBytes:vi.fn(async()=>{if(tampered)throw new Error('The saved notes PDF changed.');return new Uint8Array([37,80,68,70]);})};
    const f=setup(true,{notes});vi.mocked(dialog.showSaveDialog).mockImplementationOnce(()=>new Promise(resolve=>{choose=resolve;}));
    const pending=f.invoke('exportLessonNotes',{sessionId:'session',notesId:'ab84c5a1-d0e1-447f-b75b-309568fe4a70'}),rejected=expect(pending).rejects.toThrow('The saved notes PDF changed.');
    await vi.waitFor(()=>expect(choose).toBeTypeOf('function'));expect(notes.pdfBytes).not.toHaveBeenCalled();tampered=true;choose({canceled:false,filePath:'changed-notes-must-not-write.pdf'});await rejected;
    expect(notes.pdfPath).not.toHaveBeenCalled();expect(notes.pdfBytes).toHaveBeenCalledExactlyOnceWith('session','ab84c5a1-d0e1-447f-b75b-309568fe4a70');
  });
  it('does not read PDF bytes when the save dialog is canceled',async()=>{
    const notes={latest:vi.fn(async()=>({title:'Reviewed notes'})),pdfPath:vi.fn(async()=>'/unused.pdf'),pdfBytes:vi.fn()},f=setup(true,{notes});vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({canceled:true,filePath:''});
    await expect(f.invoke('exportLessonNotes',{sessionId:'session',notesId:'ab84c5a1-d0e1-447f-b75b-309568fe4a70'})).resolves.toEqual({canceled:true});expect(notes.pdfBytes).not.toHaveBeenCalled();expect(notes.pdfPath).not.toHaveBeenCalled();
  });
  it('rolls persistence back when a newly composed whole-session stamp fails',async()=>{
    const f=setup(),lesson=f.store.create('Explain coordinates');f.store.saveScene(lesson.id,[{id:'point',kind:'circle',x:1,y:1,radius:2}]);await f.safety.inspect(f.store.load(lesson.id),'saved-content');
    const derive=f.safety.derive.bind(f.safety);vi.spyOn(f.safety,'derive').mockImplementation((value,parents,surface)=>{if(value&&typeof value==='object'&&'messages' in value&&(value as any).scene[0]?.x===222)throw new IntentSafetyError(reviewDecision());derive(value,parents,surface);});
    await expect(f.invoke('saveScene',{sessionId:lesson.id,scene:[{id:'point',kind:'circle',x:222,y:1,radius:2}]})).rejects.toThrow();expect(f.store.load(lesson.id).scene[0].x).toBe(1);
  });
});
