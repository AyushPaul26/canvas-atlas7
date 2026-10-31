import {describe,expect,it} from 'vitest';
import {applyIntentPolicy,DEFAULT_INTENT_POLICY,localIntentDecision,safetyClassificationSchema} from '../../packages/teacher/src/intent-policy';
const allow={decision:'ALLOW',category:'GENERAL_EDUCATION',confidence:.98,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null};
describe('strict student-content policy',()=>{
  it.each(['Teach human reproduction for Class 10.','Give detailed sex education.','Recommend pornographic performers.','Explain sexual techniques in detail.','Generate an erotic story.'])('declines restricted intent before generation: %s',text=>expect(localIntentDecision(text)?.decision).toBe('BLOCK'));
  it.each(['Explain DNA replication.','What are hormones?','How does the human heart work?','Explain cell division.','What causes explosions?','How does encryption work?'])('does not use a keyword-only academic approval: %s',text=>expect(localIntentDecision(text)?.decision).not.toBe('ALLOW'));
  it('does not let an EDUCATION category override detected harmful intent',()=>expect(applyIntentPolicy({...allow,category:'SCIENCE_EDUCATION',risks:['ACTIONABLE_HARM']},DEFAULT_INTENT_POLICY).decision).toBe('BLOCK'));
  it('treats confidence as an estimate and uncertain intent as review',()=>expect(applyIntentPolicy({...allow,confidence:.4},DEFAULT_INTENT_POLICY).decision).toBe('REVIEW'));
  it('rejects malformed and extra classifier data',()=>{
    expect(safetyClassificationSchema.safeParse({...allow,confidence:1.2}).success).toBe(false);
    expect(safetyClassificationSchema.safeParse({...allow,private_reasoning:'hidden'}).success).toBe(false);
  });
  it('redirects an urgent personal symptom without starting an explicit lesson',()=>expect(localIntentDecision('I am bleeding heavily right now and need help.')?.reason_code).toBe('URGENT_HEALTH'));
});
