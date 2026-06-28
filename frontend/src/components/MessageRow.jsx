import ThinkingDots from './ThinkingDots'
import Markdown from './Markdown'

function ToolIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function formatToolArgs(tool, args) {
  if (!args) return ''
  if (typeof args === 'string') return args
  
  if (tool === 'calculate' && args.expression) {
    return args.expression
  }
  
  try {
    const keys = Object.keys(args)
    if (keys.length === 1 && keys[0] === 'expression') {
      return args.expression
    }
    return keys.map((k) => `${k}=${JSON.stringify(args[k])}`).join(', ')
  } catch (e) {
    return JSON.stringify(args)
  }
}

export default function MessageRow({ message, index, onEdit, onRegenerate, onRunCode }) {
  const { role, content, time, pending, toolCalls, benchmarks } = message

  return (
    <div
      className={`msg ${role}${pending ? ' msg-pending' : ''}`}
      data-history-index={index}
    >
      <div className="msg-sender">{role === 'user' ? 'You' : 'Helios'}</div>

      {pending ? (
        <div className="msg-bubble">
          <ThinkingDots />
        </div>
      ) : role === 'assistant' ? (
        <div className="msg-bubble md">
          {toolCalls && toolCalls.map((tc) => {
            const argText = formatToolArgs(tc.tool, tc.args)
            const isDone = tc.status === 'done'
            const isError = tc.result && tc.result.startsWith('Error')
            
            return (
              <div key={tc.id} className={`tool-call-block ${tc.status} ${isError ? 'has-error' : ''}`}>
                <span className="tool-call-icon"><ToolIcon className="tool-call-svg" /></span>
                <span className="tool-call-name">{tc.tool}</span>
                {tc.tool !== 'python_interpreter' && argText && (
                  <span className="tool-call-expr">({argText})</span>
                )}
                {tc.result && tc.tool !== 'python_interpreter' && (
                  tc.tool === 'websearch' ? (() => {
                    try {
                      const searchResults = JSON.parse(tc.result)
                      if (!Array.isArray(searchResults)) throw new Error('Not an array')
                      return (
                        <div className="search-results-list">
                          {searchResults.map((res, idx) => {
                            let domain = ''
                            try {
                              domain = new URL(res.url).hostname.replace('www.', '')
                            } catch (e) {
                              domain = res.url
                            }
                            return (
                              <a
                                key={idx}
                                href={res.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="search-result-chip"
                                title={res.snippets ? res.snippets.join(' ') : ''}
                              >
                                <span className="search-result-title">{res.title}</span>
                                <span className="search-result-domain">{domain}</span>
                              </a>
                            )
                          })}
                        </div>
                      )
                    } catch (e) {
                      return (
                        <div className="tool-call-error-detail">
                          {tc.result}
                        </div>
                      )
                    }
                  })() : (
                    <>
                      <span className="tool-call-arrow">→</span>
                      <span className="tool-call-result">
                        {isError ? 'Failed' : tc.result}
                      </span>
                    </>
                  )
                )}
                {!isDone && <span className="tool-call-loading-dots">...</span>}
                {isError && tc.tool !== 'websearch' && tc.tool !== 'python_interpreter' && (
                  <div className="tool-call-error-detail">
                    {tc.result}
                  </div>
                )}
              </div>
            )
          })}
          {content && <Markdown content={content} onRunCode={onRunCode} />}
        </div>
      ) : (
        <div
          className="msg-bubble"
          onClick={() => onEdit(index)}
          title="Click to edit"
        >
          {content}
        </div>
      )}

      <div className="msg-meta">
        <div className="msg-time">
          {time}
          {role === 'assistant' && benchmarks && (
            <span className="msg-benchmarks">
              {' · '}
              <span className="msg-benchmarks-icon">⚡</span>
              {`TTFT: ${benchmarks.ttft_ms}ms · ${benchmarks.tokens_per_sec} tok/s · Latency: ${benchmarks.total_latency_s}s`}
            </span>
          )}
        </div>
        <div className="msg-actions">
          {role === 'assistant' && !pending && (
            <button
              className="msg-action"
              type="button"
              onClick={() => onRegenerate(index)}
            >
              Regenerate
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
