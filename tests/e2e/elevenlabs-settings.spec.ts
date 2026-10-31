import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {VOICE_PREVIEW_TEXT} from '@living-canvas/protocol';

test('account voice settings persist securely and use cancellable PCM without exposing renderer networking',async()=>{
  test.setTimeout(90000);
  const root=join(process.cwd(),'.test-tmp');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'eleven-desktop-'));
  const executablePath=process.env.LIVING_CANVAS_PACKAGED_EXE;
  let app:ElectronApplication|undefined;
  const launch=async()=>{
    const instance=await electron.launch({executablePath,args:executablePath?[]:[join(process.cwd(),'apps/desktop/out/main/app.js')],env:{...process.env,LIVING_CANVAS_USER_DATA:directory}});
    await instance.evaluate(({session})=>{
      const state={requests:[] as {url:string;text?:string}[],slow:false,slowNext:false};(globalThis as any).__elevenFixture=state;
      const network=session.fromPartition('living-canvas-network',{cache:false});
      network.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);if(!url.startsWith('https://api.elevenlabs.io/'))throw new Error('Unexpected fixture network request');
        const body=init?.body?JSON.parse(String(init.body)):undefined;state.requests.push({url,text:body?.text});
        if(url.includes('/voices?'))return Response.json({voices:[{voice_id:'fixture-voice',name:'Fixture teacher',labels:{accent:'Indian'}}],has_more:false});
        if(url.includes('/text-to-speech/')){
          if(state.slowNext){state.slow=true;return new Promise<Response>((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}
          const samples=new Int16Array(24000);for(let i=0;i<samples.length;i++)samples[i]=Math.round(Math.sin(i/24000*2*Math.PI*220)*1000);
          return new Response(new Uint8Array(samples.buffer),{headers:{'Content-Type':'audio/pcm'}});
        }
        throw new Error('Unexpected ElevenLabs endpoint');
      }) as typeof network.fetch;
    });
    return instance;
  };
  const close=async()=>{if(!app)return;await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.close();}).catch(()=>{});await app.close();app=undefined;};
  try{
    app=await launch();let page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    await page.getByLabel('ElevenLabs API key').fill('fixture-key-not-a-real-provider-key');await page.getByRole('button',{name:'Connect ElevenLabs',exact:true}).click();
    await expect(page.getByRole('option',{name:/Fixture teacher/})).toBeAttached();await expect(page.getByLabel('ElevenLabs API key')).toHaveValue('');
    await page.getByLabel('ElevenLabs voice',{exact:true}).selectOption('fixture-voice');await page.getByRole('button',{name:'Use this voice',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).toMatchObject({provider:'elevenlabs',voiceId:'fixture-voice',hasKey:true});
    await page.getByRole('slider',{name:/Speaking speed/}).press('End');
    await page.evaluate(()=>{
      const Native=window.AudioContext;
      window.AudioContext=class extends Native{createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(when=0,offset=0,duration?:number)=>{(window as any).__previewRate=source.playbackRate.value;if(duration===undefined)start(when,offset);else start(when,offset,duration);};return source;}};
    });
    await page.getByRole('button',{name:'Preview voice',exact:true}).click();
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__elevenFixture.requests.filter((r:any)=>r.url.includes('/text-to-speech/')).length)).toBe(1);
    await expect.poll(()=>page.evaluate(()=>(window as any).__previewRate)).toBe(1.25);
    await expect(page.getByRole('button',{name:'Preview voice',exact:true})).toBeEnabled();
    const beforeUnapproved=await app!.evaluate(()=>(globalThis as any).__elevenFixture.requests.length);
    expect(await page.evaluate(()=>(window as any).livingCanvas.synthesizeSpeech('This text has not been approved',{requestId:'unapproved',purpose:'lesson'}).then(()=>false,()=>true))).toBe(true);
    expect(await app!.evaluate(()=>(globalThis as any).__elevenFixture.requests.length)).toBe(beforeUnapproved);
    await app!.evaluate(()=>{(globalThis as any).__elevenFixture.slowNext=true;});
    const pending=page.evaluate(text=>(window as any).livingCanvas.synthesizeSpeech(text,{requestId:'e2e-slow',purpose:'preview'}).then(()=>false,()=>true),VOICE_PREVIEW_TEXT);
    await expect.poll(()=>app!.evaluate(()=>(globalThis as any).__elevenFixture.slow)).toBe(true);
    await page.evaluate(()=>(window as any).livingCanvas.cancelSpeech('e2e-slow'));expect(await pending).toBe(true);
    expect((await readFile(join(directory,'elevenlabs-key.enc'))).toString()).not.toContain('fixture-key-not-a-real-provider-key');
    await page.screenshot({path:join(root,'elevenlabs','settings-desktop.png')});
    await close();app=await launch();page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    expect(await page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).toMatchObject({provider:'elevenlabs',voiceId:'fixture-voice',hasKey:true});
    await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('button',{name:'Use local voice',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).toMatchObject({provider:'local'});
    await page.getByRole('button',{name:'Remove API key',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).livingCanvas.getVoiceConfiguration())).toMatchObject({provider:'local',hasKey:false});
  }finally{await close().catch(()=>{});await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
