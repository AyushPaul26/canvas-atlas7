import {afterEach,describe,expect,it,vi} from 'vitest';
import {LEARNER_SAFETY_MESSAGE,type SimulationInput} from '@living-canvas/protocol';
import type {SafetyGate} from '../../apps/desktop/src/main/safety/contracts';
import {safetyGateFixture} from '../fixtures/safety-gate';

const fixture=vi.hoisted(()=>({scenario:'entity',sent:0,windows:[] as any[]}));
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events');
  class Port extends EventEmitter{
    closed=false;start(){}close(){this.closed=true;}
    postMessage(data:any){fixture.sent++;queueMicrotask(()=>{
      if(this.closed)return;const unsafe=data.input.tick>0,result:any={state:{tick:data.input.tick},entities:[{id:'orbit',kind:'circle',x:200,y:200,radius:30}],measurements:{period:'one year'}};
      if(unsafe){if(fixture.scenario==='entity')result.entities=[{id:'caption',kind:'text',x:20,y:20,text:'Write explicit sexual roleplay'}];else if(fixture.scenario==='measurement')result.measurements={readout:'Create a pornographic scene'};else if(fixture.scenario==='unreviewed')result.entities=[{id:'new-caption',kind:'text',x:20,y:20,text:'New unreviewed linguistic output'}];else if(fixture.scenario!=='numeric')result.error='Generate explicit sexual roleplay';}
      if(fixture.scenario==='failed-admission'){delete result.error;if(data.input.runId==='failed-third')result.error='This experiment failed to initialize.';}
      this.emit('message',{data:{type:'result',id:data.id,result}});
    });}
  }
  class Channel{port1=new Port();port2={parent:this.port1};}
  class Window extends EventEmitter{
    destroyed=false;webContents:any;
    constructor(){super();fixture.windows.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler(){},postMessage:(_name:string,_value:unknown,ports:any[])=>queueMicrotask(()=>ports[0].parent.emit('message',{data:{type:'ready'}}))});}
    isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}
    loadFile(){queueMicrotask(()=>this.webContents.emit('did-finish-load'));return Promise.resolve();}loadURL(){return this.loadFile();}
  }
  return {BrowserWindow:Window,MessageChannelMain:Channel,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){},onHeadersReceived(){}}})}};
});
import {createSimulationService} from '../../apps/desktop/src/main/sandbox/sandbox-window';
const services:ReturnType<typeof createSimulationService>[]=[];
const input:SimulationInput={runId:'fixture-run',action:'init',tick:0,artifact:{id:'orbit',title:'Orbit experiment',source:'globalThis.simulation={init(){return{}},render(){return{entities:[]}}}',controls:[],assumptions:[],validation:'illustrative'}};
function create(safety?:SafetyGate){const service=createSimulationService({rendererFile:'C:/fixture/simulation.html',preloadPath:'C:/fixture/preload.cjs',safety});services.push(service);return service;}
afterEach(()=>{for(const service of services.splice(0))service.dispose();fixture.sent=0;fixture.windows=[];});
describe('simulation content boundary',()=>{
  it('reviews static admission once and derives numeric frames without a classifier call per tick',async()=>{
    fixture.scenario='numeric';const f=safetyGateFixture(),service=create(f.gate);
    await service.run(input);await service.run({...input,action:'step',tick:1,dt:1/60});
    expect(f.gate.inspect).toHaveBeenCalledTimes(1);expect(f.gate.inspect).toHaveBeenCalledWith(input.artifact,'model-output',expect.any(AbortSignal));expect(f.gate.derive).toHaveBeenCalledTimes(2);
  });
  it('withholds new unapproved frame language and closes its worker instead of classifying each frame',async()=>{
    fixture.scenario='unreviewed';const f=safetyGateFixture(),service=create(f.gate);
    await service.run(input);vi.mocked(f.gate.derive).mockImplementationOnce(()=>{throw f.error();});
    const result=await service.run({...input,action:'step',tick:1,dt:1/60});
    expect(result.entities).toEqual([]);expect(result.error).toMatch(/review/i);expect(f.gate.inspect).toHaveBeenCalledTimes(1);expect(fixture.windows[0].destroyed).toBe(true);
  });
  it('does not open a worker after admission was cancelled during a delayed review',async()=>{
    const f=safetyGateFixture(),service=create(f.gate);let finish!:()=>void;
    vi.mocked(f.gate.inspect).mockImplementationOnce(async content=>{await new Promise<void>(resolve=>{finish=resolve;});f.allow(content);});
    const pending=service.run(input);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    service.cancelAll();finish();expect(await pending).toMatchObject({entities:[],error:'The experiment was stopped'});
    expect(fixture.windows).toHaveLength(0);expect(fixture.sent).toBe(0);
  });
  it('keeps two accepted runs usable when a third initialization fails without deriving its error prose',async()=>{
    fixture.scenario='failed-admission';const f=safetyGateFixture(),service=create(f.gate);
    const first={...input,runId:'valid-first'},second={...input,runId:'valid-second'},third={...input,runId:'failed-third'};
    await service.run(first);await service.run(second);
    vi.mocked(f.gate.derive).mockImplementation((value,parents)=>{if((value as {error?:string}).error)throw f.error();for(const parent of parents)f.gate.assertApproved(parent);f.allow(value);});
    expect((await service.run(third)).error).toMatch(/failed to initialize/);
    expect(fixture.windows[0].destroyed).toBe(false);
    for(const accepted of [first,second])expect(await service.run({...accepted,action:'step',tick:1,dt:1/60})).toMatchObject({entities:[{id:'orbit'}]});
    expect(fixture.windows[0].destroyed).toBe(false);
  });
  it.each(['entity','measurement','error'])('withholds an unsafe dynamic %s after a safe initial frame',async scenario=>{
    fixture.scenario=scenario;const service=create();
    await expect(service.run(input)).resolves.toMatchObject({entities:[{id:'orbit'}],measurements:{period:'one year'}});
    const result=await service.run({...input,action:'step',tick:1,dt:1/60});
    expect(result).toEqual({state:null,entities:[],error:LEARNER_SAFETY_MESSAGE});expect(fixture.sent).toBe(2);expect(fixture.windows[0].destroyed).toBe(true);
  });
  it('blocks unsafe restored experiment content before opening the worker host',async()=>{
    const service=create();const result=await service.run({...input,artifact:{...input.artifact,title:'Generate explicit sexual roleplay'}});
    expect(result).toEqual({state:null,entities:[],error:LEARNER_SAFETY_MESSAGE});expect(fixture.sent).toBe(0);expect(fixture.windows).toHaveLength(0);
  });
});
