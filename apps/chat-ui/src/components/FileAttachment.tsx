import { useState, useEffect, useRef } from 'react'

interface FileChip {
  id: string
  name: string
  mimeType: string
  size: number
}

interface FileAttachmentProps {
  threadId: string | null
}

export default function FileAttachment({ threadId }: FileAttachmentProps) {
  const [files, setFiles] = useState<FileChip[]>([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!threadId) { setFiles([]); return }
    fetch(`/api/files?threadId=${encodeURIComponent(threadId)}`)
      .then((r) => r.json() as Promise<{ files: FileChip[] }>)
      .then((data) => setFiles(data.files))
      .catch(() => setFiles([]))
  }, [threadId])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !threadId) return

    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const commaIdx = dataUrl.indexOf(',')
      const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            content: base64,
            size: file.size,
          }),
        })
        if (res.ok) {
          const meta = await res.json() as FileChip
          setFiles((prev) => [...prev, meta])
        }
      } catch (err) {
        console.warn('[FileAttachment] Upload failed:', err)
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!threadId || uploading}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
        title="Attach file"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        {uploading ? '…' : ''}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      {files.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs border border-gray-700"
          title={`${f.name} (${(f.size / 1024).toFixed(1)} KB)`}
        >
          📎 {f.name}
        </span>
      ))}
    </div>
  )
}
