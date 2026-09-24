import { useEffect, useState } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type Status = { message: string; database: { visits: number; time: string } }

function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [uploads, setUploads] = useState<string[]>([])
  const [log, setLog] = useState('')

  const refresh = () => {
    fetch(`${API}/`).then((r) => r.json()).then(setStatus)
    fetch(`${API}/uploads`).then((r) => r.json()).then(setUploads)
  }

  useEffect(refresh, [])

  const sendMail = async () => {
    const res = await fetch(`${API}/mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'prof@eemi.com' }),
    })
    setLog(`Mail : ${JSON.stringify(await res.json())} — voir http://localhost:8025`)
  }

  const upload = async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`${API}/upload`, { method: 'POST', body })
    setLog(`Upload : ${JSON.stringify(await res.json())}`)
    refresh()
  }

  return (
    <main>
      <h1>TP1 Docker — sans compose</h1>

      <section>
        <h2>API + Postgres</h2>
        {status ? (
          <p>
            {status.message}
            <br />
            Visites en base : <b>{status.database.visits}</b>
            <br />
            Heure Postgres : {status.database.time}
          </p>
        ) : (
          <p>Chargement…</p>
        )}
        <button onClick={refresh}>Rafraîchir</button>
      </section>

      <section>
        <h2>Mailpit</h2>
        <button onClick={sendMail}>Envoyer un mail</button>
      </section>

      <section>
        <h2>Uploads</h2>
        <input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <ul>{uploads.map((f) => <li key={f}>{f}</li>)}</ul>
      </section>

      {log && <pre>{log}</pre>}
    </main>
  )
}

export default App
