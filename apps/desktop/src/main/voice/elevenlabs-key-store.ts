import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {OSProtection} from '../auth/credential-store';

export class ElevenLabsKeyStore {
  constructor(private path:string,private protection:OSProtection){}
  has(){return existsSync(this.path);}
  private protected(){if(!this.protection.isEncryptionAvailable()||this.protection.getSelectedStorageBackend?.()==='basic_text')throw new Error('OS credential protection is unavailable. Enable protected storage before saving your ElevenLabs key.');}
  load(){if(!this.has())return undefined;this.protected();try{return this.protection.decryptString(readFileSync(this.path));}catch{throw new Error('The saved ElevenLabs key could not be unlocked. Remove it and connect again.');}}
  save(value:string){this.protected();mkdirSync(dirname(this.path),{recursive:true});writeFileSync(`${this.path}.tmp`,this.protection.encryptString(value),{mode:0o600});renameSync(`${this.path}.tmp`,this.path);}
  clear(){rmSync(this.path,{force:true});rmSync(`${this.path}.tmp`,{force:true});}
}
