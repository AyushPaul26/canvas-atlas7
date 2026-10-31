import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';

test('physical microphone capture opens locally and releases its tracks',async()=>{
  test.skip(process.env.CANVAS_ATLAS_MIC_TRIAL!=='1','Opt-in hardware capture trial; no audio is saved or transmitted');
  const app=await electron.launch({args:[join(process.cwd(),'apps/desktop/out/main/app.js')],env:{...process.env,LIVING_CANVAS_USER_DATA:process.env.LIVING_CANVAS_LOCAL_VOICE_PROFILE!}});
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'Canvas Atlas home'}).waitFor();
    const result=await page.evaluate(async()=>{
      try{
        const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});
        const context=new AudioContext();await context.resume();const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();source.connect(analyser);
        const samples=new Float32Array(analyser.fftSize);let peak=0,frames=0;
        for(let i=0;i<10;i++){await new Promise(resolve=>setTimeout(resolve,100));analyser.getFloatTimeDomainData(samples);for(const value of samples)peak=Math.max(peak,Math.abs(value));frames+=samples.length;}
        const tracks=stream.getAudioTracks(),settings=tracks[0]?.getSettings();tracks.forEach(track=>track.stop());source.disconnect();await context.close();
        return {available:true,frames,peak,sampleRate:settings?.sampleRate,channels:settings?.channelCount,released:tracks.every(track=>track.readyState==='ended')};
      }catch(error){return {available:false,reason:error instanceof Error?error.name:'Capture unavailable'};}
    });
    console.log(JSON.stringify({physicalMicrophoneTrial:result}));
    test.skip(!result.available,'No accessible physical microphone/OS permission in this environment');
    expect(result.frames).toBeGreaterThan(0);expect(result.released).toBe(true);
  }finally{await app.close();}
});
