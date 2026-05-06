export interface Source {
  id: string
  name: string
  title?: string
  type: 'pdf' | 'url'
  url?: string
  pages?: number
  chunks_count: number
  created_at: string
  sha256: string
  file_id?: string
}

export interface SourceRef {
  source_name: string
  source_type: string
  title?: string
  page?: number
  url?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
  isStreaming?: boolean
  error?: string
}
