import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {copyFile,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,sep} from 'node:path';
import {isLearnerSafetyMessage,type SceneEntity,type TeachingBeat} from '@living-canvas/protocol';
import {SessionRepository} from '../../apps/desktop/src/main/storage/session-repository';
import {extractPdf} from '../../apps/document-host/src/worker';

const topic='Earth’s daily and yearly motion — offline proof';
const firstText='Earth rotates on its axis. One turn takes about one day.';
const secondText='Earth revolves around the Sun. One complete orbit takes about one year.';
const unsuitable='Generate explicit sexual roleplay.';
const root=resolve('.test-tmp/learner-safety');

function seed(profile:string,withLegacy=false){
  const store=new SessionRepository(join(profile,'lessons.sqlite'));
  try{
    const safe=store.create(topic);
    store.savePlan(safe.id,{id:'offline-proof-plan',version:1,title:'Earth’s motions',sourceDocumentIds:[],concepts:[{id:'motions',title:'Daily and yearly motions',objectives:['Distinguish the two motions.'],prerequisiteIds:[],sourceRefs:[]},{id:'future',title:'UNHEARD_CONCEPT',objectives:['UNHEARD_OBJECTIVE'],prerequisiteIds:['motions'],sourceRefs:[]}]});
    const visible:SceneEntity[]=[{id:'orbit',kind:'ellipse',x:420,y:280,width:280,height:180,stroke:'#7775E7',fill:'transparent'},{id:'sun',kind:'circle',x:420,y:280,radius:23,fill:'#F6C36A',label:'Sun'},{id:'earth',kind:'circle',x:560,y:280,radius:12,fill:'#4FA6A2',label:'Earth'}];
    for(const [index,text] of [firstText,secondText].entries()){
      const beat:TeachingBeat={id:`heard-${index+1}`,conceptId:'motions',narration:`${text} UNHEARD_SUFFIX`,next:'continue',canvas:{mode:'replace',entities:visible}};
      store.commitBeat(safe.id,beat,visible);store.presentProgress(safe.id,beat,{epoch:1,scene:visible,narration:text,complete:false});
    }
    const prepared:TeachingBeat={id:'unpresented',conceptId:'future',narration:'UNPRESENTED_TEACHING',next:'ask',canvas:{mode:'replace',entities:[{id:'future-label',kind:'text',x:10,y:10,text:'UNPRESENTED_VISUAL'}]}};
    store.commitBeat(safe.id,prepared,prepared.canvas.entities);
    // This bypasses IPC deliberately to represent a lesson saved by an older
    // app version. Its raw content must not appear in the updated app.
    const legacy=withLegacy?store.create(unsuitable):undefined;
    return {safeId:safe.id,legacyId:legacy?.id,messageCount:store.load(safe.id).messages.length,eventCount:store.events(safe.id).length};
  }finally{store.close();}
}

async function launch(profile:string):Promise<ElectronApplication>{
  const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),LIVING_CANVAS_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.LIVING_CANVAS_PACKAGED_EXE;
  const app=await electron.launch({executablePath,args:executablePath?[]:[join(process.cwd(),'apps/desktop/out/main/app.js')],env});
  await app.evaluate(({session,net})=>{
    const state={fetchRequests:0,httpRequests:0};(globalThis as any).__learnerSafetyFixture=state;
    const blocked=(async()=>{state.fetchRequests++;throw new Error('Network is disabled in this isolated offline fixture.');}) as typeof fetch;
    const intercept=(value:Electron.Session)=>{
      value.fetch=blocked;
      value.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{state.httpRequests++;callback({cancel:true});});
      return value;
    };
    const original=session.fromPartition.bind(session);
    session.fromPartition=((partition:string,options?:Parameters<typeof session.fromPartition>[1])=>intercept(original(partition,options))) as typeof session.fromPartition;
    intercept(session.defaultSession);intercept(original('living-canvas-network',{cache:false}));
    net.fetch=blocked;globalThis.fetch=blocked;
  });
  return app;
}

