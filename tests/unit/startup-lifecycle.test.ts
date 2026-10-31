import {expect,it,vi} from 'vitest';
import {createWindowActivation} from '../../apps/desktop/src/main/startup-lifecycle';

function windowStub(minimized=false) {
  return {isDestroyed:()=>false,isMinimized:()=>minimized,restore:vi.fn(),show:vi.fn(),focus:vi.fn()};
}

it('restores and focuses the existing window on a repeat launch',()=>{
  const activation=createWindowActivation(),window=windowStub(true);
  activation.attach(window);expect(window.focus).not.toHaveBeenCalled();
  activation.activate();
  expect(window.restore).toHaveBeenCalledOnce();expect(window.show).toHaveBeenCalledOnce();expect(window.focus).toHaveBeenCalledOnce();
});

it('remembers a repeat launch received before the main window exists',()=>{
  const activation=createWindowActivation(),window=windowStub();
  activation.activate();activation.activate();activation.attach(window);
  expect(window.restore).not.toHaveBeenCalled();expect(window.show).toHaveBeenCalledOnce();expect(window.focus).toHaveBeenCalledOnce();
});

it('does not touch destroyed windows and can activate a later replacement',()=>{
  const activation=createWindowActivation(),old=windowStub();old.isDestroyed=()=>true;
  activation.attach(old);activation.activate();expect(old.show).not.toHaveBeenCalled();
  const replacement=windowStub();activation.attach(replacement);expect(replacement.focus).toHaveBeenCalledOnce();
});
