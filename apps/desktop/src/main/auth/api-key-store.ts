import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {OSProtection} from './credential-store';

export type ApiKeyRecord={key:string;credentialRevision:string};
export type StagedApiKey={commit():void;rollback():void};
const validRecord=(value:unknown):value is ApiKeyRecord=>{
  if(!value||typeof value!=='object')return false;
  const record=value as Partial<ApiKeyRecord>;
  return typeof record.key==='string'&&/^[!-~]{1,512}$/.test(record.key)&&typeof record.credentialRevision==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.credentialRevision);
};
export class ApiKeyStore {
  constructor(private path:string,private protection:OSProtection){}
  has(){return existsSync(this.path);}
  private requireProtection(){
    if(!this.protection.isEncryptionAvailable()||this.protection.getSelectedStorageBackend?.()==='basic_text')throw new Error('Operating system credential protection is unavailable. Enable protected storage before saving an API key.');
  }
  load():ApiKeyRecord|undefined{
    if(!this.has())return undefined;this.requireProtection();
    try{const value:unknown=JSON.parse(this.protection.decryptString(readFileSync(this.path)));if(!validRecord(value))throw new Error();return value;}
    catch{throw new Error('The saved API key could not be unlocked. Remove it and connect again.');}
  }
  stage(value:ApiKeyRecord):StagedApiKey{
    this.requireProtection();if(!validRecord(value))throw new Error('The API key record is invalid. Connect again.');
    // The canonical encrypted record remains readable until the caller commits.
    // Rolling back only removes the staged sibling and never needs protection or a rewrite.
    const encrypted=this.protection.encryptString(JSON.stringify(value));const temporary=`${this.path}.${randomUUID()}.tmp`;
    mkdirSync(dirname(this.path),{recursive:true});
    try{writeFileSync(temporary,encrypted,{mode:0o600});}
    catch(error){rmSync(temporary,{force:true});throw error;}
    let state:'staged'|'committed'|'rolled-back'='staged';
    return {
      commit:()=>{
        if(state==='committed')return;
        if(state==='rolled-back')throw new Error('The API key replacement was canceled. Connect again.');
        renameSync(temporary,this.path);state='committed';
      },
      rollback:()=>{if(state!=='staged')return;rmSync(temporary,{force:true});state='rolled-back';}
    };
  }
  save(value:ApiKeyRecord){
    const staged=this.stage(value);try{staged.commit();}finally{staged.rollback();}
  }
  clear(){rmSync(this.path,{force:true});}
}
