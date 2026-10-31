import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocked=vi.hoisted(()=>({handlers:new Map<string,(event:any,value?:any)=>Promise<any>>()}));
vi.mock('electron',()=>({ipcMain:{handle:(name:string,handler:any)=>mocked.handlers.set(name,handler),removeHandler:(name:string)=>mocked.handlers.delete(name)},dialog:{showSaveDialog:vi.fn()}}));
import {registerIpc} from '../../apps/desktop/src/main/ipc-router';
const catalog=[{id:'model-default',name:'Default'},{id:'exact/astra-id',name:'ChatGPT-6 Astra'}];
function setup(selected?:string){
  const prefs=new Map<string,string>();if(selected)prefs.set('selectedModel',selected);
  const frame={};const window={webContents:{mainFrame:frame,send:vi.fn()},isDestroyed:()=>false};
  let active={connected:true,planEnabled:true,desktop:true,account:{id:'account-one'}};
  const store={getPreference:(key:string)=>prefs.get(key),setPreference:vi.fn((key:string,value:string)=>{prefs.set(key,value);}),load:()=>({topic:'Gravity',scene:[],messages:[]})};
  const models:{list:typeof catalog;selected?:string;available?:boolean;error?:string}={list:[]};
  const coordinator={cancelAll:vi.fn(),send:vi.fn(async()=>{}),continueLesson:vi.fn(async()=>{})};
  const provider={listModels:vi.fn(async()=>catalog)};
  const auth={status:()=>active,signIn:vi.fn(async()=>active),signOut:vi.fn(async()=>{active={...active,connected:false,planEnabled:false};return active;})};
  const router=registerIpc({window,store,models,coordinator,provider,auth,voice:{cancel:vi.fn()},runSimulation:vi.fn()} as any);
  const event={sender:window.webContents,senderFrame:frame};
  const invoke=(name:string,value?:unknown)=>mocked.handlers.get(`lc:${name}`)!(event,value);
  return {router,models,provider,coordinator,store,prefs,auth,invoke};
}
describe('exact and stable account model selection',()=>{
  beforeEach(()=>mocked.handlers.clear());
  it('restores the exact saved ID immediately and never silently substitutes a missing choice',async()=>{
    const f=setup('missing-exact-model');expect((await f.invoke('getStatus')).model).toBe('missing-exact-model');
    await f.invoke('getModels');
    expect(await f.invoke('getStatus')).toMatchObject({model:'missing-exact-model',modelAvailable:false});
    await expect(f.invoke('sendMessage',{sessionId:'lesson',text:'teach'})).rejects.toThrow(/not available|unavailable/i);
    expect(f.coordinator.send).not.toHaveBeenCalled();expect(f.prefs.get('selectedModel')).toBe('missing-exact-model');
  });
  it('persists the first explicit default once and accepts catalog IDs without rewriting them',async()=>{
    const f=setup();await f.invoke('getModels');expect(f.prefs.get('selectedModel')).toBe('model-default');
    await f.invoke('setModel','exact/astra-id');await f.invoke('getModels');
    expect(f.models.selected).toBe('exact/astra-id');expect(f.prefs.get('selectedModel')).toBe('exact/astra-id');
    expect(await f.invoke('getStatus')).toMatchObject({model:'exact/astra-id',modelAvailable:true});
  });
  it('ignores an older catalog response that arrives after a newer one',async()=>{
    const f=setup('exact/astra-id');let first!:(items:typeof catalog)=>void;
    f.provider.listModels.mockImplementationOnce(()=>new Promise(resolve=>{first=resolve;}));
    const stale=f.invoke('getModels');await f.invoke('getModels');
    first([catalog[0]]);await stale;
    expect(f.models.list).toEqual(catalog);expect(f.models.selected).toBe('exact/astra-id');expect(f.models.available).toBe(true);
  });
  it('does not restore a stale account catalog after sign-out',async()=>{
    const f=setup('exact/astra-id');let release!:(items:typeof catalog)=>void;
    f.provider.listModels.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=f.invoke('getModels');await f.invoke('signOut');release(catalog);await pending;
    expect(f.models.list).toEqual([]);expect(f.models.available).not.toBe(true);
  });
  it('does not let a catalog started before a user choice mark that newer choice unavailable',async()=>{
    const f=setup();await f.invoke('getModels');let release!:(items:typeof catalog)=>void;
    f.provider.listModels.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const stale=f.invoke('getModels');await f.invoke('setModel','exact/astra-id');release([catalog[0]]);await stale;
    expect(f.models.selected).toBe('exact/astra-id');expect(f.models.available).toBe(true);
  });
  it('rejects a send superseded by a model change before coordinator dispatch',async()=>{
    const f=setup();await f.invoke('getModels');
    const pending=f.invoke('sendMessage',{sessionId:'lesson',text:'teach'});
    await f.invoke('setModel','exact/astra-id');
    await expect(pending).rejects.toThrow(/selection changed/i);expect(f.coordinator.send).not.toHaveBeenCalled();
  });
  it('validates automatic continuation through the same model availability gate',async()=>{
    const f=setup('unavailable');await f.invoke('getModels');
    await expect(f.invoke('continueLesson',{sessionId:'lesson',epoch:1})).rejects.toThrow(/not available|unavailable/i);
    expect(f.coordinator.continueLesson).not.toHaveBeenCalled();
    await expect(f.invoke('continueLesson',{sessionId:'lesson',epoch:-1})).rejects.toThrow();
  });
});
