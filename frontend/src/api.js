/**
 * api.js — WebSocket + HTTP streaming client for Helios
 *
 * In dev: Vite proxy forwards /ws/chat and /chat to FastAPI on :8000
 * In prod: FastAPI serves both the static frontend and the API
 */

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/chat`

let socket = null
let reconnectTimer = null

/** Returns an open (or opening) WebSocket, creating one if needed. */
export function getSocket(onClose) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket
  }

  socket = new WebSocket(WS_URL)

  socket.addEventListener('close', () => {
    socket = null
    onClose?.()
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        getSocket(onClose)
      }, 3000)
    }
  })

  return socket
}

export function closeSocket() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (socket) { socket.close(1000, 'page closed'); socket = null }
}

/**
 * Send a chat request over WebSocket.
 * Calls onToken(text) for each streamed chunk.
 * Returns the full accumulated text when done.
 */
export function sendViaWebSocket(payload, { onToken, onToolEvent, signal }) {
  return new Promise((resolve, reject) => {
    const ws = getSocket()
    if (!ws) { reject(new Error('WebSocket unavailable')); return }

    let text = ''
    let started = false

    const cleanup = () => {
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
    }

    const onMessage = (event) => {
      if (signal?.aborted) { cleanup(); resolve(null); return }
      let msg
      try { msg = JSON.parse(event.data) } catch { return }

      if (msg.type === 'token') {
        text += msg.content || ''
        onToken?.(text)
      } else if (msg.type === 'tool_start' || msg.type === 'tool_result' || msg.type === 'benchmarks') {
        onToolEvent?.(msg)
      } else if (msg.type === 'done') {
        cleanup(); resolve(text)
      } else if (msg.type === 'error') {
        cleanup(); reject(new Error(msg.detail || 'WebSocket error'))
      }
    }

    const onClose = () => { cleanup(); reject(new Error('WebSocket closed')) }
    const onError = () => { cleanup(); reject(new Error('WebSocket error')) }

    const startSend = () => {
      if (started) return
      started = true
      ws.addEventListener('message', onMessage)
      ws.addEventListener('close', onClose)
      ws.addEventListener('error', onError)
      ws.send(JSON.stringify(payload))
    }

    if (ws.readyState === WebSocket.OPEN) {
      startSend()
    } else {
      const onOpen = () => { ws.removeEventListener('open', onOpen); startSend() }
      ws.addEventListener('open', onOpen)
      setTimeout(() => {
        if (!started) { cleanup(); reject(new Error('WebSocket timed out')) }
      }, 3000)
    }
  })
}

/**
 * Send a chat request over HTTP streaming (fetch + ReadableStream).
 * Calls onToken(text) for each decoded chunk.
 */
export async function sendViaHttp(payload, { onToken, signal }) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.detail || `HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onToken?.(text)
  }

  return text
}

/** Fetch available models + connection status from /health */
export async function fetchHealth() {
  const response = await fetch('/health')
  return response.json()
}

/** Execute python code in the sandbox */
export async function executePythonCode(code, files = null) {
  const response = await fetch('/sandbox/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, files }),
  })
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}))
    throw new Error(errData.detail || `Execution failed with HTTP ${response.status}`)
  }
  return response.json()
}

/** Get list of files in the sandbox workspace */
export async function fetchSandboxFiles() {
  const response = await fetch('/sandbox/files')
  if (!response.ok) throw new Error(`Failed to fetch files: HTTP ${response.status}`)
  return response.json()
}

/** Clear all files in the sandbox workspace */
export async function clearSandboxWorkspace() {
  const response = await fetch('/sandbox/clear', { method: 'POST' })
  if (!response.ok) throw new Error(`Failed to clear workspace: HTTP ${response.status}`)
  return response.json()
}
