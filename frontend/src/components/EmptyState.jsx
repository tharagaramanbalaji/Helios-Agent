export default function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c89b2a"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2L11 6H13Z M12 22L11 18H13Z M2 12L6 11V13Z M22 12L18 11V13Z M19 5L18 9L15 6Z M19 19L15 18L18 15Z M5 19L6 15L9 18Z M5 5L9 6L6 9Z"
            stroke="#7a5c18"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="empty-title">Start a conversation</div>
      <div className="empty-sub">
        Ask anything. Helios runs locally — your data never leaves your machine.
      </div>
    </div>
  )
}
