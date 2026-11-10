import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'

const SUGGESTIONS_WITH_DATA = [
  'Which class has the lowest attendance?',
  'Show students below 75% attendance',
  'Which students are absent most often?',
  'Which weekday has the lowest attendance?'
]

const SUGGESTIONS_NO_DATA = [
  'How do I upload data?',
  'How is attendance calculated?',
  'What can you do?'
]

const WELCOME_DATA =
  'Hi! Ask me anything about your attendance data or how this dashboard works.'

const WELCOME_NO_DATA =
  'Hi! Please upload an attendance dataset to ask questions about your data. ' +
  'I can already explain how the dashboard works.'

export default function AIChatbot({ api, datasetLoaded, filename }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([])
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Show a welcome message, and tell the user when a new file is loaded.
  useEffect(() => {
    setMessages(current => {
      if (!current.length) {
        return [{ role: 'assistant', content: datasetLoaded ? WELCOME_DATA : WELCOME_NO_DATA }]
      }
      if (datasetLoaded) {
        return [
          ...current,
          {
            role: 'assistant',
            content: `${filename || 'Your file'} is loaded. Ask me about students, classes or absences.`
          }
        ]
      }
      return current
    })
  }, [datasetLoaded, filename])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      inputRef.current?.focus()
    }
  }, [messages, busy, open])

  useEffect(() => {
    const onKey = event => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function send(text) {
    const question = (text ?? input).trim()
    if (question.length < 2 || busy) return

    const history = messages
      .filter(m => !m.error)
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }))

    setMessages(current => [...current, { role: 'user', content: question }])
    setInput('')
    setBusy(true)

    try {
      const response = await axios.post(`${api}/ask`, { question, history })
      setMessages(current => [
        ...current,
        { role: 'assistant', content: response.data.answer }
      ])
    } catch (err) {
      setMessages(current => [
        ...current,
        {
          role: 'assistant',
          error: true,
          content:
            err.response?.data?.detail ||
            'I could not reach the server. Make sure the backend is running.'
        }
      ])
    } finally {
      setBusy(false)
    }
  }

  const suggestions = datasetLoaded ? SUGGESTIONS_WITH_DATA : SUGGESTIONS_NO_DATA
  const showSuggestions = messages.filter(m => m.role === 'user').length === 0

  return (
    <>
      {open && (
        <section className="ai-panel" role="dialog" aria-label="Ask AI assistant">
          <header className="ai-header">
            <div className="ai-avatar">✦</div>
            <div className="ai-title">
              <strong>Ask AI</strong>
              <small>
                <span className={`ai-dot ${datasetLoaded ? 'on' : ''}`} />
                {datasetLoaded ? 'Using your uploaded dataset' : 'No dataset uploaded yet'}
              </small>
            </div>
            <button
              className="ai-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div className="ai-messages">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role} ${m.error ? 'error' : ''}`}>
                {m.content}
              </div>
            ))}

            {showSuggestions && (
              <div className="ai-suggestions">
                {suggestions.map(s => (
                  <button key={s} onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div className="ai-msg assistant ai-typing" aria-label="Thinking">
                <span /><span /><span />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="ai-input-row">
            <input
              ref={inputRef}
              value={input}
              maxLength={1000}
              placeholder={
                datasetLoaded ? 'Ask about attendance…' : 'Ask how the dashboard works…'
              }
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
            />
            <button
              className="ai-send"
              onClick={() => send()}
              disabled={busy || input.trim().length < 2}
              aria-label="Send question"
            >
              ➤
            </button>
          </div>
        </section>
    )}

      <button
        className={`ai-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close Ask AI' : 'Open Ask AI'}
      >
        <span className="ai-fab-icon">{open ? '×' : '✦'}</span>
        {!open && <span className="ai-fab-label">Ask AI</span>}
      </button>
    </>
  )
  }