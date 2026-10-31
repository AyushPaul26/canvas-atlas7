import {LIMITS,assertBoundedJson,contractIdSchema,controlSchema,parseModelSource,parseScene,simulationArtifactSchema,simulationCheckpointSchema,type SimulationArtifact,type SimulationInput,type SimulationResult} from '../../protocol/src/index.ts';
import {assertLearnerSafe} from '../../teacher/src/learner-safety.ts';
import type {SimulationRuntime} from './index';
import type {ModelSession,ModelValues} from './model-contract';
import {createPhysicsModelSession} from './physics-model';
import {createMathModelSession} from './math-model';

type Run={artifact:SimulationArtifact;identity:string;session:ModelSession;tick:number;values:ModelValues;inputCount:number;historyBytes:number};
const identity=(artifact:SimulationArtifact)=>JSON.stringify([artifact.engine??'quickjs',artifact.source,artifact.controls]);
function checkedValues(artifact:SimulationArtifact,incoming:ModelValues={},previous:ModelValues={}):ModelValues{
  if(!incoming||typeof incoming!=='object'||Array.isArray(incoming)||Object.keys(incoming).some(id=>!artifact.controls.some(control=>control.id===id)))throw new Error('The experiment received an unknown control.');
  const values:ModelValues=Object.create(null);
  for(const control of artifact.controls){const value=Object.hasOwn(incoming,control.id)?incoming[control.id]:Object.hasOwn(previous,control.id)?previous[control.id]:control.value;controlSchema.parse({...control,value});values[control.id]=value;}
  return values;
}
function frame(result:SimulationResult):SimulationResult{
  assertBoundedJson(JSON.stringify(result),LIMITS.sceneBytes);assertLearnerSafe(result,'simulation-frame');
  if(result.error)throw new Error('The experiment returned an unsuccessful frame.');
  const measurements:Record<string,number|string>=Object.create(null);
  if(result.measurements){
    if(typeof result.measurements!=='object'||Array.isArray(result.measurements))throw new Error('Invalid experiment measurements.');
    for(const [key,value] of Object.entries(result.measurements)){
      if(key.length>100||!(typeof value==='number'&&Number.isFinite(value))&&!(typeof value==='string'&&value.length<=500))throw new Error('Experiment measurements must be finite numbers or short strings.');
      measurements[key]=value;
    }
  }
  const entities=parseScene(result.entities);assertBoundedJson(JSON.stringify({entities,measurements}),LIMITS.frameBytes);
  return structuredClone({state:result.state,entities,measurements});
}

