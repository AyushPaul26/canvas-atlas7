import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {CredentialRecord,CredentialStorage} from './chatgpt-auth';
export type OSProtection={isEncryptionAvailable():boolean;encryptString(value:string):Buffer;decryptString(value:Buffer):string;getSelectedStorageBackend?():string};

export class CredentialStore implements CredentialStorage {
  constructor(private path:string,private protection:OSProtection){}
  private requireProtection(){if(!this.protection.isEncryptionAvailable()||this.protection.getSelectedStorageBackend?.()==='basic_text')throw new Error('Operating system credential protection is unavailable. Enable a protected key store before signing in.');}
  load():CredentialRecord|undefined {
    if(!existsSync(this.path))return undefined;this.requireProtection();
    try{return JSON.parse(this.protection.decryptString(readFileSync(this.path))) as CredentialRecord;}
    catch{throw new Error('Saved ChatGPT credentials could not be unlocked. Sign out locally and reconnect.');}
  }
  private atomic(path:string,value:Uint8Array|string){mkdirSync(dirname(path),{recursive:true});writeFileSync(`${path}.tmp`,value,{mode:0o600});renameSync(`${path}.tmp`,path);}
  save(value:CredentialRecord){this.requireProtection();this.atomic(this.path,this.protection.encryptString(JSON.stringify(value)));}
  clear(){rmSync(this.path,{force:true});}
  getSetting(key:string):string|undefined{const path=`${this.path}.settings.json`;if(!existsSync(path))return undefined;return (JSON.parse(readFileSync(path,'utf8')) as Record<string,string>)[key];}
  setSetting(key:string,value:string){const path=`${this.path}.settings.json`;const values=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,string>:{};values[key]=value;this.atomic(path,JSON.stringify(values));}
}
