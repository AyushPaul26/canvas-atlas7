import {describe,it,expect} from 'vitest';
import {ChatGPTProvider} from '../../apps/desktop/src/main/ai/chatgpt-provider';
describe('account-authorized provider',()=>{
  it('discovers visible account models and sends only supported plan-route fields',async()=>{
    let sent:any;
    const provider=new ChatGPTProvider({accessToken:async()=>'secret'},async(url,init)=>{
      expect(init?.headers).toMatchObject({Authorization:'Bearer secret'});
      if(String(url).endsWith('/models'))return Response.json({models:[{slug:'available',display_name:'Available',visibility:'list'},{slug:'hidden',visibility:'hide'}]});
      sent=JSON.parse(String(init?.body));return new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n');
    });
    expect(await provider.listModels()).toEqual([{id:'available',name:'Available'}]);
    await provider.complete({model:'available',instructions:'teach',input:[{role:'user',content:'new topic'}],tools:[]},new AbortController().signal);
    expect(sent).toEqual({model:'available',instructions:'teach',input:[{role:'user',content:'new topic'}],store:false,stream:true});
  });
  it('records the exact requested ID and separately the model reported by response.completed',async()=>{
    let body:any;
    const provider=new ChatGPTProvider({accessToken:async()=>'secret'},async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response('data: {"type":"response.completed","response":{"id":"resp_safe","model":"served-model-snapshot","output":[]}}\n\n');});
    const response=await provider.complete({model:'exact/astra-id',instructions:'teach',input:[],tools:[]},new AbortController().signal);
    expect(body.model).toBe('exact/astra-id');
    expect(response.modelMetadata).toMatchObject({requestedModel:'exact/astra-id',servedModel:'served-model-snapshot',responseId:'resp_safe'});
    expect(response.modelMetadata?.completedAt).toMatch(/^\d{4}-/);
  });
  it('leaves served model unknown when the completed response omits it',async()=>{
    const provider=new ChatGPTProvider({accessToken:async()=>'secret'},async()=>new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n'));
    const response=await provider.complete({model:'chosen',instructions:'teach',input:[],tools:[]},new AbortController().signal);
    expect(response.modelMetadata?.requestedModel).toBe('chosen');expect(response.modelMetadata?.servedModel).toBeUndefined();
  });
  it('captures the requested ID before asynchronous credential renewal',async()=>{
    let release!:(token:string)=>void;let sent:any;
    const provider=new ChatGPTProvider({accessToken:()=>new Promise(resolve=>{release=resolve;})},async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n');});
    const request={model:'chosen-astra',instructions:'teach',input:[],tools:[]};const pending=provider.complete(request,new AbortController().signal);
    request.model='later-model';release('secret');const response=await pending;
    expect(sent.model).toBe('chosen-astra');expect(response.modelMetadata.requestedModel).toBe('chosen-astra');
  });
});
