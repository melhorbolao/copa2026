'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useTransition, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { addStadiumPhoto, deleteStadiumPhoto } from './actions'
import type { MatchFull, AttendanceRow, PhotoRow, Participant } from './JogosDashboard'

interface Props {
  match: MatchFull
  matchAttendance: AttendanceRow[]
  matchPhotos: PhotoRow[]
  participants: Participant[]
  userId: string
  isAdmin: boolean
  userToParticipants: Record<string, string[]>
  activeParticipantId: string | null
  onAttendanceChange: (updated: AttendanceRow | null) => void
  onPhotoAdded: (p: PhotoRow) => void
  onPhotoDeleted: (id: string) => void
}

export function StadiumSection({
  match, matchAttendance, matchPhotos, participants, userId, isAdmin,
  userToParticipants, activeParticipantId, onPhotoAdded, onPhotoDeleted,
}: Props) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [caption,   setCaption]   = useState('')
  const [selectedPids, setSelectedPids] = useState<string[]>(() => {
    const my = userToParticipants[userId] ?? []
    return my
  })
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [deleting, startDelete]   = useTransition()
  const [uploadErr, setUploadErr] = useState('')
  // signed URLs are generated client-side (not during SSR)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const photosWithoutUrl = matchPhotos.filter(p => !p.url && !signedUrls[p.id])
    if (photosWithoutUrl.length === 0) return
    const supabase = createClient()
    Promise.all(
      photosWithoutUrl.map(async p => {
        try {
          const { data } = await supabase.storage.from('stadium-photos').createSignedUrl(p.storage_path, 3600)
          return { id: p.id, url: data?.signedUrl ?? null }
        } catch { return { id: p.id, url: null } }
      })
    ).then(results => {
      const map: Record<string, string> = {}
      for (const r of results) { if (r.url) map[r.id] = r.url }
      if (Object.keys(map).length > 0) setSignedUrls(prev => ({ ...prev, ...map }))
    })
  }, [matchPhotos]) // eslint-disable-line

  const participantMap = new Map(participants.map(p => [p.id, p]))

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadErr('')
    try {
      const supabase = createClient()
      const path = `${match.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('stadium-photos').upload(path, file)
      if (upErr) throw new Error(upErr.message)
      const res = await addStadiumPhoto(match.id, path, selectedPids, caption)
      if (res.error) throw new Error(res.error)
      // Get signed URL to display
      const { data: urlData } = await supabase.storage.from('stadium-photos').createSignedUrl(path, 3600)
      onPhotoAdded({
        id: Date.now().toString(), match_id: match.id, user_id: userId,
        storage_path: path, participant_ids: selectedPids, caption,
        created_at: new Date().toISOString(), url: urlData?.signedUrl ?? null,
      })
      setCaption('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Erro ao enviar foto')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = (id: string) => {
    setDeleteId(id)
    startDelete(async () => {
      const res = await deleteStadiumPhoto(id)
      if (!res.error) onPhotoDeleted(id)
      setDeleteId(null)
    })
  }

  if (matchAttendance.length === 0 && matchPhotos.length === 0) {
    return (
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/estou-aqui.png" alt="No Estádio" width={28} height={28} className="object-contain" />
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">No Estádio</h2>
        </div>
        <p className="text-sm text-gray-400 mb-3">Ninguém marcou presença ainda.</p>
        <UploadBlock
          fileRef={fileRef} uploading={uploading} uploadErr={uploadErr}
          caption={caption} setCaption={setCaption}
          selectedPids={selectedPids} setSelectedPids={setSelectedPids}
          participants={participants} onFile={handleFileChange}
        />
      </div>
    )
  }

  // Aggregate all present participant IDs
  const presentPids = new Set<string>()
  for (const a of matchAttendance) for (const pid of a.participant_ids ?? []) presentPids.add(pid)
  const presentNames = [...presentPids].map(id => participantMap.get(id)?.apelido).filter(Boolean)

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/estou-aqui.png" alt="No Estádio" width={24} height={24} className="object-contain" />
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">No Estádio · {presentNames.length} presentes</h2>
        </div>
        {presentNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presentNames.map(n => (
              <span key={n} className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 font-medium">{n}</span>
            ))}
          </div>
        )}
      </div>

      {/* Photo upload */}
      <div className="px-4 py-3 border-b border-gray-100">
        <UploadBlock
          fileRef={fileRef} uploading={uploading} uploadErr={uploadErr}
          caption={caption} setCaption={setCaption}
          selectedPids={selectedPids} setSelectedPids={setSelectedPids}
          participants={participants} onFile={handleFileChange}
        />
      </div>

      {/* Gallery */}
      {matchPhotos.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Fotos</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {matchPhotos.map(p => {
              const names = (p.participant_ids ?? []).map(id => participantMap.get(id)?.apelido).filter(Boolean)
              const canDelete = isAdmin || p.user_id === userId
              const photoUrl = p.url ?? signedUrls[p.id] ?? null
              return (
                <div key={p.id} className="relative group rounded-xl overflow-hidden bg-gray-100 aspect-square">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">Sem preview</div>
                  )}
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {names.length > 0 && (
                      <p className="text-[10px] text-white font-medium leading-tight">{names.join(', ')}</p>
                    )}
                    {p.caption && <p className="text-[9px] text-gray-300 mt-0.5">{p.caption}</p>}
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deleting && deleteId === p.id}
                        className="mt-1 self-start text-[9px] bg-red-600 text-white rounded px-1.5 py-0.5 hover:bg-red-500"
                      >
                        {deleting && deleteId === p.id ? '…' : 'Excluir'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function UploadBlock({ fileRef, uploading, uploadErr, caption, setCaption, selectedPids, setSelectedPids, participants, onFile }: {
  fileRef: React.RefObject<HTMLInputElement | null>
  uploading: boolean
  uploadErr: string
  caption: string
  setCaption: (v: string) => void
  selectedPids: string[]
  setSelectedPids: (v: string[]) => void
  participants: Participant[]
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Enviar foto do estádio</p>
      <input
        type="text"
        value={caption}
        onChange={e => setCaption(e.target.value)}
        placeholder="Legenda (opcional)"
        className="w-full text-sm rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:border-gray-400"
      />
      <div className="flex flex-wrap gap-1.5">
        {participants.map(p => (
          <label key={p.id} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedPids.includes(p.id)}
              onChange={e => setSelectedPids(e.target.checked ? [...selectedPids, p.id] : selectedPids.filter(id => id !== p.id))}
              className="accent-green-500 w-3 h-3"
            />
            <span className="text-[11px] text-gray-600">{p.apelido}</span>
          </label>
        ))}
      </div>
      <div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 text-white text-xs font-semibold px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40 transition"
        >
          {uploading ? '⏳ Enviando…' : '📷 Escolher foto'}
        </button>
        {uploadErr && <p className="text-[11px] text-red-500 mt-1">{uploadErr}</p>}
      </div>
    </div>
  )
}
