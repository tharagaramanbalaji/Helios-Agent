import { useEffect, useMemo, useRef } from 'react'
import { marked, Renderer } from 'marked'
import DOMPurify from 'dompurify'

// Configure marked once with a custom code-block renderer.
// marked v9 passes code(codeText, lang, escaped) as 3 separate args.
let markedReady = false

function ensureMarked() {
  if (markedReady) return
  markedReady = true

  const renderer = new Renderer()

  renderer.code = function (codeText, lang) {
    const language = lang || 'plaintext'
    const escaped = String(codeText)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    return (
      `<div class="code-block">` +
      `<div class="code-header">` +
      `<span class="code-lang">${language}</span>` +
      `<button class="copy-btn" data-copy-code="true" type="button">Copy</button>` +
      `</div>` +
      `<pre><code>${escaped}</code></pre>` +
      `</div>`
    )
  }

  marked.use({ renderer, gfm: true, breaks: true })
}

function markdownToHtml(raw) {
  ensureMarked()
  try {
    const html = marked.parse(raw || '')
    return DOMPurify.sanitize(html)
  } catch (err) {
    console.error('Markdown parse error:', err)
    // Fallback: escape and show as plain text
    return String(raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
  }
}

export default function Markdown({ content }) {
  const ref = useRef(null)
  const html = useMemo(() => markdownToHtml(content), [content])

  // Delegate copy-button clicks inside the rendered HTML
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handler = async (e) => {
      const btn = e.target.closest('[data-copy-code]')
      if (!btn) return
      const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(code)
        btn.textContent = 'Copied'
        btn.classList.add('copied')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('copied')
        }, 2000)
      } catch {
        // clipboard not available
      }
    }

    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [html])

  return (
    <div
      ref={ref}
      className="msg-bubble md"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
