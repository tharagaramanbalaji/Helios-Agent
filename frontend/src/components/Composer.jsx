import { useCallback, useRef, useState } from 'react'

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  )
}

export default function Composer({ onSend, disabled }) {
  const [input, setInput] = useState('')
  const textareaRef = useRef(null)

  const resize = useCallback((el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  const handleChange = (e) => {
    setInput(e.target.value)
    resize(e.target)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const text = input.trim()
    if (!text || disabled) return
    onSend(text)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          id="msg-input"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message Helios..."
          rows={1}
          disabled={disabled}
        />
        <button
          className="btn-send"
          type="button"
          onClick={submit}
          disabled={disabled || !input.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>
      <div className="composer-hint">
        Press Enter&nbsp;·&nbsp;Shift+Enter for new line
      </div>
    </div>
  )
}
