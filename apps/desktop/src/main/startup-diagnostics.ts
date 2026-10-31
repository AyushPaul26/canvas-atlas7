import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Only fixed stage labels, timings and OS error codes enter this per-launch log. */
export function createStartupDiagnostics(directory:string){
  const path=join(directory,'startup.log'),started=performance.now();let entries=0;
  try{mkdirSync(directory,{recursive:true});writeFileSync(path,'',{mode:0o600});}catch{/* Diagnostics cannot prevent launch. */}
  return {path,mark(stage:'starting'|'database-ready'|'window-created'|'services-ready'|'renderer-ready'|'materials-ready'|'materials-failed'|'failed',error?:unknown){
    if(++entries>32)return;
    const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z_0-9]{1,40}$/.test(error.code)?error.code:undefined;
    try{appendFileSync(path,JSON.stringify({stage,elapsedMs:Math.round(performance.now()-started),...(code?{code}:{})})+'\n');}catch{/* Best-effort local diagnostics. */}
  }};
}
