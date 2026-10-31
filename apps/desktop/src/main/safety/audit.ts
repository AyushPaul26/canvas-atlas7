import type {SafetyAudit} from './guardian';

type Store={getPreference(key:string):string|undefined;setPreference(key:string,value:string):void};
const KEY='safety:audit:v1',MAX_RECORDS=256,MAX_BYTES=128*1024;
/** Local bounded metadata only. Diagnostics must never change a safety decision. */
export function createSafetyAudit(store:Store):(record:SafetyAudit)=>void{
  let records:unknown[]=[];
  try{const raw=store.getPreference(KEY);if(raw&&Buffer.byteLength(raw)<=MAX_BYTES){const parsed:unknown=JSON.parse(raw);if(Array.isArray(parsed))records=parsed.slice(-MAX_RECORDS);}}catch{/* optional diagnostics */}
  return record=>{
    try{
      // Explicit projection prevents future caller fields from logging passages.
      const entry={at:new Date().toISOString(),operationId:record.operationId,policyVersion:record.policyVersion,hash:record.hash,decision:record.decision,category:record.category,reason_code:record.reason_code,durationMs:record.durationMs};
      records.push(entry);records=records.slice(-MAX_RECORDS);
      while(records.length&&Buffer.byteLength(JSON.stringify(records))>MAX_BYTES)records.shift();
      store.setPreference(KEY,JSON.stringify(records));
    }catch{/* storage failure cannot override policy enforcement */}
  };
}
