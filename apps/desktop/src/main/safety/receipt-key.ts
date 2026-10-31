import {randomBytes,randomUUID} from 'node:crypto';
import {ApiKeyStore} from '../auth/api-key-store';
import type {OSProtection} from '../auth/credential-store';

/** Receipt signatures use an app-owned, OS-protected key, never a provider key. */
export function loadSafetyReceiptKey(path:string,protection:OSProtection):{secret:Uint8Array;persistent:boolean}{
  try{
    const store=new ApiKeyStore(path,protection),saved=store.load();
    if(saved&&/^[\da-f]{64}$/i.test(saved.key))return {secret:Buffer.from(saved.key,'hex'),persistent:true};
    const secret=randomBytes(32);store.save({key:secret.toString('hex'),credentialRevision:randomUUID()});return {secret,persistent:true};
  }catch{
    // Protected storage failures never approve an unknown old artifact. The
    // current process can still review online; restart requires review again.
    return {secret:randomBytes(32),persistent:false};
  }
}
