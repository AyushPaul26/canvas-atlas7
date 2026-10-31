import {bridge} from './bridge';

/** Cancellation targets just this narration/preview, never microphone recognition. */
export async function requestSpeech(text:string,purpose:'lesson'|'preview',signal?:AbortSignal){
  signal?.throwIfAborted();const requestId=crypto.randomUUID();
  const abort=()=>{void Promise.resolve(bridge.cancelSpeech?.(requestId)).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{return await bridge.synthesizeSpeech(text,{requestId,purpose});}
  finally{signal?.removeEventListener('abort',abort);}
}
