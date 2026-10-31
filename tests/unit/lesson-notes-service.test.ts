import {describe,it,expect,vi} from 'vitest';
import type {LessonSession} from '@living-canvas/protocol';
import {LessonNotesService} from '../../apps/desktop/src/main/notes/notes-service';
import {buildStudiedContent} from '../../apps/desktop/src/main/notes/studied-content';
import {notesFixture} from '../fixtures/lesson-notes';

const lesson=():LessonSession=>({id:'lesson-1',title:'Earth',topic:'Earth’s journey around the Sun',createdAt:'2026-10-31T12:00:00.000Z',updatedAt:'2026-10-31T12:00:00.000Z',messages:[{id:'heard-1',role:'tutor',text:'Earth rotates each day and revolves around the Sun each year.',createdAt:'2026-10-31T12:00:00.000Z'}],beats:[],scene:[],controls:{}});
const pdf:Buffer=Buffer.from('%PDF-1.7\n% synthetic service fixture\n%%EOF\n');
function setup(){
  let current=lesson();const document={...notesFixture(),coverageHash:buildStudiedContent(current).coverageHash,studiedSteps:1};
  const coordinator={generate:vi.fn(async()=>document),generateLocal:vi.fn(async()=>({...document,modelMetadata:{providerId:'local',requestedModel:'local-extract',completedAt:document.createdAt}})),cancel:vi.fn(),cancelAll:vi.fn()};
  const renderer={render:vi.fn(async()=>pdf),open:vi.fn(async()=>{}),dispose:vi.fn()};
  const repository={save:vi.fn(async()=>({id:document.id,sessionId:document.sessionId,title:document.content.title})),latest:vi.fn(async()=>null),pdfPath:vi.fn(async()=>'/registered/notes.pdf'),remove:vi.fn(async()=>{})};
  const service=new LessonNotesService({sessions:{load:()=>current},coordinator,pdf:renderer,repository} as any);
  return {service,coordinator,renderer,repository,change:()=>{current={...current,messages:[...current.messages,{id:'heard-2',role:'tutor',text:'New presented content.',createdAt:'2026-10-31T12:01:00.000Z'}]};}};
}
describe('lesson notes lifecycle',()=>{
  it('creates an offline PDF without checking model readiness or calling AI',async()=>{
    const {service,coordinator,repository,renderer}=setup();const readiness=vi.fn(async()=>{throw new Error('No teaching connection');});
    await service.generate('lesson-1',readiness,'local');
    expect(readiness).not.toHaveBeenCalled();expect(coordinator.generate).not.toHaveBeenCalled();
    expect(coordinator.generateLocal).toHaveBeenCalledTimes(1);expect(renderer.render).toHaveBeenCalledTimes(1);expect(repository.save).toHaveBeenCalledTimes(1);
  });
  it('generates once, prints locally and publishes only the current coverage',async()=>{
    const {service,coordinator,renderer,repository}=setup();
    await service.generate('lesson-1');expect(coordinator.generate).toHaveBeenCalledTimes(1);expect(renderer.render).toHaveBeenCalledTimes(1);expect(repository.save).toHaveBeenCalledTimes(1);
    service.dispose();expect(renderer.dispose).toHaveBeenCalled();
  });
  it('opens and locates saved PDFs without generating content',async()=>{
    const {service,coordinator,repository,renderer}=setup();await service.latest('lesson-1');await service.open('lesson-1','ab84c5a1-d0e1-447f-b75b-309568fe4a70');
    expect(repository.pdfPath).toHaveBeenCalledWith('lesson-1','ab84c5a1-d0e1-447f-b75b-309568fe4a70');expect(renderer.open).toHaveBeenCalled();expect(coordinator.generate).not.toHaveBeenCalled();
  });
  it('deduplicates clicks and cancels an ignored PDF abort without publishing late output',async()=>{
    const {service,renderer,repository,coordinator}=setup();let finish!:(value:Buffer)=>void;
    renderer.render.mockImplementation(()=>new Promise<Buffer>(resolve=>{finish=resolve;}));
    const first=service.generate('lesson-1');const rejected=expect(first).rejects.toThrow(/cancel/i);
    await vi.waitFor(()=>expect(renderer.render).toHaveBeenCalled());await expect(service.generate('lesson-1')).rejects.toThrow(/already/i);
    service.cancel('lesson-1');await rejected;finish(pdf);await Promise.resolve();
    expect(repository.save).not.toHaveBeenCalled();expect(coordinator.generate).toHaveBeenCalledTimes(1);
  });
  it('does not publish a PDF if more teaching was presented while it rendered',async()=>{
    const {service,renderer,repository,change}=setup();renderer.render.mockImplementation(async()=>{change();return pdf;});
    await expect(service.generate('lesson-1')).rejects.toThrow(/changed/i);expect(repository.save).not.toHaveBeenCalled();
  });
  it('settles print failures and permits a new explicit generation',async()=>{
    const {service,renderer,repository,coordinator}=setup();renderer.render.mockRejectedValueOnce(new Error('PDF renderer failed.'));
    await expect(service.generate('lesson-1')).rejects.toThrow(/PDF/);expect(repository.save).not.toHaveBeenCalled();
    await service.generate('lesson-1');expect(coordinator.generate).toHaveBeenCalledTimes(2);
  });
  it.each(['coordinator','renderer'] as const)('observes a synchronous %s cancellation followed by transport rejection',async stage=>{
    const {service,coordinator,renderer,repository}=setup();
    const failing=()=>{service.cancel('lesson-1');return Promise.reject(new Error('late synthetic rejection'));};
    if(stage==='coordinator')Object.assign(coordinator,{generate:failing});else Object.assign(renderer,{render:failing});
    await expect(service.generate('lesson-1')).rejects.toThrow(/cancel/i);
    await new Promise(resolve=>setImmediate(resolve));expect(repository.save).not.toHaveBeenCalled();
  });
  it('reserves cancellation before waiting for model readiness and never starts the cancelled AI request',async()=>{
    const {service,coordinator,repository}=setup();let ready!:()=>void;
    const readiness=new Promise<void>(resolve=>{ready=resolve;});
    const pending=service.generate('lesson-1',()=>readiness);const rejected=expect(pending).rejects.toThrow(/cancel/i);
    service.cancel('lesson-1');ready();await rejected;
    expect(coordinator.generate).not.toHaveBeenCalled();expect(repository.save).not.toHaveBeenCalled();
  });
  it('cancels pending notes before removing a deleted lesson’s local artifacts',async()=>{
    const {service,coordinator,repository}=setup();let ready!:()=>void;
    const pending=service.generate('lesson-1',()=>new Promise<void>(resolve=>{ready=resolve;}));
    const rejected=expect(pending).rejects.toThrow(/cancel/i);
    await service.remove('lesson-1');ready();await rejected;
    expect(repository.remove).toHaveBeenCalledWith('lesson-1');expect(coordinator.generate).not.toHaveBeenCalled();
  });
});
