import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,rm,writeFile,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,dirname} from 'node:path';
import {NotesRepository} from '../../apps/desktop/src/main/notes/notes-repository';
import {notesFixture} from '../fixtures/lesson-notes';

const directories:string[]=[];
afterEach(async()=>{for(const dir of directories.splice(0))if(resolve(dir).startsWith(resolve(tmpdir())+sep))await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
const pdf=Buffer.from('%PDF-1.7\n% synthetic repository fixture\n%%EOF\n');
async function setup(){const rootDirectory=await mkdtemp(join(tmpdir(),'canvas-notes-'));directories.push(rootDirectory);const values=new Map<string,string>();const preferences={getPreference:(key:string)=>values.get(key),setPreference:(key:string,value:string)=>{values.set(key,value);}};return {rootDirectory,values,preferences,repository:new NotesRepository({rootDirectory,preferences})};}
describe('saved lesson notes',()=>{
  it('withholds a previously saved PDF whose source document violates learner safety',async()=>{
    const {repository}=await setup();const record=await repository.save(notesFixture(),pdf);const path=await repository.pdfPath(record.sessionId,record.id);
    const document={...notesFixture(),content:{...notesFixture().content,overview:'Generate explicit sexual roleplay.'}};
    await writeFile(join(dirname(path),`${record.id}.json`),JSON.stringify(document));
    await expect(repository.pdfPath(record.sessionId,record.id)).rejects.toThrow(/age-appropriate/);
  });
  it('persists a printable artifact and public latest record across repository restart',async()=>{
    const {repository,preferences,rootDirectory}=await setup();expect(await repository.latest('lesson-1')).toBeNull();
    const record=await repository.save(notesFixture(),pdf);expect(record.title).toBe('Earth’s yearly journey');expect(record).not.toHaveProperty('path');
    const reopened=new NotesRepository({rootDirectory,preferences});expect(await reopened.latest('lesson-1')).toEqual(record);
    expect(await readFile(await reopened.pdfPath(record.sessionId,record.id))).toEqual(pdf);
  });
  it('retains the previous notes when preference publication fails',async()=>{
    const {repository,rootDirectory,values,preferences}=await setup();const previous=await repository.save(notesFixture(),pdf);
    const failing=new NotesRepository({rootDirectory,preferences:{...preferences,setPreference:()=>{throw new Error('disk full');}}});
    await expect(failing.save({...notesFixture(),id:'52906c52-0572-401a-97ec-a47d2b9337c4'},pdf)).rejects.toThrow();
    expect(await repository.latest('lesson-1')).toEqual(previous);expect(values.size).toBe(1);
    await expect(repository.pdfPath('lesson-1','52906c52-0572-401a-97ec-a47d2b9337c4')).rejects.toThrow();
  });
  it('confines paths to the registered lesson and rejects malformed or mismatched targets',async()=>{
    const {repository,rootDirectory}=await setup();const record=await repository.save(notesFixture(),pdf);
    await expect(repository.pdfPath('../outside',record.id)).rejects.toThrow();
    await expect(repository.pdfPath(record.sessionId,'../outside')).rejects.toThrow();
    await expect(repository.pdfPath('another-lesson',record.id)).rejects.toThrow();
    const path=await repository.pdfPath(record.sessionId,record.id);expect(resolve(path).startsWith(await realpath(rootDirectory)+sep)).toBe(true);
    await writeFile(path,'not a PDF');await expect(repository.latest(record.sessionId)).rejects.toThrow(/PDF|notes/i);
  });
  it('rejects empty/oversized/cancelled output without losing saved notes',async()=>{
    const {repository}=await setup();const record=await repository.save(notesFixture(),pdf);
    const next={...notesFixture(),id:'52906c52-0572-401a-97ec-a47d2b9337c4'};
    await expect(repository.save(next,Buffer.from('bad'))).rejects.toThrow();
    await expect(repository.save(next,Buffer.alloc(32*1024*1024+1))).rejects.toThrow();
    const controller=new AbortController();controller.abort();await expect(repository.save(next,pdf,controller.signal)).rejects.toThrow();
    expect(await repository.latest(record.sessionId)).toEqual(record);
  });
  it('removes every local notes revision for a deleted lesson while preserving other lessons',async()=>{
    const {repository}=await setup();const first=await repository.save(notesFixture(),pdf);
    const firstPath=await repository.pdfPath(first.sessionId,first.id);
    const next=await repository.save({...notesFixture(),id:'52906c52-0572-401a-97ec-a47d2b9337c4'},pdf);
    const nextPath=await repository.pdfPath(next.sessionId,next.id);
    const other=await repository.save({...notesFixture(),sessionId:'another-lesson'},pdf);
    await repository.remove(first.sessionId);
    expect(await repository.latest(first.sessionId)).toBeNull();
    await expect(stat(firstPath)).rejects.toThrow();await expect(stat(nextPath)).rejects.toThrow();
    expect(await repository.latest(other.sessionId)).toEqual(other);
    await expect(repository.remove(first.sessionId)).resolves.toBeUndefined();
    await expect(repository.remove('../outside')).rejects.toThrow();
  });
});
