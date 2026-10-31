import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {copyFile,lstat,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {join,resolve,sep} from 'node:path';
import type {SceneEntity,TeachingBeat} from '@living-canvas/protocol';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {notesFixture} from '../fixtures/lesson-notes';
import {isSafetyClassifierRequest,safetyClassifierResponse} from '../fixtures/safety-classifier';

const topic='Earth’s yearly journey — notes test';
const heard='Earth rotates on its axis while revolving around the Sun. One rotation takes about one day. One revolution takes about one year. ';
const heardDiagram='Four positions divide Earth’s orbit into quarters. After roughly three months Earth has travelled about a quarter of the way around its orbit. The picture simplifies shape and scale. कक्षा का अर्थ है परिक्रमा का पथ।';

function seedPresentedLesson(profile:string){
  const store=new SessionRepository(join(profile,'lessons.sqlite'));
  try{
    const lesson=store.create(topic);
    store.savePlan(lesson.id,{id:'notes-plan',version:1,title:'Earth’s yearly journey',sourceDocumentIds:[],concepts:[
      {id:'motions',title:'Two motions, two timescales',objectives:['Distinguish rotation and revolution.'],prerequisiteIds:[],sourceRefs:[]},
      {id:'future-concept',title:'UNHEARD_CONCEPT',objectives:['UNHEARD_OBJECTIVE'],prerequisiteIds:['motions'],sourceRefs:[]},
    ]});
    store.addMessage(lesson.id,'student','Explain Earth’s daily and yearly motions.');
    const visible:SceneEntity[]=[{id:'orbit',kind:'ellipse',x:420,y:280,width:280,height:180,stroke:'#7775E7',fill:'transparent'},{id:'sun',kind:'circle',x:420,y:280,radius:23,fill:'#F6C36A',label:'Sun'},{id:'earth',kind:'circle',x:560,y:280,radius:12,fill:'#4FA6A2',label:'Earth'},{id:'caption',kind:'text',x:315,y:405,text:'One revolution: about one year',fontSize:18}];
    const first:TeachingBeat={id:'heard-1',conceptId:'motions',title:'UNHEARD_TITLE',narration:heard+'UNHEARD_FUTURE: this part of the prepared response was never played.',question:'UNHEARD_QUESTION',next:'continue',canvas:{mode:'replace',entities:[...visible,{id:'future-caption',kind:'text',x:100,y:80,text:'UNHEARD_CANVAS_TEXT'}]}};
    store.commitBeat(lesson.id,first,first.canvas.entities);
    store.presentProgress(lesson.id,first,{epoch:1,scene:visible,narration:heard,complete:false});
    const second:TeachingBeat={id:'heard-2',conceptId:'motions',narration:heardDiagram,next:'ask',canvas:{mode:'replace',entities:visible}};
    store.commitBeat(lesson.id,second,visible);store.presentProgress(lesson.id,second,{epoch:1,scene:visible,narration:heardDiagram,complete:true});
    const future:TeachingBeat={id:'never-presented',conceptId:'future-concept',narration:'UNPRESENTED_TEACHING',next:'ask',canvas:{mode:'replace',entities:[{id:'never-seen',kind:'text',x:100,y:100,text:'UNPRESENTED_VISUAL'}]},simulation:{id:'unheard-program',title:'UNHEARD_SIMULATION',source:'globalThis.simulation = {}; /* UNHEARD_PROGRAM */',controls:[],assumptions:[],validation:'illustrative'}};
    store.commitBeat(lesson.id,future,future.canvas.entities);
    return lesson.id;
  }finally{store.close();}
}

for(const providerId of ['gemini','groq','chatgpt'] as const)test(`${providerId} generates a real studied-only notes PDF, opens and saves it, then reopens it offline after restart`,async()=>{
  test.setTimeout(120000);
  const root=resolve('.test-tmp/lesson-notes');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,`${providerId}-desktop-`)),profile=join(directory,'profile');await mkdir(profile);
  const sessionId=seedPresentedLesson(profile),providerName={gemini:'Gemini',groq:'Groq',chatgpt:'ChatGPT'}[providerId];
  const model={gemini:'gemini-3.5-flash-lite',groq:'openai/gpt-oss-20b',chatgpt:'gpt-6.1-sol'}[providerId];
  const signing=providerId==='chatgpt'?generateKeyPairSync('rsa',{modulusLength:2048}):undefined;
  const jwk=signing?.publicKey.export({format:'jwk'});
  const exported=join(directory,'exported-notes.pdf');
  const content=notesFixture().content;
  content.sections[1].explanation+='\n\nकक्षा का अर्थ है परिक्रमा का पथ।';
  if(providerId==='groq')content.sections[0].explanation=Array.from({length:22},(_,index)=>`Study point ${index+1}: Earth keeps rotating on its axis as it travels around the Sun. The daily spin and yearly trip are separate motions that happen together. Reading the two timescales carefully helps distinguish rotation from revolution.`).join('\n\n');
  let app:ElectronApplication|undefined;
  const launch=async()=>{
    const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),LIVING_CANVAS_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
    const executablePath=process.env.LIVING_CANVAS_PACKAGED_EXE;
    const instance=await electron.launch({executablePath,args:executablePath?[]:[join(process.cwd(),'apps/desktop/out/main/app.js')],env});
    await instance.evaluate(({session,shell},{content,model,providerId,jwk,isClassifierSource,classifierResponseSource})=>{
      // Only test-owned transport helpers cross this isolated Electron boundary.
      // The production app still uses its real policy engine and signed receipts.
      const isClassifier=new Function(`return (${isClassifierSource})`)() as (body:unknown)=>boolean;
      const classifierResponse=new Function(`return (${classifierResponseSource})`)() as (provider:'gemini'|'groq'|'chatgpt',verdict?:unknown,model?:string)=>{body:string;contentType:string};
      // Only a fresh synthetic profile is used. No request headers or original
      // credentials/content are observed. Every network request is intercepted.
      const state={generationRequests:0,classifierRequests:0,contexts:[] as string[],model,blockedPreviewResources:[] as {scheme:string;host:string;path:string;resource:string}[],authHandoff:null as {nonce:string;callback:string}|null,idToken:''};(globalThis as any).__notesFixture=state;
      if(providerId==='chatgpt')shell.openExternal=async target=>{
        const url=new URL(target),callback=new URL(url.searchParams.get('redirect_uri')??'');
        if(url.origin!=='https://auth.openai.com'||callback.protocol!=='http:'||callback.hostname!=='127.0.0.1'||callback.pathname!=='/auth/callback')throw new Error('Unexpected synthetic OAuth handoff');
        callback.searchParams.set('state',url.searchParams.get('state')??'');callback.searchParams.set('code','fixture-code');callback.searchParams.set('client_id','notes-fixture-client');
        state.authHandoff={nonce:url.searchParams.get('nonce')??'',callback:callback.href};
      };
      const originalPartition=session.fromPartition.bind(session);
      session.fromPartition=((partition:string,options?:Parameters<typeof session.fromPartition>[1])=>{
        const value=originalPartition(partition,options);
        if(partition.startsWith('notes-preview-')){
          const originalHook=value.webRequest.onBeforeRequest.bind(value.webRequest);
          value.webRequest.onBeforeRequest=((...args:any[])=>{
            const listener=args.at(-1);
            if(typeof listener!=='function')return (originalHook as any)(...args);
            return (originalHook as any)(...args.slice(0,-1),(details:any,callback:any)=>listener(details,(result:any)=>{
              if(result?.cancel&&state.blockedPreviewResources.length<40)try{const url=new URL(details.url);state.blockedPreviewResources.push({scheme:url.protocol,host:url.hostname,path:url.protocol==='file:'?'local-file':url.protocol==='data:'?'inline-document':url.pathname,resource:details.resourceType});}catch{/* Retain fixed routing metadata only. */}
              callback(result);
            }));
          }) as typeof value.webRequest.onBeforeRequest;
        }
        return value;
      }) as typeof session.fromPartition;
      const network=session.fromPartition('living-canvas-network',{cache:false});
      network.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(url==='https://auth.openai.com/.well-known/openid-configuration')return Response.json({issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/authorize',token_endpoint:'https://auth.openai.com/token',jwks_uri:'https://auth.openai.com/jwks'});
        if(url==='https://auth.openai.com/jwks')return Response.json({keys:[{...jwk,kid:'notes-fixture-key',alg:'RS256',use:'sig'}]});
        if(url==='https://auth.openai.com/token'){
          if(!state.idToken)throw new Error('The synthetic OAuth identity was not prepared.');
          return Response.json({access_token:'notes-fixture-access',id_token:state.idToken,token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
        }
        if(url==='https://api.openai.com/v1/models')return Response.json({models:[{slug:model,display_name:'Fixture ChatGPT',visibility:'list'}]});
        if(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'))return Response.json({models:[{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']}]});
        if(url==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-20b',active:true}]});
        const gemini=url.startsWith('https://generativelanguage.googleapis.com/v1beta/interactions?'),chatgpt=url==='https://api.openai.com/v1/responses';
        if(!gemini&&!chatgpt&&url!=='https://api.groq.com/openai/v1/chat/completions')throw new Error('Unexpected synthetic notes endpoint');
        const body=JSON.parse(String(init?.body));
        if(isClassifier(body)){
          state.classifierRequests++;const response=classifierResponse(providerId,undefined,model);
          return new Response(response.body,{headers:{'Content-Type':response.contentType}});
        }
        const tool=chatgpt?'':gemini?body.tools[0].name:body.tools[0].function.name;
        if(chatgpt){if(Object.hasOwn(body,'tools')||body.store!==false||body.stream!==true)throw new Error('ChatGPT notes must use a tool-free streaming JSON request.');}
        else if(tool!==(gemini?'notes_create_notes':'notes__create_notes'))throw new Error('A notes click requested an unexpected teaching tool.');
        state.generationRequests++;state.contexts.push(JSON.stringify(gemini||chatgpt?body.input:body.messages));
        const texts:string[]=chatgpt?body.input.map((item:any)=>item.content??''):gemini?body.input.flatMap((item:any)=>(item.content??[]).map((part:any)=>part.text??'')):body.messages.map((item:any)=>item.content??'');
        let context:any;for(const text of texts.reverse())try{const candidate=JSON.parse(text);if(Array.isArray(candidate.explanations)){context=candidate;break;}}catch{/* The fixed system instruction is not the notes context. */}
        if(!context?.explanations?.length)throw new Error('The synthetic notes request omitted studied explanations.');
        const ids=context.explanations.map((item:any)=>item.id),draft=structuredClone(content);
        draft.sections[0].evidenceIds=[ids[0]];draft.sections[1].evidenceIds=ids.slice(1).length?ids.slice(1):[ids[0]];
        for(const question of draft.reviewQuestions)question.evidenceIds=[ids[0]];
        if(chatgpt){
          const json=JSON.stringify(draft),part={type:'output_text',text:json,annotations:[]};
          const events=[{type:'response.output_text.delta',delta:json},{type:'response.completed',response:{id:'notes-response',model:body.model,status:'completed',output:[{id:'notes-message',type:'message',role:'assistant',status:'completed',content:[part]}]}}];
          return new Response(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
        }
        if(gemini){
          const step={type:'function_call',id:'notes-call',name:tool,arguments:draft};
          return new Response([
            {event_type:'interaction.created',interaction:{id:'notes-response',model:body.model}},
            {event_type:'step.start',index:0,step},{event_type:'step.stop',index:0},
            {event_type:'interaction.completed',interaction:{id:'notes-response',model:body.model,status:'requires_action',steps:[step]}},
          ].map(event=>`event: ${event.event_type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('')+'event: done\r\ndata: [DONE]\r\n\r\n',{headers:{'Content-Type':'text/event-stream'}});
        }
        return new Response(`data: ${JSON.stringify({id:'notes-response',model:body.model,choices:[{index:0,delta:{tool_calls:[{index:0,id:'notes-call',type:'function',function:{name:tool,arguments:JSON.stringify(draft)}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
      }) as typeof network.fetch;
    },{content,model,providerId,jwk,isClassifierSource:isSafetyClassifierRequest.toString(),classifierResponseSource:safetyClassifierResponse.toString()});
    return instance;
  };
  const closePreviews=async()=>{if(!app)return;await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())if(window.getParentWindow())window.close();});};
  const close=async()=>{if(!app)return;await closePreviews();await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.close();}).catch(()=>{});await app.close();app=undefined;};
  const resizeMain=async(width:number,height:number)=>{await app!.evaluate(({BrowserWindow},{width,height})=>{const main=BrowserWindow.getAllWindows().find(window=>!window.getParentWindow()&&window.isVisible());main?.setSize(width,height);},{width,height});};
  const assertCompactLayout=async(page:Page)=>{
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    for(const control of [page.getByRole('button',{name:'Generate notes',exact:true}),page.getByLabel('Ask your teacher a question'),page.getByRole('button',{name:'Open PDF',exact:true}),page.getByRole('button',{name:'Save PDF',exact:true})]){
      if(!await control.isVisible())continue;
      const box=await control.boundingBox();expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
    }
  };
  const openPdf=async(page:Page,suffix:string,closeAfter=true)=>{
    const opening=app!.waitForEvent('window');await page.getByRole('button',{name:'Open PDF',exact:true}).click();const preview=await opening;
    await expect.poll(()=>preview.url()).toMatch(/^data:application\/pdf;base64,/i);
    await preview.waitForLoadState('domcontentloaded');
    // DOMContentLoaded only establishes the PDF plugin shell. Wait until the
    // registered document actually paints before accepting a preview as working.
    await expect.poll(()=>app!.evaluate(async({BrowserWindow},url)=>{
      const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL()===url);if(!window)return {hasPaper:false,hasColour:false};
      const image=await window.webContents.capturePage(),bitmap=image.toBitmap(),size=image.getSize();let white=0,colour=0;
      for(let y=80;y<Math.floor(size.height*.85);y+=2)for(let x=Math.floor(size.width*.12);x<Math.floor(size.width*.88);x+=2){const offset=(y*size.width+x)*4,b=bitmap[offset],g=bitmap[offset+1],r=bitmap[offset+2];if(r>230&&g>230&&b>230)white++;if(Math.max(r,g,b)-Math.min(r,g,b)>18)colour++;}
      return {hasPaper:white>10000,hasColour:colour>150};
    },preview.url()),{timeout:15000,message:'The saved PDF must visibly paint its paper and colourful notes.'}).toEqual({hasPaper:true,hasColour:true});
    await preview.screenshot({path:join(root,`${providerId}-notes-preview-${suffix}.png`)});
    if(closeAfter)await closePreviews();await page.bringToFront();
  };
  try{
    app=await launch();let page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    await expect(page.locator('.sidebar-recents').getByRole('button',{name:'Lesson awaiting safety review',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    if(providerId==='chatgpt'){
      await page.getByRole('button',{name:'Connect ChatGPT',exact:true}).click();
      await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__notesFixture.authHandoff)).not.toBeNull();
      const handoff=await app.evaluate(()=>(globalThis as any).__notesFixture.authHandoff) as {nonce:string;callback:string};
      const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'notes-fixture-key'})).toString('base64url');
      const payload=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'notes-fixture-client',sub:'notes-fixture-subject',name:'Fixture learner',iat:now,exp:now+3600,nonce:handoff.nonce})).toString('base64url');
      const unsigned=`${header}.${payload}`,idToken=`${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),signing!.privateKey).toString('base64url')}`;
      await app.evaluate((_electron,idToken)=>{(globalThis as any).__notesFixture.idToken=idToken;},idToken);
      const callback=new URL(handoff.callback);expect(callback.protocol).toBe('http:');expect(callback.hostname).toBe('127.0.0.1');expect(callback.pathname).toBe('/auth/callback');
      expect((await fetch(callback)).status).toBe(200);
    }else{
      await page.getByLabel(`${providerName} API key`,{exact:true}).fill(`fixture-${providerId}-notes-key`);
      await page.getByRole('button',{name:`Connect ${providerName}`,exact:true}).click();
    }
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getStatus())).toMatchObject({teachingProvider:providerId,teachingReady:true,model});
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.locator('.sidebar-recents').getByRole('button',{name:'Lesson awaiting safety review',exact:true}).click();
    await expect(page.getByRole('heading',{name:topic,exact:true})).toBeVisible({timeout:30000});
    await resizeMain(1000,680);
    const generate=page.getByRole('button',{name:'Generate notes',exact:true});await expect(generate).toBeEnabled();
    await assertCompactLayout(page);
    await generate.click();
    await expect(page.getByRole('button',{name:'Open PDF',exact:true})).toBeVisible({timeout:60000});
    await assertCompactLayout(page);
    const record=await page.evaluate(id=>(window as any).livingCanvas.getLessonNotes(id),sessionId);
    expect(record).toMatchObject({sessionId,studiedSteps:2,providerId,requestedModel:model,servedModel:model});
    const state=await app.evaluate(()=>(globalThis as any).__notesFixture);
    expect(state.generationRequests).toBe(1);expect(state.classifierRequests).toBeGreaterThan(0);expect(state.contexts[0]).toContain(heard);
    expect(state.contexts[0]).not.toMatch(/UNHEARD_|UNPRESENTED_|globalThis\.simulation/);
    const noteDirectory=join(profile,'notes',createHash('sha256').update(sessionId).digest('hex'));
    const storedDocument=JSON.parse(await readFile(join(noteDirectory,`${record.id}.json`),'utf8'));
    expect(JSON.stringify(storedDocument)).not.toMatch(/UNHEARD_|UNPRESENTED_/);
    const pdf=await readFile(join(noteDirectory,`${record.id}.pdf`));expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');
    await page.screenshot({path:join(root,`${providerId}-notes-compact.png`)});
    await resizeMain(1440,940);await page.screenshot({path:join(root,`${providerId}-notes-actions.png`)});
    await openPdf(page,'online');
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=(async()=>({canceled:false,filePath:path})) as typeof dialog.showSaveDialog;},exported);
    await page.getByRole('button',{name:'Save PDF',exact:true}).click();
    await expect(page.getByText('PDF saved.',{exact:true})).toBeVisible();
    await expect.poll(async()=>readFile(exported).then(buffer=>buffer.equals(pdf)).catch(()=>false)).toBe(true);
    await copyFile(exported,join(root,`${providerId}-notes.pdf`));
    expect(await app.evaluate(()=>(globalThis as any).__notesFixture.generationRequests)).toBe(1);
    expect(await app.evaluate(()=>(globalThis as any).__notesFixture.classifierRequests)).toBe(state.classifierRequests);
    if(providerId==='chatgpt')await page.evaluate(()=>(window as any).livingCanvas.signOut());
    else await page.evaluate(providerId=>(window as any).livingCanvas.clearTeachingKey(providerId),providerId);
    await close();app=await launch();page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    await page.locator('.sidebar-recents').getByRole('button',{name:topic,exact:true}).click();
    await expect(page.getByRole('button',{name:'Open PDF',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate notes',exact:true})).toBeDisabled();
    expect((await page.evaluate(id=>(window as any).livingCanvas.getLessonNotes(id),sessionId)).id).toBe(record.id);
    await openPdf(page,'offline',false);expect(await app.evaluate(()=>(globalThis as any).__notesFixture.generationRequests)).toBe(0);
    expect(await app.evaluate(()=>(globalThis as any).__notesFixture.classifierRequests)).toBe(0);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>Boolean(window.getParentWindow())))).toBe(true);
    await page.getByRole('button',{name:/^My lessons/}).click();
    await page.getByRole('button',{name:`Delete ${topic}`,exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Delete lesson',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((await page.evaluate(()=>(window as any).livingCanvas.getSessions())).some((session:{id:string})=>session.id===sessionId)).toBe(false);
    await expect.poll(async()=>lstat(noteDirectory).then(()=>false).catch(error=>error.code==='ENOENT')).toBe(true);
    const deletedStore=new SessionRepository(join(profile,'lessons.sqlite'));
    try{expect(deletedStore.getPreference(`lesson-notes:${sessionId}`)).toBeUndefined();}finally{deletedStore.close();}
    expect((await readFile(exported)).equals(pdf)).toBe(true);
    expect((await readFile(join(root,`${providerId}-notes.pdf`))).equals(pdf)).toBe(true);
    expect(await app.evaluate(()=>(globalThis as any).__notesFixture.generationRequests)).toBe(0);
    expect(await app.evaluate(()=>(globalThis as any).__notesFixture.classifierRequests)).toBe(0);
  }catch(error){if(app)console.error('Synthetic notes diagnostics:',await app.evaluate(()=>{const {authHandoff:_handoff,idToken:_token,...diagnostics}=(globalThis as any).__notesFixture??{};return diagnostics;}).catch(()=>({unavailable:true})));throw error;}
  finally{await close().catch(()=>{});if(resolve(directory).startsWith(root+sep))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
