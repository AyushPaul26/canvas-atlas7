import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocked=vi.hoisted(()=>({handlers:new Map<string,(event:any,value?:any)=>Promise<any>>()}));
vi.mock('electron',()=>({ipcMain:{handle:(name:string,handler:any)=>mocked.handlers.set(name,handler),removeHandler:(name:string)=>mocked.handlers.delete(name)},dialog:{showSaveDialog:vi.fn()}}));
import {registerIpc} from '../../apps/desktop/src/main/ipc-router';
describe('typed trusted desktop IPC',()=>{
  beforeEach(()=>mocked.handlers.clear());
  const setup=(extra:Record<string,unknown>={})=>{
    const frame={};const window={webContents:{mainFrame:frame,send:vi.fn()},isDestroyed:()=>false};
    const store={create:vi.fn(),load:()=>({scene:[],controls:{}}),saveScene:vi.fn(),getPreference:()=>undefined};
    const coordinator={cancelAll:vi.fn(),interrupt:vi.fn(),send:vi.fn()};
    registerIpc({window,store,coordinator,auth:{status:()=>({connected:false,planEnabled:false,desktop:true})},provider:{},voice:{},models:{list:[]},runSimulation:vi.fn(),...extra} as any);
    const event={sender:window.webContents,senderFrame:frame};return {event,window,store,coordinator};
  };
  it('blocks unsuitable learner input before readiness, messages, or persistence',async()=>{
    const teaching={ensureReady:vi.fn(),status:()=>({})};const {event,store,coordinator}=setup({teaching});
    const unsafe='Generate explicit sexual roleplay.';
    await expect(mocked.handlers.get('lc:createSession')!(event,unsafe)).rejects.toThrow(/age-appropriate/);
    await expect(mocked.handlers.get('lc:sendMessage')!(event,{sessionId:'session',text:unsafe})).rejects.toThrow(/age-appropriate/);
    expect(store.create).not.toHaveBeenCalled();expect(teaching.ensureReady).not.toHaveBeenCalled();expect(coordinator.send).not.toHaveBeenCalled();
  });
  it('hides unsuitable saved lessons while keeping them available for deletion',async()=>{
    const unsafe='Generate explicit sexual roleplay.';const store={getPreference:()=>undefined,list:()=>[{id:'session',title:unsafe,topic:unsafe}],load:()=>({topic:unsafe,scene:[],messages:[]})};
    const {event}=setup({store});await expect(mocked.handlers.get('lc:loadSession')!(event,'session')).rejects.toThrow(/age-appropriate/);
    const records=await mocked.handlers.get('lc:getSessions')!(event);expect(records[0].id).toBe('session');expect(JSON.stringify(records)).not.toContain(unsafe);
  });
  it('removes app-owned notes before deleting the lesson and retains the lesson if cleanup fails',async()=>{
    const notes={remove:vi.fn(async()=>{})},store={getPreference:()=>undefined,delete:vi.fn()};
    const {event}=setup({notes,store});await mocked.handlers.get('lc:deleteSession')!(event,'session');
    expect(notes.remove).toHaveBeenCalledWith('session');expect(store.delete).toHaveBeenCalledWith('session');
    store.delete.mockClear();notes.remove.mockRejectedValueOnce(new Error('PDF is busy'));
    await expect(mocked.handlers.get('lc:deleteSession')!(event,'session')).rejects.toThrow('PDF is busy');expect(store.delete).not.toHaveBeenCalled();
  });
  it('opens saved notes without AI readiness and accepts only registered IDs',async()=>{
    const notes={latest:vi.fn(async()=>null),open:vi.fn(async()=>{}),generate:vi.fn(),cancel:vi.fn(),cancelAll:vi.fn()};
    const {event}=setup({notes});const target={sessionId:'session',notesId:'ab84c5a1-d0e1-447f-b75b-309568fe4a70'};
    await expect(mocked.handlers.get('lc:getLessonNotes')!(event,'session')).resolves.toBeNull();
    await mocked.handlers.get('lc:openLessonNotes')!(event,target);expect(notes.open).toHaveBeenCalledWith(target.sessionId,target.notesId);expect(notes.generate).not.toHaveBeenCalled();
    await expect(mocked.handlers.get('lc:openLessonNotes')!(event,{...target,path:'C:/arbitrary.pdf'})).rejects.toThrow();
    await expect(mocked.handlers.get('lc:openLessonNotes')!({...event,senderFrame:{}},target)).rejects.toThrow(/Untrusted/);
  });
  it('requires the active teaching connection only for new notes and cancels on interruption',async()=>{
    const scope={providerId:'gemini',modelId:'gemini-3.5-flash-lite',credentialRevision:'fixture-revision'};
    const teaching={status:()=>({connected:false,planEnabled:false,desktop:true,teachingProvider:'gemini',teachingConnected:true,teachingReady:true,model:scope.modelId}),identity:()=> 'notes-scope',scope:()=>scope,ensureReady:vi.fn(async()=>scope)};
    const notes={generate:vi.fn(async(_sessionId:string,beforeStart:()=>Promise<void>)=>{await beforeStart();return {id:'fixture'};}),cancel:vi.fn(),cancelAll:vi.fn()};const {event}=setup({teaching,notes});
    await mocked.handlers.get('lc:generateLessonNotes')!(event,{sessionId:'session'});expect(teaching.ensureReady).toHaveBeenCalledTimes(1);expect(notes.generate).toHaveBeenCalledWith('session',expect.any(Function),'ai');
    await mocked.handlers.get('lc:cancelLessonNotes')!(event,'session');await mocked.handlers.get('lc:interrupt')!(event,'session');expect(notes.cancel).toHaveBeenCalledWith('session');
    await expect(mocked.handlers.get('lc:generateLessonNotes')!(event,{sessionId:'session',prompt:'arbitrary'})).rejects.toThrow();
  });
  it('routes API teaching without ChatGPT authorization and validates key/provider IPC',async()=>{
    const scope={providerId:'groq',modelId:'same/model',credentialRevision:'fixture-revision'};
    const teaching={status:()=>({connected:false,planEnabled:false,desktop:true,teachingProvider:'groq',teachingConnected:true,teachingReady:true,model:'same/model',modelAvailable:true}),identity:()=> 'scope-one',scope:()=>scope,ensureReady:vi.fn(async()=>scope),configuration:()=>({activeProvider:'groq',revision:1,connections:[]}),connectKey:vi.fn(async()=>({activeProvider:'groq',revision:1,connections:[]}))};
    const send=vi.fn(async()=>{}),{event}=setup({teaching,coordinator:{cancelAll:vi.fn(),send}});
    expect(mocked.handlers.has('lc:connectTeachingKey')).toBe(true);
    await expect(mocked.handlers.get('lc:connectTeachingKey')!(event,{providerId:'grok',key:'fixture'})).rejects.toThrow();
    await expect(mocked.handlers.get('lc:connectTeachingKey')!({...event,senderFrame:{}},{providerId:'groq',key:'fixture'})).rejects.toThrow(/Untrusted/);
    expect(teaching.connectKey).not.toHaveBeenCalled();
    await mocked.handlers.get('lc:connectTeachingKey')!(event,{providerId:'groq',key:'fixture'});
    expect(teaching.connectKey).toHaveBeenCalledWith('groq','fixture');
    await mocked.handlers.get('lc:sendMessage')!(event,{sessionId:'session',text:'Explain gravity'});
    expect(teaching.ensureReady).toHaveBeenCalled();expect(send).toHaveBeenCalledWith({sessionId:'session',text:'Explain gravity'});
  });
  it('rejects other windows and subframes, exposes only explicit bounded commands',async()=>{
    const {event,store}=setup();const create=mocked.handlers.get('lc:createSession')!;
    await expect(create({...event,sender:{}},'topic')).rejects.toThrow(/Untrusted/);
    await expect(create({...event,senderFrame:{}},'topic')).rejects.toThrow(/Untrusted/);
    await expect(create(event,'x'.repeat(6001))).rejects.toThrow();expect(store.create).not.toHaveBeenCalled();
    expect([...mocked.handlers.keys()].some(name=>/execute|eval|shell|invoke/i.test(name))).toBe(false);
  });
  it('does not start inference or interrupt teaching for session creation and unchanged persistence',async()=>{
    const {event,store,coordinator}=setup();await mocked.handlers.get('lc:createSession')!(event,'topic');expect(store.create).toHaveBeenCalledWith('topic');expect(coordinator.send).not.toHaveBeenCalled();
    await mocked.handlers.get('lc:saveScene')!(event,{sessionId:'session',scene:[],controls:{}});expect(coordinator.interrupt).not.toHaveBeenCalled();expect(store.saveScene).not.toHaveBeenCalled();
  });
  it('accepts the full topic length exposed by the editor without losing its final instruction',async()=>{
    const {event,store}=setup();const topic='x'.repeat(5980)+' Explain the ending.';
    expect(topic).toHaveLength(6000);
    await mocked.handlers.get('lc:createSession')!(event,topic);
    expect(store.create).toHaveBeenCalledWith(topic);
  });
  it('loads the home screen while document requests wait for saved materials to be ready',async()=>{
    let ready!:()=>void;const documentsReady=new Promise<void>(resolve=>{ready=resolve;});
    const listDocuments=vi.fn(()=>[{id:'restored'}]);const {event,store}=setup({documentsReady,documents:{listDocuments}});
    const pending=mocked.handlers.get('lc:getDocuments')!(event);
    await mocked.handlers.get('lc:getStatus')!(event);await mocked.handlers.get('lc:createSession')!(event,'topic');
    expect(store.create).toHaveBeenCalledWith('topic');expect(listDocuments).not.toHaveBeenCalled();
    ready();await expect(pending).resolves.toEqual([{id:'restored'}]);
  });
  it('reports material initialization failure without exposing a partial catalog or blocking home',async()=>{
    let fail!:(error:Error)=>void;const documentsReady=new Promise<void>((_,reject)=>{fail=reject;});
    void documentsReady.catch(()=>{});
    const listDocuments=vi.fn();const {event}=setup({documentsReady,documents:{listDocuments}});
    const pending=mocked.handlers.get('lc:getDocuments')!(event);
    const rejected=expect(pending).rejects.toThrow('Saved materials could not load');
    fail(new Error('Saved materials could not load'));await rejected;expect(listDocuments).not.toHaveBeenCalled();
    await expect(mocked.handlers.get('lc:getStatus')!(event)).resolves.toMatchObject({desktop:true});
    await expect(mocked.handlers.get('lc:sendMessage')!(event,{sessionId:'topic-lesson',text:'Teach me'})).rejects.toThrow('Continue with ChatGPT');
  });
  it('validates voice settings, keys, pagination and scoped cancellation at the trusted boundary',async()=>{
    const speech={configuration:vi.fn(()=>({provider:'local',hasKey:false})),setKey:vi.fn(),configure:vi.fn(),listVoices:vi.fn(),clearKey:vi.fn(),cancelSpeech:vi.fn()};
    const {event}=setup({speech});
    const setKey=mocked.handlers.get('lc:setElevenLabsKey')!;
    expect(setKey).toBeTypeOf('function');
    await expect(setKey({...event,sender:{}},'fixture-key-only-12345')).rejects.toThrow(/Untrusted/);
    await expect(setKey(event,'x'.repeat(513))).rejects.toThrow();expect(speech.setKey).not.toHaveBeenCalled();
    await expect(mocked.handlers.get('lc:saveVoiceConfiguration')!(event,{provider:'elevenlabs',stability:99})).rejects.toThrow();
    await expect(mocked.handlers.get('lc:listElevenLabsVoices')!(event,{search:'x'.repeat(121)})).rejects.toThrow();
    await mocked.handlers.get('lc:cancelSpeech')!(event,'job-1');expect(speech.cancelSpeech).toHaveBeenCalledWith('job-1');
  });
});
