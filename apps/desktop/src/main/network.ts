import { session } from 'electron'

/** Chromium uses the device's network/proxy and certificate configuration. Keep
 * this main-process session separate from the restricted UI and guest sessions. */
export function createDesktopFetch(): typeof fetch {
  const network = session.fromPartition('living-canvas-network', { cache: false })
  return async (input, init) => {
    try {
      init?.signal?.throwIfAborted()
      return await network.fetch(input instanceof URL ? input.toString() : input, { ...init, credentials: 'omit', cache: 'no-store' })
    } catch (error) {
      if (init?.signal?.aborted) throw init.signal.reason
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error('Could not establish a secure connection. Check your internet connection or Windows proxy settings, then try again.', { cause: error })
    }
  }
}