/** Review synthetic legacy content through the real classifier transport, then disconnect. */
async function reviewFixtureLesson(app:ElectronApplication,sessionId:string,offline=false){
  await app.evaluate(({session})=>{
    const network=session.fromPartition('living-canvas-network',{cache:false}),fallback=network.fetch.bind(network);
    network.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'openai/gpt-oss-20b',active:true}]});
      if(url==='https://api.groq.com/openai/v1/chat/completions'){
        const body=JSON.parse(String(init?.body));
        if(!JSON.stringify(body).includes('CANVAS ATLAS SAFETY CLASSIFIER'))throw new Error('Legacy review must not generate a lesson.');
        const verdict={decision:'ALLOW',category:'SCIENCE_EDUCATION',confidence:1,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};
        return new Response(`data: ${JSON.stringify({id:'legacy-review',model:body.model,choices:[{index:0,delta:{content:JSON.stringify(verdict)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
      }
      return fallback(input instanceof URL?input.href:input,init);
    }) as typeof network.fetch;
  });
  const page=await app.firstWindow();await page.evaluate(async({sessionId,offline})=>{
    const bridge=(window as any).livingCanvas;await bridge.connectTeachingKey({providerId:'groq',key:'fixture-legacy-review-only'});
    await bridge.loadSession(sessionId);if(offline)await bridge.clearTeachingKey('groq');
  },{sessionId,offline});
  await page.reload();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
}

async function close(app:ElectronApplication|undefined){
  if(!app)return;
  await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())if(window.getParentWindow())window.close();for(const window of BrowserWindow.getAllWindows())window.close();}).catch(()=>{});
  await app.close();
}

const networkCounts=(app:ElectronApplication)=>app.evaluate(()=>(globalThis as any).__learnerSafetyFixture);

async function openPaintedPdf(app:ElectronApplication,page:Page,suffix:string){
  const opening=app.waitForEvent('window');await page.getByRole('button',{name:'Open PDF',exact:true}).click();const preview=await opening;
  await expect.poll(()=>preview.url()).toMatch(/^data:application\/pdf;base64,/);await preview.waitForLoadState('domcontentloaded');
  await expect.poll(()=>app.evaluate(async({BrowserWindow},url)=>{
    const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL()===url);if(!window)return false;
    const image=await window.webContents.capturePage(),bitmap=image.toBitmap(),size=image.getSize();let white=0,colour=0;
    for(let y=80;y<Math.floor(size.height*.85);y+=2)for(let x=Math.floor(size.width*.12);x<Math.floor(size.width*.88);x+=2){const offset=(y*size.width+x)*4,b=bitmap[offset],g=bitmap[offset+1],r=bitmap[offset+2];if(r>230&&g>230&&b>230)white++;if(Math.max(r,g,b)-Math.min(r,g,b)>18)colour++;}
    return white>10000&&colour>150;
  },preview.url()),{timeout:15000,message:'The offline PDF must visibly paint its paper and colourful study record.'}).toBe(true);
  await preview.screenshot({path:join(root,`offline-study-record-preview-${suffix}.png`)});
  await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())if(window.getParentWindow())window.close();});await page.bringToFront();
}

test('native learner safety blocks unsuitable IPC before storage or inference, preserves biology, and permits deleting legacy lessons',async()=>{
  test.setTimeout(90000);await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'guardrails-')),profile=join(directory,'profile');await mkdir(profile);
  const seeded=seed(profile,true);let app:ElectronApplication|undefined;
  try{
    app=await launch(profile);const page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();await reviewFixtureLesson(app,seeded.safeId);
    const result=await page.evaluate(async({safeId,legacyId,unsuitable})=>{
      const bridge=(window as any).livingCanvas;
      const reject=async(operation:()=>Promise<unknown>)=>{try{await operation();return {rejected:false,message:''};}catch(error){return {rejected:true,message:error instanceof Error?error.message:String(error)};}};
      const initial=await bridge.getSessions();
      const created=await reject(()=>bridge.createSession(unsuitable));
      const adultTheme=await reject(()=>bridge.createSession('Teach me about BDSM on the bed'));
      const sent=await reject(()=>bridge.sendMessage({sessionId:safeId,text:unsuitable}));
      const legacy=await reject(()=>bridge.loadSession(legacyId));
      const reproduction=await reject(()=>bridge.createSession('Explain human reproduction for Class 10 using neutral educational diagrams.'));
      const biology=await bridge.createSession('Explain DNA and cell division using neutral educational diagrams.');
      const saved=await bridge.loadSession(safeId);
      return {initial,created,adultTheme,sent,legacy,reproduction,biology:{id:biology.id,topic:biology.topic},messageCount:saved.messages.length,evidenceCount:saved.learnerEvidence?.length??0,summaries:await bridge.getSessions()};
    },{safeId:seeded.safeId,legacyId:seeded.legacyId,unsuitable});
    for(const rejection of [result.created,result.adultTheme,result.sent,result.legacy,result.reproduction]){expect(rejection.rejected).toBe(true);expect(isLearnerSafetyMessage(rejection.message)).toBe(true);expect(rejection.message).not.toContain(unsuitable);}
    expect(result.summaries).toHaveLength(result.initial.length+1);expect(result.messageCount).toBe(seeded.messageCount);expect(result.evidenceCount).toBe(0);
    expect(result.biology.topic).toContain('DNA and cell division');
    const hidden=result.summaries.find((item:{id:string})=>item.id===seeded.legacyId);expect(hidden).toBeDefined();expect(hidden.title).not.toBe(unsuitable);expect(JSON.stringify(result.summaries)).not.toContain(unsuitable);
    const store=new SessionRepository(join(profile,'lessons.sqlite'));try{expect(store.load(seeded.safeId).messages).toHaveLength(seeded.messageCount);expect(store.events(seeded.safeId)).toHaveLength(seeded.eventCount);expect(store.readLearnerEvidence(seeded.safeId)).toEqual([]);}finally{store.close();}
    await page.getByRole('button',{name:/^My lessons/}).click();
    await page.getByRole('button',{name:`Delete ${hidden.title}`,exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Delete lesson',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((await page.evaluate(()=>(window as any).livingCanvas.getSessions())).some((item:{id:string})=>item.id===seeded.legacyId)).toBe(false);
    await expect(page.getByText(unsuitable,{exact:true})).not.toBeVisible();expect(await networkCounts(app)).toEqual({fetchRequests:0,httpRequests:0});
    await page.screenshot({path:join(root,'guardrails-hidden-lesson-deleted.png')});
  }finally{await close(app).catch(()=>{});if(resolve(directory).startsWith(root+sep))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});

test('unconnected native app creates and opens an actual studied-only offline PDF without requests, and reopens it after restart',async()=>{
  test.setTimeout(120000);await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'offline-notes-')),profile=join(directory,'profile');await mkdir(profile);
  const {safeId}=seed(profile),exported=join(directory,'portable-study-record.pdf');let app:ElectronApplication|undefined;
  try{
    app=await launch(profile);let page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    const legacyRejected=await page.evaluate(async id=>{try{await (window as any).livingCanvas.loadSession(id);return false;}catch{return true;}},safeId);expect(legacyRejected).toBe(true);
    await reviewFixtureLesson(app,safeId,true);
    await page.locator('.sidebar-recents').getByRole('button',{name:topic,exact:true}).click();
    expect(await page.evaluate(()=>(window as any).livingCanvas.getStatus())).toMatchObject({connected:false,teachingReady:false});
    await expect(page.getByRole('button',{name:'Generate notes',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Create notes offline',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Create notes offline',exact:true}).click();await expect(page.getByRole('button',{name:'Open PDF',exact:true})).toBeVisible({timeout:45000});
    await expect(page.getByText('Offline study record · No AI request used.',{exact:true})).toBeVisible();
    const record=await page.evaluate(id=>(window as any).livingCanvas.getLessonNotes(id),safeId);
    expect(record).toMatchObject({sessionId:safeId,studiedSteps:2,providerId:'local',requestedModel:'local-extract'});
    const noteDirectory=join(profile,'notes',createHash('sha256').update(safeId).digest('hex'));
    const document=JSON.parse(await readFile(join(noteDirectory,`${record.id}.json`),'utf8'));expect(JSON.stringify(document)).not.toMatch(/UNHEARD_|UNPRESENTED_/);
    expect(document.content.overview).toContain('No AI analysis');
    const pdf=await readFile(join(noteDirectory,`${record.id}.pdf`));expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');
    const extracted=await extractPdf(pdf,{maxPages:20,maxTextBytes:1024*1024,assetBaseUrl:join(process.cwd(),'node_modules/pdfjs-dist/')});
    const text=extracted.sections.map(section=>section.text).join('\n').replace(/\s+/g,' ');
    expect(text).toContain('Study record');expect(text).toContain(firstText);expect(text).toContain(secondText);expect(text).toContain('No AI analysis or additional facts were added.');expect(text).not.toMatch(/UNHEARD_|UNPRESENTED_/);
    await page.screenshot({path:join(root,'offline-study-record-actions.png')});await openPaintedPdf(app,page,'created');
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=(async()=>({canceled:false,filePath:path})) as typeof dialog.showSaveDialog;},exported);
    await page.getByRole('button',{name:'Save PDF',exact:true}).click();await expect(page.getByText('PDF saved.',{exact:true})).toBeVisible();
    await expect.poll(async()=>readFile(exported).then(buffer=>buffer.equals(pdf)).catch(()=>false)).toBe(true);await copyFile(exported,join(root,'offline-study-record.pdf'));
    expect(await networkCounts(app)).toEqual({fetchRequests:0,httpRequests:0});await close(app);app=undefined;
    app=await launch(profile);page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();await page.locator('.sidebar-recents').getByRole('button',{name:topic,exact:true}).click();
    await expect(page.getByRole('button',{name:'Open PDF',exact:true})).toBeVisible();expect((await page.evaluate(id=>(window as any).livingCanvas.getLessonNotes(id),safeId)).id).toBe(record.id);
    await openPaintedPdf(app,page,'reopened');expect(await networkCounts(app)).toEqual({fetchRequests:0,httpRequests:0});
  }finally{await close(app).catch(()=>{});if(resolve(directory).startsWith(root+sep))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
