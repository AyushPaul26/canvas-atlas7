import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {safetyClassifierResponse} from '../fixtures/safety-classifier';

for(const providerId of ['gemini','groq'] as const)test(`${providerId} key automatically powers native teaching, experiments and material courses without ChatGPT`,async()=>{
  test.setTimeout(120000);
  const root=resolve('.test-tmp/gemini-groq');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,`${providerId}-desktop-`));
  const name=providerId==='gemini'?'Gemini':'Groq';
  const expectedModel=providerId==='gemini'?'gemini-3.5-flash-lite':'openai/gpt-oss-20b';
  let app:ElectronApplication|undefined;
  const launch=async()=>{
    const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),LIVING_CANVAS_USER_DATA:directory};delete env.ELECTRON_RUN_AS_NODE;
    const executablePath=process.env.LIVING_CANVAS_PACKAGED_EXE;
    const instance=await electron.launch({executablePath,args:executablePath?[]:[join(process.cwd(),'apps/desktop/out/main/app.js')],env});
    await instance.evaluate(({session},classifierSource)=>{
      const classifierReply=new Function(`return (${classifierSource})`)() as (provider:string,verdict?:unknown,model?:string)=>{body:string;contentType:string};
      const state={requests:[] as {url:string;model?:string;tool?:string}[],serial:0,planningFailures:0,diagnostics:[] as string[]};(globalThis as any).__aiFixture=state;
      const network=session.fromPartition('living-canvas-network',{cache:false});
      network.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input),body=init?.body?JSON.parse(String(init.body)):undefined;
        if(body&&JSON.stringify(body).includes('CANVAS ATLAS SAFETY CLASSIFIER')){const reply=classifierReply(url.includes('generativelanguage')?'gemini':'groq',undefined,body.model);return new Response(reply.body,{headers:{'Content-Type':reply.contentType}});}
        if(url.startsWith('https://api.elevenlabs.io/')){
          if(url.includes('/voices?'))return Response.json({voices:[{voice_id:'fixture-voice',name:'Fixture teacher'}],has_more:false});
          if(url.includes('/text-to-speech/')){const pcm=new Int16Array(16000);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(i*2*Math.PI*220/24000)*800);return new Response(new Uint8Array(pcm.buffer),{headers:{'Content-Type':'audio/pcm'}});}
        }
        if(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'))return Response.json({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-fixture',displayName:'Gemini fixture',supportedGenerationMethods:['generateContent']},{name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent']}]});
        if(url==='https://api.groq.com/openai/v1/models')return Response.json({data:[{id:'allam-2-7b',active:true},{id:'fixture/teaching-model',active:true},{id:'openai/gpt-oss-20b',active:true}]});
        const gemini=url.startsWith('https://generativelanguage.googleapis.com/v1beta/interactions?');
        if(!gemini&&url!=='https://api.groq.com/openai/v1/chat/completions')throw new Error('Unexpected fixture endpoint');
        const tool=gemini?body.tools[0].name:body.tools[0].function.name;
        state.requests.push({url,model:body.model,tool});
        // Service failure must settle the UI and wait for an explicit learner retry.
        if(gemini&&tool.endsWith('propose_plan')&&state.planningFailures++===0)return Response.json({error:{code:'service_unavailable',message:'Synthetic provider outage.'}},{status:503});
        // Groq can return a generated-tool failure inside an HTTP-success stream.
        // It must spend the existing repair budget and never commit a partial plan.
        if(!gemini&&tool.endsWith('propose_plan')&&state.planningFailures++===0)return new Response('data: '+JSON.stringify({error:{code:'tool_use_failed',message:'Synthetic rejected generation; do not forward remote messages.'}})+'\n\n');
        for(const item of gemini?body.input:body.messages)if(item.type==='function_result'||item.role==='tool')try{const feedback=JSON.parse(item.result??item.content);if(feedback.diagnostics)state.diagnostics.push(feedback.diagnostics);}catch{/* Fixture diagnostics never include credentials or full requests. */}
        const texts:string[]=gemini?body.input.flatMap((item:any)=>(item.content??[]).map((part:any)=>part.text??'')):body.messages.map((item:any)=>item.content??'');
        let context:any={};for(const text of texts.reverse())try{context=JSON.parse(text);break;}catch{/* Find the last supplied JSON context, not internal feedback. */}
        const concept={id:'force',title:'Mass and gravity',objectives:['Describe attraction'],prerequisiteIds:[],sourceRefs:[] as unknown[]};
        let value:any;
        if(tool.endsWith('propose_plan'))value={title:'Gravity roadmap',sourceDocumentIds:[],concepts:[concept]};
        else if(tool.endsWith('summarize_source'))value={summary:'The supplied notes explain gravity and mass.',sourceRefs:context.evidence.map((item:any)=>item.ref)};
        else if(tool.endsWith('plan_course')){
          const refs=context.summaries.flatMap((summary:any)=>summary.sourceRefs);
          value={title:'Gravity from supplied notes',concepts:[{...concept,sourceRefs:refs}],lessons:[{id:'source-lesson',title:'Read the gravity notes',objectives:['Understand the supplied explanation'],conceptIds:['force'],sourceRefs:refs}]};
        }else value={conceptId:'force',title:'A gravity experiment',narration:'Mass attracts other mass. Change the mass to explore this simple model.',canvas:{mode:'replace',entities:[{id:'mass',kind:'circle',x:300,y:260,radius:30,fill:'#7775E7',label:'Mass'}]},simulation:{id:'mass-lab',title:'Change the mass',source:'globalThis.simulation={init(p){return {mass:p.mass}},step(s){return s},input(s,v){return {mass:v.mass}},render(s){return {entities:[{id:"reading",kind:"text",x:300,y:360,text:"Mass: "+s.mass}],measurements:{mass:s.mass}}}}',controls:[{id:'mass',label:'Mass',type:'slider',value:1,min:1,max:5,step:1,unit:'kg'}],assumptions:['Illustrative model for a provider fixture.']},question:'What changes when the mass grows?',next:'ask'};
        if(tool.endsWith('present_beat')){value.chunks=[{id:'mass-intro',text:value.narration}];value.cues=[];}
        const id=`fixture-call-${++state.serial}`;
        if(gemini){
          const step={type:'function_call',id,name:tool,arguments:value};
          const wire=[
            {event_type:'interaction.created',interaction:{id:`interaction-${state.serial}`,model:body.model}},
            {event_type:'step.start',index:0,step},
            {event_type:'step.stop',index:0},
            {event_type:'interaction.completed',interaction:{id:`interaction-${state.serial}`,model:body.model,status:'requires_action',steps:[step]}},
          ].map(event=>`event: ${event.event_type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('')+'event: done\r\ndata: [DONE]\r\n\r\n';
          const bytes=new TextEncoder().encode(wire);
          return new Response(new ReadableStream<Uint8Array>({start(controller){for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
        }
        return new Response(`data: ${JSON.stringify({id:`response-${state.serial}`,model:body.model,choices:[{index:0,delta:{tool_calls:[{index:0,id,type:'function',function:{name:tool,arguments:JSON.stringify(value)}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
      }) as typeof network.fetch;
    },safetyClassifierResponse.toString());
    return instance;
  };
  const close=async()=>{if(!app)return;await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.close();}).catch(()=>{});await app.close();app=undefined;};
  try{
    app=await launch();let page=await app.firstWindow();
    await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    expect((await page.evaluate(()=>(window as any).livingCanvas.getStatus())).connected).toBe(false);
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    await page.getByLabel(`${name} API key`,{exact:true}).fill(`fixture-${providerId}-key-only`);
    await page.getByRole('button',{name:`Connect ${name}`,exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getStatus())).toMatchObject({connected:false,teachingProvider:providerId,teachingReady:true,model:expectedModel});
    await expect(page.getByLabel(`${name} API key`,{exact:true})).toHaveValue('');
    await page.evaluate(async()=>{
      const api=(window as any).livingCanvas;await api.setElevenLabsKey('fixture-eleven-key-only-12345');
      await api.saveVoiceConfiguration({provider:'elevenlabs',voiceId:'fixture-voice',voiceName:'Fixture teacher',modelId:'eleven_multilingual_v2',stability:.5,similarityBoost:.75,style:0});
    });
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(page.locator('.topbar')).not.toContainText('ChatGPT connected');
    await expect(page.locator('.sidebar-bottom')).not.toContainText('ChatGPT connected');
    await page.getByRole('button',{name:/Start learning/}).click();
    await page.getByLabel('What would you like to learn today?').fill('Teach gravity');
    await page.getByRole('button',{name:'Create roadmap',exact:true}).click();
    if(providerId==='gemini'){
      await expect(page.getByText('Gemini service is temporarily unavailable. Try again later.',{exact:true})).toBeVisible();
      await expect(page.getByText('Your teacher is preparing…',{exact:true})).toBeHidden();
      expect(await app.evaluate(()=>(globalThis as any).__aiFixture.requests.filter((item:any)=>item.tool.endsWith('propose_plan')).length)).toBe(1);
      await page.getByRole('button',{name:'Retry roadmap',exact:true}).click();
    }
    await expect(page.getByRole('region',{name:'Learning roadmap'})).toBeVisible();
    expect(await app.evaluate(()=>(globalThis as any).__aiFixture.requests.filter((item:any)=>item.tool.endsWith('propose_plan')).length)).toBe(2);
    await page.getByRole('button',{name:'Start Teaching',exact:true}).first().click();
    await expect(page.getByText('What changes when the mass grows?',{exact:true})).toBeVisible({timeout:30000});
    const sessions=await page.evaluate(()=>(window as any).livingCanvas.getSessions());const lessonId=sessions[0].id;
    const lesson=await page.evaluate(id=>(window as any).livingCanvas.loadSession(id),lessonId);
    expect(lesson.beats[0].simulation.title).toBe('Change the mass');expect(lesson.scene.length).toBeGreaterThan(0);
    expect(lesson.modelRuns.at(-1)).toMatchObject({providerId,requestedModel:expectedModel,servedModel:expectedModel});
    const mass=page.getByRole('region',{name:'Experiment controls'}).getByRole('slider');await expect(mass).toBeVisible();await mass.press('ArrowRight');
    await expect(mass).toHaveValue('2');
    await page.getByLabel('Ask your teacher a question').fill('Explain how the mass changes the model');
    await page.getByRole('button',{name:'Send question',exact:true}).click();
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__aiFixture.requests.filter((item:any)=>item.tool.endsWith('present_beat')).length)).toBeGreaterThanOrEqual(2);
    const pause=page.getByRole('button',{name:'Pause teaching',exact:true});if(await pause.isVisible())await pause.click();
    const notes=join(directory,'gravity-notes.txt');await writeFile(notes,'Gravity is attraction between masses. Increasing mass increases gravitational attraction. This text is source evidence.');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},notes);
    const docs=await page.evaluate(()=>(window as any).livingCanvas.importStudyMaterial({jobId:'provider-source'}));
    const course=await page.evaluate(documentId=>(window as any).livingCanvas.planCourse({documentIds:[documentId]}),docs[0].id);
    expect(course.plan.concepts[0].sourceRefs.length).toBeGreaterThan(0);
    expect((await readFile(join(directory,`${providerId}-key.enc`))).toString()).not.toContain(`fixture-${providerId}-key-only`);
    await page.screenshot({path:join(root,`${providerId}-lesson.png`)});
    await close();app=await launch();page=await app.firstWindow();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getStatus())).toMatchObject({connected:false,teachingProvider:providerId,teachingReady:true,model:expectedModel});
    expect((await page.evaluate(id=>(window as any).livingCanvas.loadSession(id),lessonId)).beats.length).toBeGreaterThan(0);
    expect((await page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).provider).toBe('elevenlabs');
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    await page.getByRole('button',{name:`Remove ${name} key`,exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getStatus())).toMatchObject({connected:false,teachingProvider:providerId,teachingReady:false});
    expect((await page.evaluate(id=>(window as any).livingCanvas.loadSession(id),lessonId)).beats.length).toBeGreaterThan(0);
    expect((await page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).hasKey).toBe(true);
  }catch(error){if(app)console.error('Synthetic provider diagnostics:',await app.evaluate(()=>(globalThis as any).__aiFixture));throw error;}
  finally{await close().catch(()=>{});if(directory.startsWith(root+sep))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
