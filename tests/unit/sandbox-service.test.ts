import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const transport=vi.hoisted(()=>({sent:[] as string[],windows:[] as any[],readyDelay:30,resultDelay:50}));
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events');
  class Port extends EventEmitter {
    closed=false;
    start(){}
    close(){this.closed=true;}
    postMessage(data:any){
      transport.sent.push(data.input.runId);
      setTimeout(()=>{if(!this.closed)this.emit('message',{data:{type:'result',id:data.id,result:{state:{},entities:[]}}});},transport.resultDelay);
    }
  }
  class Channel {port1=new Port();port2={parent:this.port1};}
  class Window extends EventEmitter {
    destroyed=false;webContents:any;
    constructor(){
      super();transport.windows.push(this);this.webContents=new EventEmitter();
      Object.assign(this.webContents,{setWindowOpenHandler(){},postMessage:(_name:string,_value:unknown,ports:any[])=>{
        setTimeout(()=>{if(!this.destroyed)ports[0].parent.emit('message',{data:{type:'ready'}});},transport.readyDelay);
      }});
    }
    isDestroyed(){return this.destroyed;}
    destroy(){this.destroyed=true;this.emit('closed');}
    loadFile(){setTimeout(()=>{if(!this.destroyed)this.webContents.emit('did-finish-load');},1);return Promise.resolve();}
    loadURL(){return this.loadFile();}
  }
  return {BrowserWindow:Window,MessageChannelMain:Channel,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){},onHeadersReceived(){}}})}};
});

import {createSimulationService} from '../../apps/desktop/src/main/sandbox/sandbox-window';
import type {SimulationInput} from '@living-canvas/protocol';
const input=(runId:string):SimulationInput=>({runId,action:'init',tick:0,artifact:{id:'generated',title:'Generated test experiment',source:'globalThis.simulation={init(){return{}},render(){return{entities:[]}}}',controls:[],assumptions:[],validation:'illustrative'}});
const services:ReturnType<typeof createSimulationService>[]=[];
const create=()=>{const service=createSimulationService({rendererFile:'C:/fixture/simulation.html',preloadPath:'C:/fixture/preload.cjs'});services.push(service);return service;};

describe('sandbox service cancellation',()=>{
  beforeEach(()=>{vi.useFakeTimers();transport.sent.length=0;transport.windows.length=0;transport.readyDelay=30;transport.resultDelay=50;});
  afterEach(()=>{for(const service of services.splice(0))service.dispose();vi.clearAllTimers();vi.useRealTimers();});

  it('cancels both the pending request and already queued work without dispatching the latter',async()=>{
    const service=create();const first=service.run(input('first'));const queued=service.run(input('queued'));
    await vi.advanceTimersByTimeAsync(40);
    expect(transport.sent).toEqual(['first']);
    service.cancelAll();
    await vi.advanceTimersByTimeAsync(200);
    const results=await Promise.all([first,queued]);
    expect(results.every(result=>!!result.error)).toBe(true);
    expect(transport.sent).toEqual(['first']);
    const recovery=service.run(input('fresh'));
    await vi.advanceTimersByTimeAsync(200);
    expect((await recovery).error).toBeUndefined();
    expect(transport.sent).toEqual(['first','fresh']);
  });

  it('settles a request canceled during boot immediately and never posts it when ready arrives',async()=>{
    const service=create();let settled=false;
    const booting=service.run(input('booting')).then(result=>{settled=true;return result;});
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.sent).toEqual([]);expect(settled).toBe(false);
    service.cancelAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await booting).error).toBeTruthy();
    await vi.advanceTimersByTimeAsync(200);
    expect(transport.sent).toEqual([]);
    const recovery=service.run(input('fresh-after-boot'));
    await vi.advanceTimersByTimeAsync(200);
    expect((await recovery).error).toBeUndefined();
  });
});
