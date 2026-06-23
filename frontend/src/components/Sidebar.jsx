function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <circle cx="22" cy="22" r="7" stroke="#c89b2a" strokeWidth="1.5" />
      <path
        d="M22 5L20 11H24Z M22 39L20 33H24Z M5 22L11 20V24Z M39 22L33 20V24Z M34 10L32 16L28 12Z M34 34L28 32L32 28Z M10 34L12 28L16 32Z M10 10L16 12L12 16Z"
        stroke="#7a5c18"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Sidebar({ models, selectedModel, onModelChange, onNewChat }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <SunIcon className="sun-mark" />
      </div>

      <div className="sidebar-section">
        <div className="field-label">Model</div>
        <select
          className="field-select"
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="">Default</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <button className="btn-new" type="button" onClick={onNewChat}>
        New conversation
      </button>
    </aside>
  )
}
