import {it,expect} from 'vitest';
import {RequestEpochs} from '../../apps/desktop/src/main/ai/request-epochs';
it('aborts replaced work, rejects stale callbacks, isolates sessions',()=>{
  const requests=new RequestEpochs();const first=requests.begin('one');const other=requests.begin('two');const next=requests.begin('one');
  expect(first.signal.aborted).toBe(true);expect(requests.isCurrent('one',first.epoch)).toBe(false);
  expect(requests.isCurrent('one',next.epoch)).toBe(true);expect(other.signal.aborted).toBe(false);
  requests.interrupt('one');expect(next.signal.aborted).toBe(true);
});
