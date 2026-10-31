import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { installCloseHandshake } from '../../apps/desktop/src/main/close-handshake'
afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, destroy: vi.fn() })
  const notify = vi.fn(); const handshake = installCloseHandshake(window as any, notify)
  return { window, notify, handshake }
}
it('waits for the renderer checkpoint before normal close and ignores unsolicited acknowledgements', () => {
  const { window, notify, handshake } = setup()
  handshake.acknowledge(); vi.advanceTimersByTime(1); expect(window.destroy).not.toHaveBeenCalled()
  const preventDefault = vi.fn(); window.emit('close', { preventDefault }); window.emit('close', { preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2); expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith({ type: 'closing' }); expect(window.destroy).not.toHaveBeenCalled()
  handshake.acknowledge(); vi.advanceTimersByTime(1); expect(window.destroy).toHaveBeenCalledTimes(1)
  handshake.dispose()
})
it('allows closing after a bounded wait if the renderer is unavailable', () => {
  const { window, handshake } = setup(); window.emit('close', { preventDefault() {} })
  vi.advanceTimersByTime(2499); expect(window.destroy).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1); expect(window.destroy).toHaveBeenCalledTimes(1); handshake.dispose()
})
