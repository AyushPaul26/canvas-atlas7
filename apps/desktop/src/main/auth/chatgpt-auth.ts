import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {createRemoteJWKSet,customFetch,jwtVerify,type JWTPayload} from 'jose';
import type {AppStatus} from '@living-canvas/protocol';
import {providerError} from '../ai/tool-stream';

const ISSUER='https://auth.openai.com';const RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export type CredentialRecord={issuer:string;subject:string;name?:string;email?:string;clientId:string;hostId:string;accessToken:string;refreshToken?:string;idToken:string;scopes:string[];expiresAt:number};
export type CredentialStorage={load():CredentialRecord|undefined;save(value:CredentialRecord):void;clear():void;getSetting(key:string):string|undefined;setSetting(key:string,value:string):void};
type Discovery={issuer:string;authorization_endpoint:string;token_endpoint:string;jwks_uri:string;revocation_endpoint?:string};
type Options={store:CredentialStorage;openExternal:(url:string)=>Promise<unknown>;fetch?:typeof fetch;timeoutMs?:number};
type Pending={state:string;nonce:string;verifier:string;callback:string;clientId:string;registration?:CredentialRecord;hostId:string};
const secureEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

export class ChatGPTAuth {
  private request:typeof fetch;private discovery?:Discovery;private refresh?:Promise<string>;private signInPromise?:Promise<AppStatus>;private abortSignIn?:()=>void;private generation=0;private current?:CredentialRecord;private credentialError?:string;
  constructor(private options:Options){this.request=options.fetch??fetch;try{this.current=options.store.load();}catch{this.credentialError='Saved ChatGPT credentials could not be unlocked. Sign out locally and reconnect.';}}
  status():AppStatus {const active=this.current;return {connected:!!active,planEnabled:!!active?.scopes.includes('chatgpt.tokens.use.direct'),desktop:true,...(this.credentialError?{error:this.credentialError}:{}),...(active?{account:{id:active.subject,...(active.name?{name:active.name}:{}),...(active.email?{email:active.email}:{})}}:{})};}
  private async discover():Promise<Discovery>{
    if(this.discovery)return this.discovery;
    const response=await this.request(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('ChatGPT sign-in is temporarily unavailable.');
    const data=await response.json() as Discovery;
    if(data.issuer!==ISSUER||[data.authorization_endpoint,data.token_endpoint,data.jwks_uri,...(data.revocation_endpoint?[data.revocation_endpoint]:[])].some(endpoint=>new URL(endpoint).origin!==ISSUER))throw new Error('ChatGPT identity discovery did not match the trusted issuer.');
    this.discovery=data;return data;
  }
  async signIn():Promise<AppStatus>{
    if(this.signInPromise)return this.signInPromise;
    this.signInPromise=this.performSignIn().finally(()=>{this.signInPromise=undefined;this.abortSignIn=undefined;});return this.signInPromise;
  }
  private async performSignIn():Promise<AppStatus>{
    const generation=this.generation;const discovery=await this.discover();if(generation!==this.generation)throw new Error('ChatGPT sign-in was canceled.');
    let hostId=this.options.store.getSetting('hostId');if(!hostId){hostId=`urn:uuid:${randomUUID()}`;this.options.store.setSetting('hostId',hostId);}
    const registration=this.current;const clientId=registration?.clientId??this.options.store.getSetting('clientId')??'dynamic_agent_client';
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(64).toString('base64url');
    let server:Server|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      return await new Promise<AppStatus>((resolve,reject)=>{
        let pending:Pending;let consumed=false;let settled=false;
        const finish=(error?:Error,status?:AppStatus)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);server?.close();if(error)reject(error);else resolve(status??this.status());};
        this.abortSignIn=()=>finish(new Error('ChatGPT sign-in was canceled.'));
        server=createServer((request,response)=>{
          const rejectRequest=(message:string)=>{response.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'});response.end(message);};
          if(!pending||request.method!=='GET'||request.headers.host!==new URL(pending.callback).host)return rejectRequest('Invalid callback.');
          const callback=new URL(request.url??'/',pending.callback);
          if(callback.pathname!=='/auth/callback'||callback.origin!==new URL(pending.callback).origin||consumed)return rejectRequest('Invalid callback.');
          if(!secureEqual(callback.searchParams.get('state')??'',state))return rejectRequest('Invalid sign-in state.');
          consumed=true;
          void this.exchangeCallback(callback,pending,discovery).then(record=>{
            if(settled||generation!==this.generation)throw new Error('ChatGPT sign-in was canceled.');
            this.options.store.save(record);this.options.store.setSetting('clientId',record.clientId);this.options.store.setSetting('subject',record.subject);this.current=record;this.credentialError=undefined;
            response.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});response.end('You are connected to Canvas Atlas. You can close this tab and return to your lesson.');finish(undefined,this.status());
          }).catch(()=>{response.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'});response.end('Sign-in could not be completed. Return to Canvas Atlas and try again.');finish(new Error('ChatGPT sign-in was canceled or could not be verified. Your previous account is unchanged.'));});
        });
        server.on('error',()=>finish(new Error('The local sign-in callback could not be started.')));
        server.listen(0,'127.0.0.1',()=>{
          const address=server!.address();if(!address||typeof address==='string')return finish(new Error('Could not start local sign-in.'));
          pending={state,nonce,verifier,callback:`http://127.0.0.1:${address.port}/auth/callback`,clientId,registration,hostId:hostId!};
          const url=new URL(discovery.authorization_endpoint);url.search=new URLSearchParams({client_id:clientId,ext_agent_host_id:hostId!,response_type:'code',redirect_uri:pending.callback,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
          if(clientId==='dynamic_agent_client')url.searchParams.set('agent_name_hint','Canvas Atlas');
          if(registration?.idToken)url.searchParams.set('id_token_hint',registration.idToken);
          if(registration?.email)url.searchParams.set('login_hint',registration.email);
          timer=setTimeout(()=>finish(new Error('ChatGPT sign-in timed out. Try again when ready.')),this.options.timeoutMs??180000);
          void this.options.openExternal(url.toString()).catch(()=>finish(new Error('The browser could not be opened for ChatGPT sign-in.')));
        });
      });
    }finally{if(timer)clearTimeout(timer);server?.close();}
  }
  private async verify(idToken:string,clientId:string,discovery:Discovery,nonce?:string):Promise<JWTPayload>{
    const jwks=createRemoteJWKSet(new URL(discovery.jwks_uri),{[customFetch]:this.request});
    const {payload}=await jwtVerify(idToken,jwks,{issuer:ISSUER,audience:clientId,requiredClaims:['sub','exp','iat'],clockTolerance:5,algorithms:['RS256','ES256']});
    if(!payload.sub||(nonce!==undefined&&payload.nonce!==nonce))throw new Error('ChatGPT identity could not be verified.');return payload;
  }
  private async token(body:URLSearchParams,discovery:Discovery):Promise<any>{
    const response=await this.request(discovery.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw providerError(undefined,response.status);
    const tokens=await response.json() as any;
    if(typeof tokens.access_token!=='string'||tokens.token_type?.toLowerCase()!=='bearer'||typeof tokens.expires_in!=='number'||tokens.expires_in<=0)throw new Error('ChatGPT returned incomplete credentials.');return tokens;
  }
  private async exchangeCallback(callback:URL,pending:Pending,discovery:Discovery):Promise<CredentialRecord>{
    if(callback.searchParams.has('error'))throw new Error('Sign-in canceled.');
    const issued=callback.searchParams.get('client_id')??pending.clientId;
    if(!issued||issued==='dynamic_agent_client'||(pending.clientId!=='dynamic_agent_client'&&issued!==pending.clientId))throw new Error('ChatGPT registration was incomplete.');
    const code=callback.searchParams.get('code');if(!code)throw new Error('ChatGPT did not return a sign-in code.');
    const tokens=await this.token(new URLSearchParams({grant_type:'authorization_code',client_id:issued,code,code_verifier:pending.verifier,redirect_uri:pending.callback,resource:RESOURCE}),discovery);
    if(typeof tokens.id_token!=='string')throw new Error('ChatGPT did not return an identity token.');
    const identity=await this.verify(tokens.id_token,issued,discovery,pending.nonce);
    const expectedSubject=pending.registration?.subject??(pending.clientId!=='dynamic_agent_client'?this.options.store.getSetting('subject'):undefined);
    if(expectedSubject&&identity.sub!==expectedSubject)throw new Error('ChatGPT returned a different account.');
    return {issuer:ISSUER,subject:identity.sub!,...(typeof identity.email==='string'?{email:identity.email}:{}),...(typeof identity.name==='string'?{name:identity.name}:{}),clientId:issued,hostId:pending.hostId,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,idToken:tokens.id_token,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[],expiresAt:Date.now()+tokens.expires_in*1000};
  }
  async accessToken():Promise<string>{
    const current=this.current;if(!current)throw new Error('Continue with ChatGPT to begin your lesson.');
    if(!current.scopes.includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPT plan use was not enabled. Continue with ChatGPT and grant plan access.');
    if(current.expiresAt>Date.now()+60000)return current.accessToken;
    if(this.refresh)return this.refresh;
    const generation=this.generation;
    this.refresh=(async()=>{
      if(!current.refreshToken)throw new Error('ChatGPT sign-in expired. Continue with ChatGPT again.');
      const discovery=await this.discover();
      const tokens=await this.token(new URLSearchParams({grant_type:'refresh_token',client_id:current.clientId,refresh_token:current.refreshToken,resource:RESOURCE}),discovery);
      if(typeof tokens.refresh_token!=='string')throw new Error('ChatGPT did not return renewed credentials. Continue with ChatGPT again.');
      if(tokens.id_token){const identity=await this.verify(tokens.id_token,current.clientId,discovery);if(identity.sub!==current.subject)throw new Error('ChatGPT renewal returned a different identity.');}
      if(generation!==this.generation||this.current!==current)throw new Error('ChatGPT request was canceled.');
      const next={...current,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,idToken:tokens.id_token??current.idToken,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):current.scopes,expiresAt:Date.now()+tokens.expires_in*1000};
      this.options.store.save(next);this.current=next;return next.accessToken;
    })().finally(()=>{this.refresh=undefined;});return this.refresh;
  }
  async signOut():Promise<AppStatus>{
    this.generation++;this.abortSignIn?.();const current=this.current;this.current=undefined;this.credentialError=undefined;let confirmed=!current?.refreshToken;
    try{if(current?.refreshToken){const discovery=await this.discover();if(discovery.revocation_endpoint){const response=await this.request(discovery.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:current.refreshToken,token_type_hint:'refresh_token',client_id:current.clientId}).toString(),signal:AbortSignal.timeout(8000)});confirmed=response.status===200;}}}catch{/* Local sign-out must still complete while offline. */}
    finally{this.options.store.clear();}
    return {...this.status(),...(!confirmed?{error:'Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings if needed.'}:{})};
  }
}
