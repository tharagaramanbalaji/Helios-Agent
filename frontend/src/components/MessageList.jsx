import { useEffect, useRef } from 'react'
import EmptyState from './EmptyState'
import MessageRow from './MessageRow'

export default function MessageList({ messages, onPrompt, onEdit, onRegenerate }) {
  const listRef = useRef(null)

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }
    })
  }, [messages])

  return (
    <section
      ref={listRef}
      className="messages"
      id="messages"
      aria-live="polite"
    >
      {messages.length === 0 ? (
        <EmptyState onPrompt={onPrompt} />
      ) : (
        messages.map((msg, i) => (
          <MessageRow
            key={msg.id}
            message={msg}
            index={i}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
          />
        ))
      )}
    </section>
  )
}
