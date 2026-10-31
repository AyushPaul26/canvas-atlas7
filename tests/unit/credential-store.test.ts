import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CredentialStore} from '../../apps/desktop/src/main/auth/credential-store';
describe('protected credential file',()=>{
  it('requires OS protection and writes only encrypted bytes',()=>{
    const dir=mkdtempSync(join(tmpdir(),'canvas-credentials-'));
    try {
      const protect={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(Buffer.from(value).map(v=>v^123)),decryptString:(value:Buffer)=>Buffer.from(Buffer.from(value).map(v=>v^123)).toString()};
      const file=join(dir,'account.enc');const store=new CredentialStore(file,protect);
      store.save({accessToken:'private-access',clientId:'oaiapp_test'} as any);
      expect(readFileSync(file).toString()).not.toContain('private-access');
      expect(store.load()?.accessToken).toBe('private-access');
      store.clear();expect(store.load()).toBeUndefined();
      const unavailable=new CredentialStore(file,{...protect,isEncryptionAvailable:()=>false});
      expect(()=>unavailable.save({} as any)).toThrow(/protection/i);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
