import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHealth, sendViaWebSocket, sendViaHttp, closeSocket } from '../api'
import Sidebar from './Sidebar'
import MessageList from './MessageList'
import Composer from './Composer'
import EditModal from './EditModal'
import CodeSandbox from './CodeSandbox'

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function makeId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : String(Date.now() + Math.random())
}

export default function App() {
  const [models, setModels]               = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [messages, setMessages]           = useState([])
  const [busy, setBusy]                   = useState(false)
  // Edit modal state
  const [editTarget, setEditTarget]       = useState(null) // { index, content }
  // Sandbox state
  const [sandboxOpen, setSandboxOpen]     = useState(false)
  const [sandboxCode, setSandboxCode]     = useState('')

  const requestIdRef       = useRef(0)
  const abortedRef         = useRef(false)
  const abortControllerRef = useRef(null)

  // ── Health check ──────────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const data = await fetchHealth()
      if (data.status === 'healthy') {
        const available = data.available_models ?? []
        setModels(available)
        setSelectedModel((cur) => available.includes(cur) ? cur : '')
      }
    } catch {
      // silently ignore — no status UI
    }
  }, [])

  useEffect(() => {
    checkHealth()
    const timer = setInterval(checkHealth, 60_000)
    return () => {
      clearInterval(timer)
      closeSocket()
    }
  }, [checkHealth])

  // ── Core: generate assistant response ─────────────────────────────────────
  const generateAssistant = useCallback(async (baseMessages) => {
    const assistantId = makeId()
    const requestId   = ++requestIdRef.current
    abortedRef.current = false
    let accumulatedArgs = ''

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const assistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      time: nowLabel(),
      pending: true,
    }

    setBusy(true)
    setMessages([...baseMessages, assistantMessage])

    const payload = {
      model: selectedModel || null,
      messages: baseMessages.map(({ role, content, toolCalls }) => ({ role, content, toolCalls })),
      temperature: 0.7,
    }

    const patch = (text) => {
      if (requestId !== requestIdRef.current) return
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: text, pending: false } : m)
      )
    }

    const handleToolEvent = (event) => {
      if (requestId !== requestIdRef.current) return

      if (event.type === 'sandbox_stream') {
        accumulatedArgs += event.content || ''
        const match = accumulatedArgs.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)/)
        if (match) {
          const unescapedCode = match[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/\\t/g, '\t')
          
          setSandboxCode(unescapedCode)
          setSandboxOpen(true)
        }
        return
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m
          const currentCalls = m.toolCalls || []
          if (event.type === 'tool_start') {
            if (currentCalls.some((c) => c.id === event.id)) return m
            
            if (event.tool === 'python_interpreter' && event.args && event.args.code) {
              setSandboxCode(event.args.code)
              setSandboxOpen(true)
            }
            
            return {
              ...m,
              pending: false,
              content: '', // Clear any pre-explanation text
              toolCalls: [
                ...currentCalls,
                { id: event.id, tool: event.tool, args: event.args, status: 'running' }
              ]
            }
          } else if (event.type === 'tool_result') {
            return {
              ...m,
              pending: false,
              toolCalls: currentCalls.map((c) =>
                c.id === event.id
                  ? { ...c, result: event.result, status: 'done' }
                  : c
              )
            }
          } else if (event.type === 'benchmarks') {
            return {
              ...m,
              benchmarks: event.metrics
            }
          }
          return m
        })
      )
    }

    try {
      let text
      try {
        text = await sendViaWebSocket(payload, {
          onToken: patch,
          onToolEvent: handleToolEvent,
          signal: abortController.signal,
        })
      } catch {
        if (abortedRef.current || requestId !== requestIdRef.current) return
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: '', pending: true } : m)
        )
        text = await sendViaHttp(payload, {
          onToken: patch,
          signal: abortController.signal,
        })
      }

      if (text === null || requestId !== requestIdRef.current || abortedRef.current) return
      patch(text ?? '')
    } catch (err) {
      if (abortedRef.current || requestId !== requestIdRef.current) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err.message}`, pending: false }
            : m
        )
      )
    } finally {
      if (requestId === requestIdRef.current) {
        setBusy(false)
        abortedRef.current = false
        abortControllerRef.current = null
      }
    }
  }, [selectedModel])

  // ── Send a new user message ───────────────────────────────────────────────
  const send = useCallback(async (text) => {
    if (busy || !text?.trim()) return
    const userMessage = {
      id: makeId(),
      role: 'user',
      content: text.trim(),
      time: nowLabel(),
    }
    await generateAssistant([...messages, userMessage])
  }, [busy, messages, generateAssistant])

  // ── Stop generation ───────────────────────────────────────────────────────
  const stopGeneration = useCallback(() => {
    abortedRef.current = true
    requestIdRef.current++
    abortControllerRef.current?.abort()
    setMessages((prev) =>
      prev.map((m) => m.pending ? { ...m, content: 'Stopped.', pending: false } : m)
    )
    setBusy(false)
  }, [])

  // ── New conversation ──────────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    requestIdRef.current++
    abortedRef.current = true
    abortControllerRef.current?.abort()
    setMessages([])
    setBusy(false)
    setEditTarget(null)
  }, [])

  // ── Edit: open modal ──────────────────────────────────────────────────────
  const editUserMessage = useCallback((index) => {
    if (busy) return
    const msg = messages[index]
    if (!msg || msg.role !== 'user') return
    setEditTarget({ index, content: msg.content })
  }, [busy, messages])

  // ── Edit: save from modal ─────────────────────────────────────────────────
  const handleEditSave = useCallback(async (newContent) => {
    if (!editTarget) return
    const { index } = editTarget
    setEditTarget(null)
    const msg = messages[index]
    if (!msg) return
    const edited = { ...msg, content: newContent.trim(), time: nowLabel() }
    await generateAssistant([...messages.slice(0, index), edited])
  }, [editTarget, messages, generateAssistant])

  const handleEditCancel = useCallback(() => {
    setEditTarget(null)
  }, [])

  // ── Regenerate an assistant message ──────────────────────────────────────
  const regenerateAssistant = useCallback(async (index) => {
    if (busy) return
    const msg = messages[index]
    if (!msg || msg.role !== 'assistant') return
    await generateAssistant(messages.slice(0, index))
  }, [busy, messages, generateAssistant])

  // ── Run Python code block in sandbox ──────────────────────────────────────
  const handleRunCode = useCallback((codeText) => {
    setSandboxCode(codeText)
    setSandboxOpen(true)
  }, [])

  const modelLabel = selectedModel || 'default'

  return (
    <>
      <div className={`shell ${sandboxOpen ? 'shell-with-sandbox' : ''}`}>
        <Sidebar
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onNewChat={newConversation}
        />

        <main className={`chat ${busy ? 'busy' : ''}`}>
          <header className="topbar">
            <div>
              <div className="topbar-label">Helios Chat</div>
              <div className="topbar-model">{modelLabel}</div>
            </div>
            <div className="topbar-actions">
              {busy && (
                <button className="btn-stop" type="button" onClick={stopGeneration}>
                  Stop
                </button>
              )}
              <button className="btn-clear" type="button" onClick={newConversation}>
                Clear
              </button>
            </div>
          </header>

          <MessageList
            messages={messages}
            onPrompt={send}
            onEdit={editUserMessage}
            onRegenerate={regenerateAssistant}
            onRunCode={handleRunCode}
          />

          <Composer onSend={send} disabled={busy} />
        </main>

        <CodeSandbox
          open={sandboxOpen}
          onClose={() => setSandboxOpen(false)}
          initialCode={sandboxCode}
        />
      </div>

      {editTarget && (
        <EditModal
          initialValue={editTarget.content}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      )}
    </>
  )
}
