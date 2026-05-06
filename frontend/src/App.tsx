import { useEffect, useState } from 'react'
import Chat from './components/Chat'
import Sidebar from './components/Sidebar'
import type { Message, Source } from './types'
import { getSources } from './api/client'

export default function App() {
  const [sources, setSources] = useState<Source[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  useEffect(() => {
    getSources()
      .then(setSources)
      .catch(console.error)
      .finally(() => setSourcesLoading(false))
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar
        sources={sources}
        setSources={setSources}
        loading={sourcesLoading}
      />
      <main className="flex-1 min-w-0">
        <Chat messages={messages} setMessages={setMessages} sources={sources} />
      </main>
    </div>
  )
}
