import { useEffect, useState, useCallback } from 'react'
import { executePythonCode, fetchSandboxFiles, clearSandboxWorkspace } from '../api'

export default function CodeSandbox({ open, onClose, initialCode }) {
  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState(null)
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)

  // Sync initial code from props
  useEffect(() => {
    if (initialCode) {
      setCode(initialCode)
    }
  }, [initialCode])

  // Fetch file explorer list
  const refreshFiles = useCallback(async () => {
    try {
      const list = await fetchSandboxFiles()
      setFiles(list)
    } catch (err) {
      console.error('Failed to fetch sandbox files:', err)
    }
  }, [])

  // Sync / load workspace files when sandbox opens
  useEffect(() => {
    if (open) {
      refreshFiles()
    }
  }, [open, refreshFiles])

  // Automatically execute if new code is loaded from the chat
  useEffect(() => {
    if (open && initialCode) {
      handleRun(initialCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  const handleRun = async (codeToRun = code) => {
    if (running || !codeToRun?.trim()) return
    setRunning(true)
    setError(null)
    setOutput(null)

    try {
      const res = await executePythonCode(codeToRun)
      setOutput(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      refreshFiles()
    }
  }

  const handleClear = async () => {
    if (running) return
    if (!window.confirm('Are you sure you want to clear the sandbox workspace files?')) return
    try {
      await clearSandboxWorkspace()
      setCode('')
      setOutput(null)
      setError(null)
      setFiles([])
    } catch (err) {
      setError(`Failed to clear workspace: ${err.message}`)
    }
  }

  if (!open) return null

  return (
    <aside className="code-sandbox" aria-label="Code Sandbox">
      <header className="sandbox-header">
        <div className="sandbox-title">
          <span className="sandbox-icon">⚡</span>
          Python Sandbox
        </div>
        <button className="sandbox-close-btn" type="button" onClick={onClose} title="Close Sandbox">
          &times;
        </button>
      </header>

      <div className="sandbox-body">
        {/* File Explorer section */}
        <section className="sandbox-section files-explorer">
          <div className="sandbox-section-title">Workspace Files</div>
          {files.length === 0 ? (
            <div className="empty-files-label">No files created yet. Run some code to generate outputs!</div>
          ) : (
            <div className="files-list">
              {files.map((file) => (
                <div key={file.name} className="file-item" title={file.name}>
                  <svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{(file.sizeBytes / 1024).toFixed(2)} KB</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Code Editor section */}
        <section className="sandbox-section code-editor-sec">
          <div className="sandbox-section-title">Editor</div>
          <div className="editor-window">
            <div className="editor-titlebar">
              <div className="editor-controls">
                <span className="control-dot close" />
                <span className="control-dot minimize" />
                <span className="control-dot expand" />
              </div>
              <span className="editor-filename">main.py</span>
            </div>
            <textarea
              className="sandbox-textarea"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="# Write Python code here...&#10;print('Hello from Helios Sandbox!')"
              disabled={running}
              spellCheck={false}
            />
          </div>
        </section>

        {/* Sandbox actions */}
        <div className="sandbox-actions">
          <button
            className="btn-sandbox-run"
            type="button"
            onClick={() => handleRun()}
            disabled={running || !code.trim()}
          >
            {running ? 'Running...' : 'Run Code'}
          </button>
          <button
            className="btn-sandbox-clear"
            type="button"
            onClick={handleClear}
            disabled={running}
          >
            Reset
          </button>
        </div>

        {/* Terminal output console */}
        <section className="sandbox-section terminal-sec">
          <div className="sandbox-section-title">Terminal Console</div>
          <div className="terminal-window">
            <div className="terminal-titlebar">
              <div className="editor-controls">
                <span className="control-dot terminal-dot" />
              </div>
              <span className="terminal-filename">bash</span>
            </div>
            <div className="terminal-box">
              {running && <div className="terminal-loading">Executing script...<span className="blink-cursor">_</span></div>}
              
              {error && <div className="terminal-stderr">Error: {error}</div>}

              {output && (
                <>
                  {output.stdout && <pre className="terminal-stdout">{output.stdout}</pre>}
                  {output.stderr && <pre className="terminal-stderr">{output.stderr}</pre>}
                  <div className={`terminal-status ${output.exit_code === 0 ? 'success' : 'error'}`}>
                    [Process exited with code {output.exit_code}]
                  </div>
                </>
              )}

              {!running && !error && !output && (
                <div className="terminal-placeholder">Console output will appear here.<span className="blink-cursor">_</span></div>
              )}
            </div>
          </div>
        </section>
      </div>
    </aside>
  )
}
