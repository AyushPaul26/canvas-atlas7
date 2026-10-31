import {describe,expect,it,vi} from 'vitest';
import {createSafetyAudit} from '../../apps/desktop/src/main/safety/audit';
import {SafetyGuardian} from '../../apps/desktop/src/main/safety/guardian';
const safe={decision:'ALLOW',category:'GENERAL_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};
describe('private bounded safety diagnostics',()=>{
  it('projects metadata only and bounds retained storage',()=>{
    let saved='';const audit=createSafetyAudit({getPreference:()=>undefined,setPreference:(_key,value)=>{saved=value;}});
    for(let i=0;i<400;i++)audit({operationId:`request-${i}`,policyVersion:'v1',hash:'a'.repeat(64),decision:'ALLOW',category:'GENERAL_EDUCATION',reason_code:'SAFE_ACADEMIC_REQUEST',durationMs:5,content:'private prompt',apiKey:'secret'} as any);
    const records=JSON.parse(saved);expect(records).toHaveLength(256);expect(records[0].operationId).toBe('request-144');expect(Buffer.byteLength(saved)).toBeLessThanOrEqual(128*1024);expect(saved).not.toContain('private prompt');expect(saved).not.toContain('secret');
  });
  it('records local denials and rate reviews without plaintext or a reversible plain hash',async()=>{
    const audit=vi.fn(),classify=vi.fn(async()=>safe),guardian=new SafetyGuardian({secret:new Uint8Array(32).fill(8),audit,classify,maxCallsPerMinute:1});
    await expect(guardian.authorize({operation:'topic',originalRequest:'Teach human reproduction for school'})).rejects.toThrow();
    await guardian.authorize({operation:'topic',originalRequest:'Explain gravity'});
    await expect(guardian.authorize({operation:'topic',originalRequest:'Explain friction'})).rejects.toThrow();
    expect(audit.mock.calls.map(call=>call[0].decision)).toEqual(['BLOCK','ALLOW','REVIEW']);expect(classify).toHaveBeenCalledTimes(1);expect(JSON.stringify(audit.mock.calls)).not.toMatch(/reproduction|gravity|friction/);
  });
  it('does not allow broken diagnostic storage to change decisions',async()=>{
    const audit=createSafetyAudit({getPreference:()=>'{broken',setPreference:()=>{throw new Error('disk full');}});
    const guardian=new SafetyGuardian({secret:new Uint8Array(32).fill(8),audit:record=>{audit(record);throw new Error('broken logger');},classify:async()=>safe});
    await expect(guardian.authorize({operation:'topic',originalRequest:'Explain gravity'})).resolves.toBeDefined();
    await expect(guardian.authorize({operation:'topic',originalRequest:'Teach human reproduction'})).rejects.toMatchObject({decision:'BLOCK'});
  });
});
