// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createAudioPlayback} from './audioPlayback';
const chunk={id:'chunk',text:'A short explanation.'};
const cursor={beatId:'beat',chunkId:'chunk',offsetSeconds:0,passId:'pass'};
it('aborts an in-flight synthesis when stopped, without reporting heard audio',async()=>{
  let signal:AbortSignal|undefined;
  const synthesize=vi.fn((_text:string,provided?:AbortSignal)=>{signal=provided;return new Promise<null>(()=>{});});
  const audio=createAudioPlayback({synthesize}),heard=vi.fn();
  const work=audio.play(chunk,cursor,{onHeard:heard});expect(signal).toBeInstanceOf(AbortSignal);
  audio.stop();expect(signal!.aborted).toBe(true);expect(await work).toBe('interrupted');expect(heard).not.toHaveBeenCalled();
});
it('retains matching prefetch through the next play and cancels it only on stop',async()=>{
  let signal:AbortSignal|undefined;
  const synthesize=vi.fn((_text:string,provided?:AbortSignal)=>{signal=provided;return new Promise<null>(()=>{});});
  const audio=createAudioPlayback({synthesize});audio.prefetch!(chunk);const work=audio.play(chunk,cursor);
  expect(synthesize).toHaveBeenCalledTimes(1);expect(signal).toBeInstanceOf(AbortSignal);expect(signal!.aborted).toBe(false);
  audio.stop();expect(signal!.aborted).toBe(true);expect(await work).toBe('interrupted');
});
it('cancels matching prefetch if voice becomes disabled before play',async()=>{
  let enabled=true,signal:AbortSignal|undefined;
  const audio=createAudioPlayback({enabled:()=>enabled,synthesize:(_text,provided)=>{signal=provided;return new Promise<null>(()=>{});}});
  audio.prefetch!(chunk);enabled=false;
  expect(await audio.play(chunk,cursor)).toBe('unavailable');expect(signal!.aborted).toBe(true);
});