/** Admission, live ownership and replay are shared across trusted and guest models. */
export class ModelSimulationRuntime{
  private runs=new Map<string,Run>();private closed=false;
  constructor(private legacy:SimulationRuntime){}
  private cancel(id:string){const run=this.runs.get(id);if(run){this.runs.delete(id);run.session.dispose();}}
  private stage(artifact:SimulationArtifact,values:ModelValues):Run{
    let session:ModelSession;
    if(artifact.engine==='model'){
      const model=parseModelSource(artifact.source,artifact.controls);
      session=model.kind==='physics'?createPhysicsModelSession(model,artifact.controls,values):createMathModelSession(model,artifact.controls,values);
    }else{
      const guest=this.legacy.fork();
      try{guest.load('guest',artifact.source,values);}catch(error){guest.dispose();throw error;}
      session={step:()=>guest.step('guest',1,LIMITS.fixedDt),input:next=>guest.input('guest',next),render:()=>guest.render('guest'),dispose:()=>guest.dispose()};
    }
    const run={artifact,identity:identity(artifact),session,tick:0,values,inputCount:0,historyBytes:2};
    try{frame(session.render());return run;}catch(error){session.dispose();throw error;}
  }
  run(input:SimulationInput):SimulationResult{
    if(this.closed)throw new Error('The experiment runner has closed.');
    contractIdSchema.parse(input.runId);assertBoundedJson(JSON.stringify(input),LIMITS.simulationRequestBytes,{maxNodes:LIMITS.simulationRequestNodes,maxDepth:LIMITS.envelopeDepth});assertLearnerSafe(input,'saved-content');
    const artifact=simulationArtifactSchema.parse(input.artifact);
    if(!['init','step','input','render'].includes(input.action))throw new Error('Unsupported experiment action.');
    if(!Number.isInteger(input.tick)||input.tick<0||input.tick>36000)throw new Error('The experiment tick exceeds its saved playback limit.');
    if(input.dt!==undefined&&(!Number.isFinite(input.dt)||Math.abs(input.dt-LIMITS.fixedDt)>1e-12))throw new Error('Experiments use a fixed 1/60 second time step.');
    if(input.action==='init'){
      const replay=input.replay?simulationCheckpointSchema.parse(input.replay):undefined;
      if(replay&&(identity(replay.artifact)!==identity(artifact)||input.tick!==replay.tick||!replay.initialValues||!replay.inputs))throw new Error('The saved experiment does not match this admitted model.');
      if(!replay&&input.tick!==0)throw new Error('A new experiment must start at tick zero.');
      const initial=checkedValues(artifact,replay?.initialValues??input.values),staged=this.stage(artifact,initial);
      try{
        const initialFrame=frame(staged.session.render());
        if(input.runId.startsWith('preflight:')){
          frame(staged.session.step());frame(staged.session.input(initial));staged.session.dispose();return initialFrame;
        }
        if(replay){
          const deadline=performance.now()+1000;
          const advance=(target:number)=>{while(staged.tick<target){if(performance.now()>deadline)throw new Error('This saved experiment exceeds its replay time budget. Reset it to continue.');frame(staged.session.step());staged.tick++;}};
          for(const entry of replay.inputs!){advance(entry.tick);const values=checkedValues(artifact,entry.values,staged.values),bytes=this.inputBytes(staged,values);frame(staged.session.input(values));staged.values=values;staged.inputCount++;staged.historyBytes+=bytes;}
          advance(replay.tick);
          if(JSON.stringify(checkedValues(artifact,replay.values))!==JSON.stringify(staged.values))throw new Error('Saved experiment controls do not match their replay history.');
        }
        const result=frame(staged.session.render());this.cancel(input.runId);
        if(this.runs.size>=2)this.cancel(this.runs.keys().next().value!);
        this.runs.set(input.runId,staged);return result;
      }catch(error){staged.session.dispose();throw error;}
    }
    const active=this.runs.get(input.runId);if(!active)throw new Error('This experiment is no longer running. Reset it to continue.');
    if(active.identity!==identity(artifact))throw new Error('The experiment engine, source or controls changed after admission.');
    if(input.tick!==active.tick)throw new Error('The experiment clock does not match the admitted tick.');
    const values=checkedValues(artifact,input.values,active.values);
    if(input.action!=='input'&&JSON.stringify(values)!==JSON.stringify(active.values))throw new Error('Experiment controls must change through a logged input.');
    if(input.action==='step'&&active.tick>=36000)throw new Error('This experiment reached its saved playback limit. Reset it to continue.');
    const inputBytes=input.action==='input'?this.inputBytes(active,values):0;
    try{
      if(input.action==='step'){const result=frame(active.session.step());active.tick++;return result;}
      if(input.action==='input'){const result=frame(active.session.input(values));active.values=values;active.inputCount++;active.historyBytes+=inputBytes;return result;}
      return frame(active.session.render());
    }catch(error){this.cancel(input.runId);throw error;}
  }
  private inputBytes(run:Run,values:ModelValues):number{
    const bytes=new TextEncoder().encode(JSON.stringify({tick:run.tick,values})).byteLength+(run.inputCount?1:0);
    if(run.inputCount>=1000||run.historyBytes+bytes>LIMITS.inputHistoryBytes)throw new Error('This experiment reached its saved input history limit. Reset it to continue.');
    return bytes;
  }
  dispose(){if(this.closed)return;this.closed=true;for(const id of [...this.runs.keys()])this.cancel(id);this.legacy.dispose();}
}
