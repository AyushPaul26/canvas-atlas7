import {afterEach,describe,it,expect} from 'vitest';
import type {SimulationArtifact,SimulationInput} from '@living-canvas/protocol';
import {SimulationRuntime} from '../../packages/simulation/src/index';
import {ModelSimulationRuntime} from '../../packages/simulation/src/model-runtime';

const source=JSON.stringify({version:1,kind:'physics',gravity:{x:0,y:0},bodies:[{id:'ball',shape:'circle',x:1,y:1,radius:.2,mass:2}],bindings:[{controlId:'force',target:'forceX',bodyId:'ball'}]});
const artifact=():SimulationArtifact=>({id:'physics',title:'A local mechanics model',engine:'model',source,controls:[{id:'force',label:'Force',type:'slider',value:2,min:-10,max:10}],assumptions:['Uniform gravity; illustrative numerical model.'],validation:'illustrative'});
const legacy=():SimulationArtifact=>({id:'legacy',title:'Legacy model',source:'globalThis.simulation={init(p){return{x:p.start}},step(s,t,dt){return{x:s.x+dt}},input(s,p){return{x:p.start}},render(s){return{entities:[{id:"point",kind:"circle",x:s.x,y:0,radius:2}]}}}',controls:[{id:'start',label:'Start',type:'slider',value:3,min:0,max:20}],assumptions:[],validation:'illustrative'});
const runtimes:ModelSimulationRuntime[]=[];
afterEach(()=>{for(const runtime of runtimes.splice(0))runtime.dispose();});
async function setup(){const runtime=new ModelSimulationRuntime(await SimulationRuntime.create());runtimes.push(runtime);return runtime;}
const command=(runId:string,artifact:SimulationArtifact,action:SimulationInput['action']='init',tick=0,values:SimulationInput['values']={}):SimulationInput=>({runId,artifact,action,tick,values,dt:1/60});
describe('shared isolated model dispatcher',()=>{
  it('runs trusted mechanics and legacy code behind the same unchanged transport',async()=>{
    const runtime=await setup(),model=artifact(),old=legacy();expect(runtime.run(command('physics',model)).entities[0].kind).toBe('circle');expect(runtime.run(command('old',old,'init',0,{start:3})).entities[0].x).toBe(3);
    expect(runtime.run(command('old',old,'step',0,{start:3})).entities[0].x).toBeCloseTo(3+1/60,8);expect((runtime.run(command('physics',model,'step')).state as any).tick).toBe(1);
  });
  it('pins admitted source, engine, controls and tick without letting a rejected command destroy the run',async()=>{
    const runtime=await setup(),model=artifact();const before=runtime.run(command('p',model));
    for(const changed of [{...model,source:source.replace('"x":1','"x":2')},{...model,engine:'quickjs' as const},{...model,controls:[{...model.controls[0],max:11}]}])expect(()=>runtime.run(command('p',changed,'step'))).toThrow(/changed|match|identity|admitted/i);
    expect(()=>runtime.run({...command('p',model,'step'),dt:.02})).toThrow(/fixed|time step/i);expect(()=>runtime.run(command('p',model,'step',1))).toThrow(/tick|clock/i);
    expect(runtime.run(command('p',model,'render'))).toEqual(before);
  });
  it('stages failed replacements and preflight without evicting either live backend',async()=>{
    const runtime=await setup(),model=artifact(),old=legacy();const first=runtime.run(command('p',model)),second=runtime.run(command('old',old,'init',0,{start:3}));
    const unsafe={...old,source:'globalThis.simulation={init(){return{}},step(s){return s},input(s){return s},render(){return{entities:[{id:"x",kind:"text",x:0,y:0,text:"explicit sexual roleplay"}]}}}'};
    expect(()=>runtime.run(command('old',unsafe))).toThrow();expect(()=>runtime.run(command('p',{...model,source:'{"kind":"physics"}'}))).toThrow();
    runtime.run(command('preflight:mechanics',model));expect(()=>runtime.run(command('preflight:bad',unsafe))).toThrow();
    expect(runtime.run(command('p',model,'render'))).toEqual(first);expect(runtime.run(command('old',old,'render'))).toEqual(second);
    runtime.run(command('third',model));expect(()=>runtime.run(command('p',model,'render'))).toThrow(/running|reset|admitted/i);expect(runtime.run(command('old',old,'render'))).toEqual(second);
  });
  it('replays control changes at their original fixed ticks and continues identically',async()=>{
    const runtime=await setup(),model=artifact();runtime.run(command('p',model,'init',0,{force:2}));
    for(let tick=0;tick<60;tick++){if(tick===20)runtime.run(command('p',model,'input',tick,{force:0}));runtime.run(command('p',model,'step',tick));}
    const expected=runtime.run(command('p',model,'render',60));
    const replay={artifact:model,state:null,tick:60,values:{force:0},initialValues:{force:2},inputs:[{tick:20,values:{force:0}}]};
    expect(runtime.run({...command('restored',model,'init',60,{force:0}),replay})).toEqual(expected);
    expect(runtime.run(command('restored',model,'step',60))).toEqual(runtime.run(command('p',model,'step',60)));
  });
  it('rejects mismatched or unordered replay before replacing a working model',async()=>{
    const runtime=await setup(),model=artifact();const before=runtime.run(command('p',model));
    const replay={artifact:model,state:null,tick:5,values:{force:2},initialValues:{force:2},inputs:[{tick:4,values:{force:0}},{tick:2,values:{force:2}}]};
    expect(()=>runtime.run({...command('p',model,'init',5),replay})).toThrow();
    expect(()=>runtime.run({...command('p',model,'init',5),replay:{...replay,artifact:legacy(),inputs:[]}})).toThrow();expect(runtime.run(command('p',model,'render'))).toEqual(before);
  });
  it('does not let a failing legacy replay replace the previous working experiment',async()=>{
    const runtime=await setup(),old=legacy();const before=runtime.run(command('old',old,'init',0,{start:3}));
    const encoded=[...'explicit sexual roleplay'].map(character=>character.charCodeAt(0)).join(',');
    const bad={...old,source:`globalThis.simulation={init(){return{tick:0}},step(s){return{tick:s.tick+1}},input(s){return s},render(s){return{entities:[{id:'label',kind:'text',x:0,y:0,text:s.tick?String.fromCharCode(${encoded}):'Safe preview'}]}}}`};
    const replay={artifact:bad,state:null,tick:1,values:{start:3},initialValues:{start:3},inputs:[]};
    expect(()=>runtime.run({...command('old',bad,'init',1,{start:3}),replay})).toThrow(/age-appropriate/i);expect(runtime.run(command('old',old,'render'))).toEqual(before);
  });
  it('enforces the saved input-count limit without altering the final committed frame',async()=>{
    const runtime=await setup(),model=artifact();runtime.run(command('p',model));
    for(let i=0;i<1000;i++)runtime.run(command('p',model,'input',0,{force:2}));
    const before=runtime.run(command('p',model,'render'));
    expect(()=>runtime.run(command('p',model,'input',0,{force:3}))).toThrow(/history|limit/i);expect(runtime.run(command('p',model,'render'))).toEqual(before);
  });
  it('bounds accumulated input bytes before the count limit and preserves the committed guest state',async()=>{
    const runtime=await setup(),value='v'.repeat(200),controls=Array.from({length:32},(_,i)=>({id:`c${i}`,label:`Value ${i}`,type:'select' as const,value,options:[value]}));
    const model={...legacy(),controls,source:'globalThis.simulation={init(){return{inputs:0}},step(s){return s},input(s){return{inputs:s.inputs+1}},render(){return{entities:[]}}}'};
    runtime.run(command('strings',model));let accepted=0,last=runtime.run(command('strings',model,'render'));
    for(;accepted<1000;accepted++){try{last=runtime.run(command('strings',model,'input'));}catch(error){expect(String(error)).toMatch(/history|limit/i);break;}}
    expect(accepted).toBeGreaterThan(100);expect(accepted).toBeLessThan(200);expect(runtime.run(command('strings',model,'render'))).toEqual(last);
  });
  it('restores ten seconds of a collision experiment within the existing bounded replay deadline',async()=>{
    const runtime=await setup(),model={...artifact(),source:JSON.stringify({version:1,kind:'physics',gravity:{x:0,y:9.81},bodies:[{id:'ball',shape:'circle',x:2,y:1,radius:.2},{id:'floor',shape:'rect',x:3,y:4,width:8,height:.2,isStatic:true}] }),controls:[]};
    const replay={artifact:model,state:null,tick:600,values:{},initialValues:{},inputs:[]};
    const result=runtime.run({...command('restored',model,'init',600),replay});expect((result.state as any).tick).toBe(600);expect((result.state as any).bodies[0].y).toBeLessThan(3.71);
  });
});
