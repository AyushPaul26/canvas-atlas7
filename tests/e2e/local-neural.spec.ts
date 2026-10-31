import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

test('installed female neural voice produces offline PCM, recognizes a fresh phrase, and cancels', async () => {
  test.skip(!process.env.LIVING_CANVAS_LOCAL_VOICE_PROFILE, 'Opt-in installed-model trial; preserves the supplied profile')
  test.setTimeout(90000)
  const executablePath=process.env.LIVING_CANVAS_PACKAGED_EXE
  const app=await electron.launch({executablePath,args:executablePath?[]:[join(process.cwd(),'apps/desktop/out/main/app.js')],env:{...process.env,LIVING_CANVAS_USER_DATA:process.env.LIVING_CANVAS_LOCAL_VOICE_PROFILE!}})
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'Canvas Atlas home'}).waitFor()
    await app.evaluate(({session})=>{
      ;(globalThis as any).__voiceNetworkAttempts=0
      session.fromPartition('living-canvas-network',{cache:false}).webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{(globalThis as any).__voiceNetworkAttempts++;callback({cancel:true})})
    })
    const status=await page.evaluate(()=>(window as any).livingCanvas.voiceStatus())
    expect(status).toMatchObject({recognitionReady:true,synthesisReady:true,neuralReady:true,synthesisEngine:'kokoro'})
    expect(status.voiceName).toMatch(/Heart.*female/i)
    const metrics=await page.evaluate(async()=>{
      const bridge=(window as any).livingCanvas
      const results:Array<{synthesisMs:number;durationSeconds:number;sampleRate:number;peak:number;transcript?:string;recognitionMs?:number}>=[]
      for(const text of ['Today I would like to learn about gravitation.','Gravity weakens as the distance between objects increases.']){
        const start=performance.now();const pcm=await bridge.synthesizeSpeech(text)
        if(!pcm||pcm.sampleRate!==24000)throw Error('Expected neural PCM')
        const samples=Float32Array.from(pcm.samples);let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample))
        results.push({synthesisMs:Math.round(performance.now()-start),durationSeconds:samples.length/pcm.sampleRate,sampleRate:pcm.sampleRate,peak})
        if(results.length===1){
          const frames=Math.floor(samples.length*16000/24000);const wav=new ArrayBuffer(44+frames*2);const view=new DataView(wav)
          const word=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i))}
          word(0,'RIFF');view.setUint32(4,36+frames*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,frames*2,true)
          for(let i=0;i<frames;i++)view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(samples[Math.floor(i*1.5)]*32767))),true)
          const asr=performance.now();const transcript=await bridge.transcribeAudio(wav)
          Object.assign(results[0],{transcript,recognitionMs:Math.round(performance.now()-asr)})
        }
      }
      const start=performance.now();const pending=bridge.synthesizeSpeech('An extended explanation should stop promptly when the learner interrupts. '.repeat(5)).then(()=>({canceled:false}),()=>({canceled:true}))
      await new Promise(resolve=>setTimeout(resolve,50));await bridge.interrupt('local-neural-verification')
      return {results,cancellation:{...await pending,elapsedMs:Math.round(performance.now()-start)}}
    })
    expect(metrics.results).toHaveLength(2)
    for(const pcm of metrics.results){expect(pcm.peak).toBeGreaterThan(.001);expect(pcm.durationSeconds).toBeGreaterThan(1)}
    expect(metrics.results[0].transcript).toMatch(/gravitation/i)
    expect(metrics.cancellation.canceled).toBe(true)
    expect(await app.evaluate(()=>(globalThis as any).__voiceNetworkAttempts)).toBe(0)
    console.log(JSON.stringify({neuralVoiceTrial:metrics}))
  }finally{await app.close()}
})
