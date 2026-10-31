import { beforeEach, describe, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ fetch: vi.fn(), fromPartition: vi.fn() }))
vi.mock('electron', () => ({ session: { fromPartition: transport.fromPartition } }))
import { createDesktopFetch } from '../../apps/desktop/src/main/network'

describe('trusted desktop network transport', () => {
  beforeEach(() => { vi.clearAllMocks(); transport.fromPartition.mockReturnValue({ fetch: transport.fetch }) })
  it('uses a separate ephemeral Chromium session without changing TLS verification', async () => {
    const response = new Response('{}'); transport.fetch.mockResolvedValue(response)
    const request = createDesktopFetch()
    const signal = new AbortController().signal
    const headers = { Authorization: 'Bearer test-only-token', 'Content-Type': 'application/x-www-form-urlencoded' }
    expect(await request(new URL('https://auth.openai.com/api/accounts/oauth/token'), { method: 'POST', body: 'test-body', headers, signal })).toBe(response)
    expect(transport.fromPartition).toHaveBeenCalledWith('living-canvas-network', { cache: false })
    expect(transport.fetch).toHaveBeenCalledWith('https://auth.openai.com/api/accounts/oauth/token', { method: 'POST', body: 'test-body', headers, signal, credentials: 'omit', cache: 'no-store' })
  })
  it('preserves cancellation and presents a safe actionable connection error', async () => {
    const request = createDesktopFetch()
    transport.fetch.mockRejectedValue(new Error('net::ERR_CERT_AUTHORITY_INVALID private-diagnostic'))
    await expect(request('https://auth.openai.com/')).rejects.toThrow(/secure connection/i)
    const controller = new AbortController(); const reason = new DOMException('Canceled', 'AbortError'); controller.abort(reason)
    await expect(request('https://auth.openai.com/', { signal: controller.signal })).rejects.toBe(reason)
  })
})
