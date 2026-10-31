import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiKeyStore} from '../../apps/desktop/src/main/auth/api-key-store';

const directories:string[]=[];
const protect={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(Buffer.from(value).map(v=>v^123)),decryptString:(value:Buffer)=>Buffer.from(Buffer.from(value).map(v=>v^123)).toString()};
const record={key:'fixture-secret-key',credentialRevision:'0ec246d1-c887-44c9-85d4-629fbf649c73'};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'canvas-ai-key-'));directories.push(dir);const path=join(dir,'gemini-key.enc');return {path,store:new ApiKeyStore(path,protect)};}
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
describe('API key protected persistence',()=>{
  it('stages encrypted replacements without exposing them to readers until commit',()=>{
    const {path,store}=fixture();store.save(record);const previous=readFileSync(path);
    const next={...record,key:'replacement-fixture',credentialRevision:'729d45b5-e710-4ad9-b2ef-6ba512ebf330'};
    const replacement=store.stage(next);expect(readFileSync(path)).toEqual(previous);expect(store.load()).toEqual(record);
    replacement.commit();expect(new ApiKeyStore(path,protect).load()).toEqual(next);
  });
  it('rolls back staged replacements without re-encrypting or rewriting canonical credentials',()=>{
    const {path,store}=fixture();store.save(record);const previous=readFileSync(path);
    let encryptionEnabled=true;
    const failing=new ApiKeyStore(path,{...protect,encryptString:value=>{if(!encryptionEnabled)throw new Error('Protection failed');return protect.encryptString(value);}});
    const replacement=failing.stage({...record,key:'replacement-fixture'});encryptionEnabled=false;
    replacement.rollback();expect(readFileSync(path)).toEqual(previous);expect(store.load()).toEqual(record);
  });
  it('encrypts the key and durable credential revision together and removes both',()=>{
    const {path,store}=fixture();expect(store.load()).toBeUndefined();store.save(record);
    expect(store.has()).toBe(true);expect(readFileSync(path).toString()).not.toContain(record.key);
    expect(new ApiKeyStore(path,protect).load()).toEqual(record);
    store.clear();expect(store.has()).toBe(false);expect(store.load()).toBeUndefined();
  });
  it.each([false,'basic_text'])('rejects unprotected storage (%s) without replacing saved credentials',backend=>{
    const {path,store}=fixture();store.save(record);
    const unsafe=new ApiKeyStore(path,{...protect,isEncryptionAvailable:()=>backend!==false,getSelectedStorageBackend:()=>String(backend)});
    expect(()=>unsafe.save({...record,key:'replacement-fixture'})).toThrow(/protect/i);
    expect(store.load()).toEqual(record);
  });
  it('preserves the previous record when encryption fails',()=>{
    const {path,store}=fixture();store.save(record);
    const failing=new ApiKeyStore(path,{...protect,encryptString:()=>{throw new Error('Encryption failed');}});
    expect(()=>failing.save({...record,key:'replacement-fixture'})).toThrow();expect(store.load()).toEqual(record);
  });
  it('rejects malformed encrypted records without exposing their contents',()=>{
    const {path,store}=fixture();writeFileSync(path,protect.encryptString(JSON.stringify({key:'fixture-secret-key',credentialRevision:'bad'})));
    expect(()=>store.load()).toThrow(/unlock|connect/i);
    try{store.load();}catch(error){expect(String(error)).not.toContain('fixture-secret-key');}
  });
});
