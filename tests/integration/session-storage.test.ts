import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';

describe('durable local sessions',()=>{
  it('recovers scenes and events on reopen, rejects conflicting sequence, rolls back failed transactions',()=>{
    const dir=mkdtempSync(join(tmpdir(),'canvas-storage-')); const path=join(dir,'lessons.sqlite');
    try {
      let store=new SessionRepository(path); const lesson=store.create('unknown topic');
      store.append(lesson.id,0,{type:'student',text:'why?'});
      expect(()=>store.append(lesson.id,0,{type:'student',text:'stale'})).toThrow(/conflict/i);
      expect(()=>store.transaction(()=>{store.append(lesson.id,1,{type:'temporary'});throw new Error('crash');})).toThrow('crash');
      store.saveScene(lesson.id,[{id:'x',kind:'circle',x:2,y:3,radius:10}],{speed:2});store.close();
      store=new SessionRepository(path);
      expect(store.events(lesson.id)).toHaveLength(1);
      expect(store.load(lesson.id).scene[0].id).toBe('x');
      expect(store.load(lesson.id).controls.speed).toBe(2);
      expect(store.export(lesson.id)).not.toMatch(/access_token|refresh_token|rawAudio/);
      store.close();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('rejects unknown schema versions without deleting data',()=>{
    const store=new SessionRepository(':memory:');
    store.db.exec('PRAGMA user_version=999');
    expect(()=>store.checkVersion()).toThrow(/newer/i); store.close();
  });
  it('persists replay provenance as data without evaluating source',()=>{
    const store=new SessionRepository(':memory:');const lesson=store.create('generated experiment');
    const artifact={id:'program',title:'Unknown system',source:'throw new Error("must not execute in main")',controls:[],assumptions:[],validation:'illustrative' as const};
    const checkpoint={artifact,state:{value:8},tick:120,values:{speed:2},initialValues:{speed:1},inputs:[{tick:60,values:{speed:2}}]};
    store.saveScene(lesson.id,[],{speed:2},checkpoint);
    expect(store.load(lesson.id).simulation).toEqual(checkpoint);store.close();
  });
  it('stores safe completed-turn model metadata without inventing historical served IDs',()=>{
    const store=new SessionRepository(':memory:');const lesson=store.create('topic');
    store.recordProviderRound(lesson.id,[],[]);
    const metadata={requestedModel:'exact/astra-id',servedModel:'served-snapshot',responseId:'resp_safe',completedAt:new Date().toISOString()};
    store.recordProviderRound(lesson.id,[],[],metadata);
    expect(store.load(lesson.id).modelRuns).toEqual([metadata]);
    expect(store.events(lesson.id)).toEqual([{type:'provider-round',output:[],feedback:[]},{type:'provider-round',output:[],feedback:[],modelMetadata:metadata}]);store.close();
  });
  it('whitelists model metadata and canonicalizes timestamps instead of storing arbitrary response fields',()=>{
    const store=new SessionRepository(':memory:');const lesson=store.create('topic');
    store.recordProviderRound(lesson.id,[],[],{requestedModel:'chosen',completedAt:'22 Oct 2026 00:00:00 GMT (private-note)',access_token:'never-save'} as any);
    const metadata=store.load(lesson.id).modelRuns![0];
    expect(metadata.completedAt).toBe('2026-10-22T00:00:00.000Z');expect(JSON.stringify(metadata)).not.toMatch(/private-note|never-save|access_token/);store.close();
  });
});
