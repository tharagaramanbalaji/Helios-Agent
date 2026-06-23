import { useEffect, useRef, useState } from 'react'

export default function EditModal({ initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue || '')
  const textareaRef = useRef(null)

  // Focus + select all text when modal opens
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleSave = () => {
    const trimmed = value.trim()
    if (trimmed) onSave(trimmed)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit message" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          className="modal-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          placeholder="Edit your message..."
        />

        <div className="modal-footer">
          <span className="modal-hint">Press Esc to cancel · Ctrl + Enter to save</span>
          <button
            className="modal-btn-single"
            type="button"
            onClick={handleSave}
            disabled={!value.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
