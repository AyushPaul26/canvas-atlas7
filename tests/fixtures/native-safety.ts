import type {ElectronApplication} from '@playwright/test';
import {safetyClassifierResponse} from './safety-classifier';

/** Test-only HTTP responses through the real provider bridge. Every other
 * request is denied, including on an explicitly disconnected restart. */
export async function installNativeSafety(app:ElectronApplication,offline=false):Promise<void>{
  await app.evaluate(({session,net},{classifierSource,offline})=>{
    const reply=new Function(`return (${classifierSource})`)() as (provider:'groq',verdict?:unknown,model?:string)=>{body:string;contentType:string};
    const counts={catalogRequests:0,classifierRequests:0,generationRequests:0,unexpectedFetches:0,blockedHttp:0};(globalThis as any).__nativeSafety=counts;
    const denied=(async()=>{counts.unexpectedFetches++;throw new Error('Unexpected network request in the isolated simulation fixture.');}) as typeof fetch;
    const fixture=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(!offline&&url==='https://api.groq.com/openai/v1/models'){counts.catalogRequests++;return Response.json({data:[{id:'openai/gpt-oss-20b',active:true}]});}
      if(!offline&&url==='https://api.groq.com/openai/v1/chat/completions'){
        const body=JSON.parse(String(init?.body));
        if(!JSON.stringify(body).includes('CANVAS ATLAS SAFETY CLASSIFIER')){counts.generationRequests++;throw new Error('Simulation fixtures may classify content but never request generated teaching material.');}
        counts.classifierRequests++;const response=reply('groq',undefined,body.model);return new Response(response.body,{headers:{'Content-Type':response.contentType}});
      }
      return denied(input,init);
    }) as typeof fetch;
    const intercept=(value:Electron.Session)=>{value.fetch=fixture;value.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{counts.blockedHttp++;callback({cancel:true});});return value;};
    const original=session.fromPartition.bind(session);
    session.fromPartition=((partition:string,options?:Parameters<typeof session.fromPartition>[1])=>intercept(original(partition,options))) as typeof session.fromPartition;
    intercept(session.defaultSession);intercept(original('living-canvas-network',{cache:false}));net.fetch=denied;globalThis.fetch=denied;
  },{classifierSource:safetyClassifierResponse.toString(),offline});
  if(!offline){const page=await app.firstWindow();await page.waitForFunction(()=>Boolean((window as any).livingCanvas));await page.evaluate(()=>(window as any).livingCanvas.connectTeachingKey({providerId:'groq',key:'fixture-native-safety-only'}));}
}

export const nativeSafetyCounts=(app:ElectronApplication)=>app.evaluate(()=>(globalThis as any).__nativeSafety as {catalogRequests:number;classifierRequests:number;generationRequests:number;unexpectedFetches:number;blockedHttp:number});
