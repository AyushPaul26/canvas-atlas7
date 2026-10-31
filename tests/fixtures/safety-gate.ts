import {vi} from 'vitest';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../../apps/desktop/src/main/safety/contracts';

/** Boundary tests use a receipt ledger, never provider/network or production test hooks. */
export function safetyGateFixture(){
  const approved=new Set<string>(),permits=new Map<string,string>();let serial=0;
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  const key=(value:unknown)=>JSON.stringify(canonical(value));
  const error=()=>Object.assign(new Error('This saved content needs a safety review.'),{code:'LEARNER_SAFETY_REVIEW',repairable:false});
  const allow=(value:unknown)=>{approved.add(key(value));};
  const gate:SafetyGate={
    registerTrusted:allow,
    authorize:vi.fn(async(task:SafetyTask,signal?:AbortSignal):Promise<SafetyPermit>=>{signal?.throwIfAborted();const token=String(++serial),binding=key(task);permits.set(token,binding);return {token,policyVersion:'fixture-policy',binding};}),
    assertCurrent:vi.fn((permit:SafetyPermit,task?:SafetyTask)=>{if(permit.policyVersion!=='fixture-policy'||permits.get(permit.token)!==permit.binding||task&&key(task)!==permit.binding)throw error();}),
    inspect:vi.fn(async(value:unknown,_surface,signal?:AbortSignal)=>{signal?.throwIfAborted();allow(value);}),
    isApproved:value=>approved.has(key(value)),
    assertApproved:vi.fn((value:unknown)=>{if(!approved.has(key(value)))throw error();}),
    derive:vi.fn((value:unknown,parents:unknown[])=>{if(!parents.length||parents.some(parent=>!approved.has(key(parent))))throw error();allow(value);}),
    cancel:vi.fn(),cancelAll:vi.fn(),
  };
  return {gate,allow,approved,error};
}
