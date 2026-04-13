import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setWsConnectedMock = vi.fn()

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new Event('close'))
  })

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    })
  }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

async function loadTransportModule() {
  vi.resetModules()
  vi.doMock('./environment', () => ({
    isNativeApp: () => false,
    setWsConnected: setWsConnectedMock,
  }))
  return import('./transport')
}

describe('transport bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    localStorage.clear()
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./environment')
  })

  it('does not open websocket until bootstrap explicitly connects it', async () => {
    const transport = await loadTransportModule()

    await transport.listen('chat:chunk', vi.fn())
    expect(MockWebSocket.instances).toHaveLength(0)

    transport.connectTransport()
    await flushAsync()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(setWsConnectedMock).toHaveBeenCalledWith(true)
  })

  it('buffers bootstrap replay events before listeners connect and replays them in seq order', async () => {
    const transport = await loadTransportModule()
    const handler = vi.fn()

    transport.ingestBootstrapEvents([
      {
        type: 'event',
        event: 'chat:chunk',
        payload: { session_id: 'session-1', content: 'second' },
        seq: 2,
      },
      {
        type: 'event',
        event: 'chat:chunk',
        payload: { session_id: 'session-1', content: 'first' },
        seq: 1,
      },
    ])

    await transport.listen('chat:chunk', handler)

    expect(handler.mock.calls).toEqual([
      [{ payload: { session_id: 'session-1', content: 'first' } }],
      [{ payload: { session_id: 'session-1', content: 'second' } }],
    ])
    expect(MockWebSocket.instances).toHaveLength(0)
  })
})
