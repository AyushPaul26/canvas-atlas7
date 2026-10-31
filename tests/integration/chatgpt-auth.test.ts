import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {ChatGPTAuth,type CredentialRecord} from '../../apps/desktop/src/main/auth/chatgpt-auth';

async function fixture(hooks:{callback?:(url:URL)=>void;claims?:(claims:any)=>void;tamperSignature?:boolean}={}){
  const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);jwk.kid='test';
  let current:CredentialRecord|undefined;const values=new Map<string,string>();let tokenRequests=0;let lastBody:URLSearchParams|undefined;
  const store={load:()=>current,save:(value:CredentialRecord)=>{current=value;},clear:()=>{current=undefined;},getSetting:(k:string)=>values.get(k),setSetting:(k:string,v:string)=>{values.set(k,v);}};
  const auth=new ChatGPTAuth({store,openExternal:async(url)=>{
    const parsed=new URL(url);const callback=new URL(parsed.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code','test-code');callback.searchParams.set('state',parsed.searchParams.get('state')!);callback.searchParams.set('client_id','oaiapp_test');
    const verifierPromise=parsed.searchParams.get('code_challenge');
    nonce=parsed.searchParams.get('nonce')!;challenge=verifierPromise!;
    hooks.callback?.(callback);
    await fetch(callback);
  },fetch:async(url,init)=>{
    const address=String(url);
    if(address.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/api/accounts/authorize',token_endpoint:'https://auth.openai.com/api/accounts/oauth/token',jwks_uri:'https://auth.openai.com/.well-known/jwks.json'});
    if(address.endsWith('jwks.json'))return Response.json({keys:[jwk]});
    tokenRequests++;lastBody=new URLSearchParams(String(init?.body));
    const claims={nonce,email:'learner@example.test'};hooks.claims?.(claims);
    let idToken=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setSubject('student').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
    if(hooks.tamperSignature){const parts=idToken.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);idToken=parts.join('.');}
    return Response.json({id_token:idToken,access_token:'secret-access',refresh_token:'secret-refresh',token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
  },timeoutMs:300});
  let nonce='',challenge='';
  return {auth,store,get current(){return current;},get requests(){return tokenRequests;},get body(){return lastBody;},get challenge(){return challenge;}};
}
describe('official fresh authorization',()=>{
  it('validates JWT and uses issued client with original PKCE, keeps host stable, exposes no credentials',async()=>{
    const f=await fixture();const status=await f.auth.signIn();
    expect(status).toMatchObject({connected:true,planEnabled:true,account:{id:'student'}});
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(f.body?.get('client_id')).toBe('oaiapp_test');
    expect(createHash('sha256').update(f.body!.get('code_verifier')!).digest('base64url')).toBe(f.challenge);
    const host=f.store.getSetting('hostId');expect(host).toMatch(/^urn:uuid:/);
    await f.auth.signIn();expect(f.store.getSetting('hostId')).toBe(host);
  });
  it('serializes refreshes and sign-out erases only app credentials',async()=>{
    const f=await fixture();await f.auth.signIn();f.current!.expiresAt=0;
    const results=await Promise.all([f.auth.accessToken(),f.auth.accessToken(),f.auth.accessToken()]);
    expect(results).toEqual(['secret-access','secret-access','secret-access']);expect(f.requests).toBe(2);
    await f.auth.signOut();expect(f.store.load()).toBeUndefined();expect(f.store.getSetting('hostId')).toBeDefined();
  });
  it('rejects mismatched state, altered callback host/path, nonce and signature without saving tokens',async()=>{
    for(const callback of [(url:URL)=>url.searchParams.set('state','wrong'),(url:URL)=>{url.pathname='/callback';},(url:URL)=>{url.hostname='localhost';}]){
      const f=await fixture({callback});await expect(f.auth.signIn()).rejects.toThrow();expect(f.requests).toBe(0);expect(f.current).toBeUndefined();
    }
    for(const hooks of [{claims:(claims:any)=>{claims.nonce='wrong';}},{tamperSignature:true}]){
      const f=await fixture(hooks);await expect(f.auth.signIn()).rejects.toThrow();expect(f.current).toBeUndefined();
    }
  });
  it('retains an active account when reauthorization is canceled',async()=>{
    const hooks:{callback?:(url:URL)=>void}={};const f=await fixture(hooks);await f.auth.signIn();const original=f.current;
    hooks.callback=url=>url.searchParams.set('error','access_denied');
    await expect(f.auth.signIn()).rejects.toThrow();expect(f.current).toBe(original);expect(f.auth.status().connected).toBe(true);
  });
});
