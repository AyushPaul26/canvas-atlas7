import {describe,expect,it,vi} from 'vitest';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';
import type {SafetyEvaluation} from '../../apps/desktop/src/main/safety/contracts';
import {LEARNER_SAFETY_LIMIT_MESSAGE} from '@living-canvas/protocol';
const safe={decision:'ALLOW',category:'GENERAL_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};
const task={operation:'topic' as const,originalRequest:'Explain the human heart.',context:{messages:[]},subjectId:'admission:one'};
function setup(){
  const records=new Map<string,string>(),classify=vi.fn(async(_evaluation:unknown,_signal:AbortSignal):Promise<unknown>=>safe);let identity='one';
  const options={classify,identity:()=>identity,secret:new Uint8Array(32).fill(7),preferences:{getPreference:(k:string)=>records.get(k),setPreference:(k:string,v:string)=>{records.set(k,v);}}};
  return {options,classify,records,guardian:new SafetyGuardian(options),change:()=>{identity='two';}};
}
describe('backend intent capabilities and artifact receipts',()=>{
  it('requires semantic evaluation for harmless academic input and binds exact original/context',async()=>{const {guardian,classify}=setup();const permit=await guardian.authorize(task);expect(classify).toHaveBeenCalledTimes(1);expect(classify.mock.calls[0][0]).toMatchObject({originalRequest:task.originalRequest});expect(()=>guardian.assertCurrent(permit,task)).not.toThrow();expect(()=>guardian.assertCurrent(permit,{...task,originalRequest:'A different request'})).toThrow();});
  it('blocks strict sexual intent without allowing the teaching generator to reframe it',async()=>{const {guardian,classify}=setup();await expect(guardian.authorize({...task,originalRequest:'Teach human reproduction for Class 10.'})).rejects.toMatchObject({decision:'BLOCK'});expect(classify).not.toHaveBeenCalled();});
  it('fails closed on unavailable and malformed classifiers',async()=>{for(const result of [null,{...safe,confidence:3}]){const {guardian,classify}=setup();classify.mockResolvedValueOnce(result as any);await expect(guardian.authorize(task)).rejects.toMatchObject({decision:'REVIEW'});}});
  it('rejects forged, canceled and changed-provider permits',async()=>{const {guardian,change}=setup();const permit=await guardian.authorize(task);expect(()=>guardian.assertCurrent({...permit})).toThrow();guardian.cancel(task.subjectId);expect(()=>guardian.assertCurrent(permit)).toThrow();const next=await guardian.authorize(task);change();expect(()=>guardian.assertCurrent(next)).toThrow();});
  it('persists signed approvals for offline delivery and rejects changed bytes or policy',async()=>{const {guardian,options,classify,records}=setup();const content={narration:'The heart pumps blood.',canvas:{entities:[]}};await guardian.inspect(content,'model-output');expect(guardian.isApproved(content)).toBe(true);classify.mockRejectedValue(new Error('offline'));const offline=new SafetyGuardian(options);expect(()=>offline.assertApproved(content)).not.toThrow();expect(offline.isApproved({...content,narration:'Changed material'})).toBe(false);const other=new SafetyGuardian({...options,secret:new Uint8Array(32).fill(8)});expect(other.isApproved(content)).toBe(false);expect([...records.values()].join('')).not.toContain(content.narration);});
  it('permits reviewed text prefixes and numerical derivations but no new language',async()=>{const {guardian}=setup();const parent={narration:'A mass moves to the right.',entities:[{text:'Time 1.5 s',x:1}]};await guardian.inspect(parent,'model-output');expect(()=>guardian.derive('A mass moves',[parent],'narration')).not.toThrow();expect(()=>guardian.derive({entities:[{text:'Time 2.5 s',x:2}]},[parent],'simulation-frame')).not.toThrow();expect(()=>guardian.derive('Unreviewed extra text',[parent],'narration')).toThrow();});
  it('does not persist a database receipt for every numeric animation tick',async()=>{const {guardian,records}=setup();const parent={entities:[{text:'Time 1.5 s',x:1}]};await guardian.inspect(parent,'model-output');const initial=records.size;for(let tick=0;tick<120;tick++)guardian.derive({entities:[{text:`Time ${tick/60} s`,x:tick}]},[parent],'simulation-frame');expect(records.size).toBe(initial);});
  it('approves fixed onboarding and preview strings individually without a model request',()=>{const {guardian,classify}=setup();for(const text of ['What would you like to learn today?','This is your teacher voice preview.']){guardian.registerTrusted(text);expect(()=>guardian.assertApproved(text,'narration')).not.toThrow();}expect(classify).not.toHaveBeenCalled();});
  it('fails closed when the real classifier deadline expires even if its adapter never settles',async()=>{
    vi.useFakeTimers();const fixture=setup();const guardian=new SafetyGuardian({...fixture.options,timeoutMs:25});
    fixture.classify.mockImplementation(()=>new Promise(()=>{}));
    try{
      const work=guardian.authorize(task),rejected=expect(work).rejects.toMatchObject({decision:'REVIEW',reasonCode:'CLASSIFIER_UNAVAILABLE'});
      await vi.advanceTimersByTimeAsync(25);await rejected;
      expect(fixture.classify).toHaveBeenCalledTimes(1);expect(guardian.isApproved(task.originalRequest)).toBe(false);expect(fixture.records.size).toBe(0);
    }finally{guardian.dispose();vi.useRealTimers();}
  });
  it('retains the exact original request and chronological raw conversation when numerical context needs projection',async()=>{
    const {guardian,classify}=setup();const originalRequest='  Now apply that earlier plan.  ';
    const context={messages:[{role:'student',text:'FIRST: keep my original wording 😀.'},{role:'tutor',text:'SECOND: the prior response matters.'},{role:'student',text:'THIRD: combine the earlier steps.'}],coordinates:Array.from({length:35000},(_,index)=>index)};
    let received:SafetyEvaluation|undefined;
    classify.mockImplementation(async evaluation=>{received=evaluation as SafetyEvaluation;return {...safe,decision:'REVIEW',category:'AMBIGUOUS_INTENT',reason_code:'NEEDS_CLARIFICATION'};});
    await expect(guardian.authorize({...task,operation:'follow-up',originalRequest,context})).rejects.toMatchObject({decision:'REVIEW'});
    expect(received?.originalRequest).toBe(originalRequest);
    const serialized=JSON.stringify(received?.context),first=serialized.indexOf(context.messages[0].text),second=serialized.indexOf(context.messages[1].text),third=serialized.indexOf(context.messages[2].text);
    expect(first).toBeGreaterThanOrEqual(0);expect(second).toBeGreaterThan(first);expect(third).toBeGreaterThan(second);
    expect(guardian.isApproved(originalRequest)).toBe(false);
  });
  it('does not approve a long generated report when the classifier rejects a later passage',async()=>{
    const {guardian,classify,records}=setup(),seen:SafetyEvaluation[]=[];
    const content={narration:'A neutral astronomy explanation. '.repeat(3000)+'TAIL_REQUIRES_CLARIFICATION'};
    classify.mockImplementation(async evaluation=>{const checked=evaluation as SafetyEvaluation;seen.push(checked);return JSON.stringify(checked.content).includes('TAIL_REQUIRES_CLARIFICATION')?{...safe,decision:'REVIEW',category:'AMBIGUOUS_INTENT',reason_code:'NEEDS_CLARIFICATION'}:safe;});
    await expect(guardian.inspect(content,'model-output')).rejects.toMatchObject({decision:'REVIEW'});
    expect(seen.length).toBeGreaterThan(1);expect(JSON.stringify(seen[0].content)).not.toContain('TAIL_REQUIRES_CLARIFICATION');expect(JSON.stringify(seen.at(-1)?.content)).toContain('TAIL_REQUIRES_CLARIFICATION');
    expect(guardian.isApproved(content)).toBe(false);expect(records.size).toBe(0);
  });
  it('rejects material exceeding the semantic passage budget before spending classifier calls or saving a partial approval',async()=>{
    const {guardian,classify,records}=setup(),content={text:'A long astronomy passage. '.repeat(100000)};
    await expect(guardian.inspect(content,'model-output')).rejects.toMatchObject({decision:'REVIEW',message:LEARNER_SAFETY_LIMIT_MESSAGE});
    expect(classify).not.toHaveBeenCalled();expect(guardian.isApproved(content)).toBe(false);expect(records.size).toBe(0);
  });
  it('does not start a fifth concurrent classifier job and cancels every outstanding admission on shutdown',async()=>{
    const {guardian,classify,records}=setup();classify.mockImplementation(()=>new Promise(()=>{}));
    const waiting=Array.from({length:4},(_,index)=>guardian.authorize({...task,subjectId:`parallel:${index}`,originalRequest:`Explain the human heart, question ${index}.`}).then(()=>({approved:true,error:undefined}),error=>({approved:false,error})));
    try{
      await Promise.resolve();
      await expect(guardian.authorize({...task,subjectId:'parallel:fifth'})).rejects.toMatchObject({decision:'REVIEW',reasonCode:'CLASSIFIER_UNAVAILABLE'});
      expect(classify).toHaveBeenCalledTimes(4);expect(guardian.isApproved(task.originalRequest)).toBe(false);expect(records.size).toBe(0);
    }finally{guardian.dispose();}
    const results=await Promise.all(waiting);expect(results.every(result=>!result.approved&&result.error?.decision==='REVIEW')).toBe(true);
  });
});
