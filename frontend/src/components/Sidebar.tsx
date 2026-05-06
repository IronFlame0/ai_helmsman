import { useCallback, useRef, useState } from 'react'
import { deleteSource, getSources, uploadPDF, uploadURL } from '../api/client'
import type { Source } from '../types'

interface Props {
  sources: Source[]
  setSources: React.Dispatch<React.SetStateAction<Source[]>>
  loading: boolean
}

function SourceIcon({ type, url }: { type: Source['type']; url?: string }) {
  if (type === 'pdf') {
    return (
      <span className="flex-shrink-0 w-7 h-7 rounded bg-red-900/50 text-red-400 flex items-center justify-center text-xs font-bold">
        PDF
      </span>
    )
  }
  if (url) {
    const domain = new URL(url).hostname
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        alt=""
        className="flex-shrink-0 w-7 h-7 rounded bg-gray-700 object-contain p-0.5"
      />
    )
  }
  return (
    <span className="flex-shrink-0 w-7 h-7 rounded bg-blue-900/50 text-blue-400 flex items-center justify-center text-xs font-bold">
      URL
    </span>
  )
}

export default function Sidebar({ sources, setSources, loading }: Props) {
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [uploadingUrl, setUploadingUrl] = useState(false)
  const [uploadingPDF, setUploadingPDF] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const updated = await getSources()
    setSources(updated)
  }, [setSources])

  async function handlePDFUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Only PDF files are supported.')
      return
    }
    setUploadingPDF(true)
    setPdfError('')
    try {
      await uploadPDF(file)
      await refresh()
    } catch (e: unknown) {
      setPdfError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploadingPDF(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handlePDFUpload(file)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handlePDFUpload(file)
  }

  async function handleURLSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setUploadingUrl(true)
    setUrlError('')
    try {
      await uploadURL(url.trim())
      await refresh()
      setUrl('')
    } catch (e: unknown) {
      setUrlError(e instanceof Error ? e.message : 'Failed to index URL.')
    } finally {
      setUploadingUrl(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await deleteSource(id)
      setSources((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <aside className="w-72 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold tracking-tight text-white">
          ⚓ AI Helmsman
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">RAG chat with your docs</p>
      </div>

      {/* Upload PDF */}
      <div className="px-4 pt-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Upload PDF
        </p>
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-gray-700 hover:border-gray-500'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={onFileChange}
          />
          {uploadingPDF ? (
            <span className="text-sm text-indigo-400 animate-pulse">Processing…</span>
          ) : (
            <>
              <p className="text-sm text-gray-400">Drop PDF here</p>
              <p className="text-xs text-gray-600 mt-1">or click to browse</p>
            </>
          )}
        </div>
        {pdfError && (
          <p className="text-xs text-red-400 mt-1">{pdfError}</p>
        )}
      </div>

      {/* Upload URL */}
      <div className="px-4 pt-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Add URL
        </p>
        <form onSubmit={handleURLSubmit} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            disabled={uploadingUrl}
          />
          <button
            type="submit"
            disabled={uploadingUrl || !url.trim()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
          >
            {uploadingUrl ? '…' : 'Add'}
          </button>
        </form>
        {urlError && (
          <p className="text-xs text-red-400 mt-1">{urlError}</p>
        )}
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Sources ({sources.length})
        </p>

        {loading ? (
          <p className="text-xs text-gray-600 animate-pulse">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="text-xs text-gray-600">No sources yet. Upload a PDF or add a URL above.</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((src) => (
              <li
                key={src.id}
                className="flex items-start gap-2 bg-gray-800 rounded-lg px-3 py-2 group"
              >
                <SourceIcon type={src.type} url={src.url} />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm text-gray-200 truncate"
                    title={src.url ?? src.name}
                  >
                    {src.title || src.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {src.chunks_count} chunks
                    {src.pages ? ` · ${src.pages} pages` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(src.id)}
                  disabled={deletingId === src.id}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all disabled:opacity-30 mt-0.5"
                  title="Remove source"
                >
                  {deletingId === src.id ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
