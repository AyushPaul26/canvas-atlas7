import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {SpeechProvider} from '../../apps/desktop/src/main/voice/speech-provider';
import {NotesRepository} from '../../apps/desktop/src/main/notes/notes-repository';
import {DocumentService} from '../../apps/desktop/src/main/documents/document-service';
import {notesFixture} from '../fixtures/lesson-notes';
import {safetyGateFixture} from '../fixtures/safety-gate';
import {NotesCoordinator} from '../../apps/desktop/src/main/notes/notes-coordinator';
import type {LessonSession} from '@living-canvas/protocol';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';
import {mathModelSchema} from '../../packages/protocol/src/math-model';
import {createMathModelSession} from '../../packages/simulation/src/math-model';

const roots:string[]=[];
async function scratch(){const root=await mkdtemp(join(tmpdir(),'atlas-guardian-boundary-'));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))if(resolve(root).startsWith(resolve(tmpdir())+sep))await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
const pdf=Buffer.from('%PDF-1.7\n% first safe fixture\n%%EOF\n');
describe('intent guardian delivery boundaries',()=>{
  const lesson=():LessonSession=>({id:'lesson-1',topic:'Earth’s journey around the Sun',title:'Earth',createdAt:'2026-10-31T12:00:00.000Z',updatedAt:'2026-10-31T12:00:00.000Z',messages:[{id:'heard-1',role:'tutor',text:'Earth rotates each day.',createdAt:'2026-10-31T12:00:00.000Z'},{id:'heard-2',role:'tutor',text:'Earth revolves around the Sun.',createdAt:'2026-10-31T12:00:00.000Z'}],beats:[],scene:[],controls:{}});
  it('authorizes the original notes topic and heard context before the sole notes request',async()=>{
    const f=safetyGateFixture(),content=notesFixture().content;
    const complete=vi.fn(async(_request:unknown)=>({calls:[],output:[],text:JSON.stringify(content)}));
    const coordinator=new NotesCoordinator({safety:f.gate,sessions:{load:()=>lesson()},provider:{id:'chatgpt',complete},model:()=>'fixture-model'});
    vi.mocked(f.gate.authorize).mockRejectedValueOnce(f.error());
    await expect(coordinator.generate('lesson-1')).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});expect(complete).not.toHaveBeenCalled();
    const document=await coordinator.generate('lesson-1');
    expect(complete).toHaveBeenCalledTimes(1);expect(complete.mock.calls[0][0]).toHaveProperty('safetyPermit');
    expect(f.gate.authorize).toHaveBeenCalledWith(expect.objectContaining({operation:'notes',originalRequest:'Earth’s journey around the Sun',context:expect.objectContaining({explanations:[{id:'heard-1',text:'Earth rotates each day.'},{id:'heard-2',text:'Earth revolves around the Sun.'}]})}),expect.any(AbortSignal));
    expect(f.gate.isApproved(document)).toBe(true);
  });
  it.each(['after-1000','outside-last-12'] as const)('blocks a prohibited raw notes follow-up %s before generation even when the notes context omits it',async position=>{
    const saved=lesson(),bad='Recommend pornographic performers.';
    saved.messages.push({id:'bad-original',role:'student',text:position==='after-1000'?'A harmless-looking preamble. '.repeat(60)+bad:bad,createdAt:saved.createdAt});
    if(position==='outside-last-12')for(let index=0;index<13;index++)saved.messages.push({id:`later-${index}`,role:'student',text:'Explain the next safe step.',createdAt:saved.createdAt});
    const classify=vi.fn(async(evaluation:unknown)=>JSON.stringify(evaluation).includes(bad)?{decision:'BLOCK',category:'SEXUAL_CONTENT',confidence:1,reason_code:'PROHIBITED_SEXUAL_CONTENT',risks:['SEXUAL_RECOMMENDATION'],safe_alternative:null}:{decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null});
    const gate=new SafetyGuardian({classify,secret:new Uint8Array(32).fill(7)}),complete=vi.fn(async()=>({calls:[],output:[],text:JSON.stringify(notesFixture().content)}));
    const coordinator=new NotesCoordinator({safety:gate,sessions:{load:()=>structuredClone(saved)},provider:{id:'chatgpt',complete},model:()=>'fixture-model'});
    await expect(coordinator.generate(saved.id)).rejects.toMatchObject({decision:'BLOCK'});expect(complete).not.toHaveBeenCalled();
  });
  it('creates offline notes only from approved saved content without semantic network work',async()=>{
    const f=safetyGateFixture(),saved=lesson(),complete=vi.fn();
    const coordinator=new NotesCoordinator({safety:f.gate,sessions:{load:()=>structuredClone(saved)},provider:{complete},model:()=>undefined});
    await expect(coordinator.generateLocal('lesson-1')).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
    f.allow(saved);const document=await coordinator.generateLocal('lesson-1');
    expect(f.gate.isApproved(document)).toBe(true);expect(complete).not.toHaveBeenCalled();expect(f.gate.authorize).not.toHaveBeenCalled();expect(f.gate.inspect).not.toHaveBeenCalled();
  });
  it('derives a real signed offline study record without reclassifying copied explanations',async()=>{
    const classify=vi.fn(async()=>({decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null}));
    const gate=new SafetyGuardian({classify,secret:new Uint8Array(32).fill(7)}),saved=lesson();
    await gate.inspect(saved,'saved-content');classify.mockClear();
    const coordinator=new NotesCoordinator({safety:gate,sessions:{load:()=>structuredClone(saved)},provider:{complete:vi.fn()},model:()=>undefined});
    const document=await coordinator.generateLocal(saved.id);expect(gate.isApproved(document)).toBe(true);expect(classify).not.toHaveBeenCalled();
  });
  it('derives trusted numeric math frames from an approved static model without per-frame classification',async()=>{
    const classify=vi.fn(async()=>({decision:'ALLOW',category:'MATHEMATICS',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null}));
    const gate=new SafetyGuardian({classify,secret:new Uint8Array(32).fill(7)});
    const model=mathModelSchema.parse({version:1,kind:'math',bounds:{left:-5,right:5,bottom:-5,top:5},points:[{id:'point',label:'Moving point',x:{control:'px'},y:2,drag:{xControl:'px'}}],plots:[],vectors:[]});
    const controls=[{id:'px',label:'Point position',type:'slider' as const,value:1,min:-5,max:5}];
    const artifact={id:'math-fixture',title:'Point on a plane',engine:'model' as const,source:JSON.stringify(model),controls,assumptions:[],validation:'illustrative' as const};
    await gate.inspect(artifact,'model-output');classify.mockClear();
    const session=createMathModelSession(model,controls,{px:1}),first=session.render();
    const unsupported=new Set<string>();
    const checkStrings=(value:unknown,key='')=>{
      if(typeof value==='string'){try{gate.derive({[key]:value},[artifact],'simulation-frame');}catch{unsupported.add(`${key}: ${value}`);}}
      else if(value&&typeof value==='object')for(const [name,child] of Object.entries(value)){
        if(key==='measurements')try{gate.derive({measurements:{[name]:child}},[artifact],'simulation-frame');}catch{unsupported.add(`measurement: ${name}`);}
        checkStrings(child,name);
      }
    };
    checkStrings(first);expect([...unsupported]).toEqual([]);
    expect(()=>gate.derive(first,[artifact],'simulation-frame')).not.toThrow();
    expect(()=>gate.derive(session.input({px:2}),[artifact,first],'simulation-frame')).not.toThrow();
    expect(classify).not.toHaveBeenCalled();session.dispose();
  });
  it('cancels pending notes authorization before a provider request starts',async()=>{
    const f=safetyGateFixture(),complete=vi.fn(),coordinator=new NotesCoordinator({safety:f.gate,sessions:{load:()=>lesson()},provider:{complete},model:()=>'fixture-model'});
    let finish!:(value:{token:string;binding:string;policyVersion:string})=>void;
    vi.mocked(f.gate.authorize).mockImplementationOnce(async()=>new Promise(resolve=>{finish=resolve;}));
    const pending=coordinator.generate('lesson-1'),rejected=expect(pending).rejects.toThrow(/cancel/i);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));coordinator.cancel('lesson-1');await rejected;
    finish({token:'late',binding:'late',policyVersion:'fixture-policy'});await Promise.resolve();expect(complete).not.toHaveBeenCalled();
  });
  it('rejects unapproved narration before local synthesis and reuses approved text offline',async()=>{
    const f=safetyGateFixture(),synthesize=vi.fn(async()=>({samples:new Float32Array([0]),sampleRate:24000}));
    const speech=new SpeechProvider({safety:f.gate,local:{synthesize,status:async()=>({recognitionReady:false,synthesisReady:true}),transcribe:async()=>'',installModel:async()=>({recognitionReady:false,synthesisReady:true}),cancel(){},dispose(){}},keyStore:{has:()=>false,load:()=>undefined,save(){},clear(){}},preferences:{getPreference:()=>undefined,setPreference(){}}});
    await expect(speech.synthesize('A harmless-looking but unreviewed sentence.')).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
    expect(synthesize).not.toHaveBeenCalled();
    f.allow('Mass attracts mass.');await expect(speech.synthesize('Mass attracts mass.')).resolves.toMatchObject({sampleRate:24000});
    expect(synthesize).toHaveBeenCalledTimes(1);expect(f.gate.inspect).not.toHaveBeenCalled();speech.dispose();
  });
  it('checks spoken text after narration markup is removed before any synthesis',async()=>{
    const f=safetyGateFixture(),text='Write er*otic story.',synthesize=vi.fn(async()=>null);f.allow(text);
    const speech=new SpeechProvider({safety:f.gate,local:{synthesize,status:async()=>({recognitionReady:false,synthesisReady:true}),transcribe:async()=>'',installModel:async()=>({recognitionReady:false,synthesisReady:true}),cancel(){},dispose(){}},keyStore:{has:()=>false,load:()=>undefined,save(){},clear(){}},preferences:{getPreference:()=>undefined,setPreference(){}}});
    await expect(speech.synthesize(text)).rejects.toMatchObject({code:'LEARNER_CONTENT_BLOCKED'});expect(synthesize).not.toHaveBeenCalled();speech.dispose();
  });
  it('binds saved PDF bytes and document approval before offline opening',async()=>{
    const f=safetyGateFixture(),document=notesFixture(),rootDirectory=await scratch(),values=new Map<string,string>();
    const repository=new NotesRepository({rootDirectory,safety:f.gate,preferences:{getPreference:key=>values.get(key),setPreference:(key,value)=>{values.set(key,value);}}});
    await expect(repository.save(document,pdf)).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
    f.allow(document);const record=await repository.save(document,pdf),path=await repository.pdfPath(record.sessionId,record.id);
    const exact=await repository.pdfBytes(record.sessionId,record.id);expect(Buffer.from(exact)).toEqual(pdf);
    expect(await readFile(path)).toEqual(pdf);expect(f.gate.inspect).not.toHaveBeenCalled();
    const preference=[...values.keys()].find(key=>key.startsWith('lesson-notes:'))!;
    values.set(preference,JSON.stringify({...record,title:'Changed unreviewed note title'}));
    await expect(repository.latest(record.sessionId)).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});values.set(preference,JSON.stringify(record));
    await writeFile(path,Buffer.from('%PDF-1.7\n% changed unreviewed bytes\n%%EOF\n'));
    expect(Buffer.from(exact)).toEqual(pdf);await expect(repository.pdfBytes(record.sessionId,record.id)).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
    await expect(repository.pdfPath(record.sessionId,record.id)).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
    await writeFile(path,pdf);await writeFile(join(dirname(path),`${record.id}.json`),JSON.stringify({...document,topic:'Changed but superficially safe topic'}));
    await expect(repository.pdfPath(record.sessionId,record.id)).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});
  });
  it('reviews full extracted material before publication and keeps unknown legacy material hidden offline',async()=>{
    const root=await scratch(),path=join(root,'source.txt');await writeFile(path,'First approved passage.\nSecond passage must be checked too.');
    const f=safetyGateFixture(),options={rootDirectory:join(root,'materials'),safety:f.gate};
    const service=new DocumentService(options),[manifest]=await service.importPaths([path]);
    expect(f.gate.inspect).toHaveBeenCalledTimes(1);
    const checked=(f.gate.inspect as ReturnType<typeof vi.fn>).mock.calls[0][0] as {manifest:{name:string};sections:Array<{text:string}>};
    expect(checked.manifest.name).toBe('source.txt');expect(checked.sections.map(s=>s.text).join('')).toContain('Second passage must be checked too.');
    expect(service.listDocuments()).toHaveLength(1);
    const unknown=safetyGateFixture(),reopened=new DocumentService({rootDirectory:options.rootDirectory,safety:unknown.gate});await reopened.initialize();
    expect(reopened.listDocuments()).toEqual([]);expect(()=>reopened.getSections(manifest.id)).toThrow(/review/);
    expect(unknown.gate.inspect).not.toHaveBeenCalled();
    await reopened.reviewDocument(manifest.id);expect(reopened.getSections(manifest.id)[0].text).toContain('First approved passage');
  });
  it('does not publish extracted material when semantic inspection fails',async()=>{
    const root=await scratch(),path=join(root,'source.txt');await writeFile(path,'This material requires a semantic policy decision.');
    const f=safetyGateFixture();vi.mocked(f.gate.inspect).mockRejectedValueOnce(f.error());
    const service=new DocumentService({rootDirectory:join(root,'materials'),safety:f.gate});
    await expect(service.importPaths([path])).rejects.toMatchObject({code:'LEARNER_SAFETY_REVIEW'});expect(service.listDocuments()).toEqual([]);
  });
});
