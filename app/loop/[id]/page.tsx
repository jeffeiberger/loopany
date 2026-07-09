'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  ContentRow,
  TagRow,
  CommentRow,
  MembershipRow,
  SessionFatigue,
  findStrongestRelated,
  findWeakRelated,
  findTemporalNeighbor,
  computeContentWeight,
} from '@/lib/weights'

type MetadataRow = { id?: string; content_id: string; key: string; value: string }
type MetadataDraft = { key: string; value: string }
type CommentFullRow = { id?: string; content_id: string; author_id: string; body: string; created_at?: string }
type Profile = { id: string; email: string | null; display_name: string | null }
type ContentFull = ContentRow & { storage_path: string; uploaded_by: string }

export default function LoopPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const loopId = params.id
  const fatigueRef = useRef(new SessionFatigue())

  const [userId, setUserId] = useState<string | null>(null)
  const [loopName, setLoopName] = useState('')
  const [content, setContent] = useState<ContentFull[]>([])
  const [tags, setTags] = useState<TagRow[]>([])
  const [metadata, setMetadata] = useState<MetadataRow[]>([])
  const [comments, setComments] = useState<CommentFullRow[]>([])
  const [memberships, setMemberships] = useState<MembershipRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [showOut, setShowOut] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [newTagValue, setNewTagValue] = useState('')
  const [newTagType, setNewTagType] = useState('person')
  const [newComment, setNewComment] = useState('')

  // Upload modal state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  const [uploadCaption, setUploadCaption] = useState('')
  const [uploadTakenAt, setUploadTakenAt] = useState('')
  const [uploadLocation, setUploadLocation] = useState('')
  const [uploadMomentKey, setUploadMomentKey] = useState('')
  const [customFields, setCustomFields] = useState<MetadataDraft[]>([{ key: '', value: '' }])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Edit modal state
  const [editCaption, setEditCaption] = useState('')
  const [editTakenAt, setEditTakenAt] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editMomentKey, setEditMomentKey] = useState('')
  const [editNewTagType, setEditNewTagType] = useState('person')
  const [editNewTagValue, setEditNewTagValue] = useState('')
  const [editNewMetaKey, setEditNewMetaKey] = useState('')
  const [editNewMetaValue, setEditNewMetaValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user
      setUserId(user?.id ?? null)
      if (user) {
        await supabase.from('profiles').upsert(
          { id: user.id, email: user.email, display_name: user.email },
          { onConflict: 'id' }
        )
      }
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    loadAll()
  }, [userId, loopId])

  // Clean up the local preview URL when it changes or the modal closes
  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl)
    }
  }, [uploadPreviewUrl])

  async function loadAll() {
    const { data: loop } = await supabase.from('loops').select('name').eq('id', loopId).single()
    if (loop) setLoopName(loop.name)

    const { data: contentRows } = await supabase
      .from('content')
      .select('id, taken_at, uploaded_at, moment_key, caption, storage_path, uploaded_by')
      .eq('loop_id', loopId)
      .order('uploaded_at', { ascending: false })
    setContent((contentRows as ContentFull[]) ?? [])
    if (contentRows && contentRows.length > 0 && !currentId) {
      setCurrentId(contentRows[0].id)
    }

    const contentIds = (contentRows ?? []).map((c) => c.id)
    if (contentIds.length > 0) {
      const { data: tagRows } = await supabase
        .from('tags')
        .select('content_id, tag_type, value, tagged_by')
        .in('content_id', contentIds)
      setTags(tagRows ?? [])

      const { data: metadataRows } = await supabase
        .from('content_metadata')
        .select('id, content_id, key, value')
        .in('content_id', contentIds)
      setMetadata(metadataRows ?? [])

      const { data: commentRows } = await supabase
        .from('comments')
        .select('id, content_id, author_id, body, created_at')
        .in('content_id', contentIds)
        .order('created_at', { ascending: true })
      setComments(commentRows ?? [])
    }

    const { data: memberRows } = await supabase
      .from('loop_memberships')
      .select('user_id, generation')
      .eq('loop_id', loopId)
    setMemberships(memberRows ?? [])

    const memberIds = (memberRows ?? []).map((m) => m.user_id)
    if (memberIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', memberIds)
      const map: Record<string, Profile> = {}
      for (const p of profileRows ?? []) map[p.id] = p
      setProfiles(map)
    }
  }

  function nameFor(id: string): string {
    const p = profiles[id]
    if (!p) return 'a loop member'
    return p.display_name || p.email || 'a loop member'
  }

  const current = useMemo(() => content.find((c) => c.id === currentId) ?? null, [content, currentId])
  const currentTags = useMemo(() => tags.filter((t) => t.content_id === currentId), [tags, currentId])
  const currentMetadata = useMemo(() => metadata.filter((m) => m.content_id === currentId), [metadata, currentId])
  const currentComments = useMemo(
    () => comments.filter((c) => c.content_id === currentId),
    [comments, currentId]
  )

  const currentImageUrl = useMemo(() => {
    if (!current?.storage_path) return null
    return supabase.storage.from('content').getPublicUrl(current.storage_path).data.publicUrl
  }, [current])

  const currentWeight = useMemo(() => {
    if (!currentId) return 0
    const clusterSize =
      content.filter((c) => c.moment_key && c.moment_key === current?.moment_key).length || 1
    return computeContentWeight(currentId, tags, comments, memberships, clusterSize)
  }, [currentId, tags, comments, memberships, content, current])

  // Distinct previously-used tag values for the currently selected tag type —
  // powers the suggestion dropdown (item 6).
  function suggestionsFor(tagType: string): string[] {
    const seen = new Set<string>()
    for (const t of tags) {
      if (t.tag_type === tagType) seen.add(t.value)
    }
    return Array.from(seen).sort()
  }

  function goTo(target: ContentRow | null) {
    if (!target || !currentId) return
    fatigueRef.current.markViewed(currentId)
    setHistory((h) => [...h, currentId])
    setCurrentId(target.id)
  }

  function jumpBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setCurrentId(prev)
  }

  function goRandom() {
    if (content.length === 0) return
    const pool = content.filter((c) => c.id !== currentId)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    goTo(pick)
  }

  async function addTag() {
    if (!newTagValue.trim() || !currentId || !userId) return
    const { error } = await supabase.from('tags').insert({
      content_id: currentId,
      tag_type: newTagType,
      value: newTagValue,
      tagged_by: userId,
    })
    if (!error) {
      setNewTagValue('')
      loadAll()
    }
  }

  async function addComment() {
    if (!newComment.trim() || !currentId || !userId) return
    const { error } = await supabase.from('comments').insert({
      content_id: currentId,
      author_id: userId,
      body: newComment,
    })
    if (!error) {
      setNewComment('')
      loadAll()
    }
  }

  // ---------- Upload modal ----------

  function updateCustomField(index: number, field: 'key' | 'value', value: string) {
    setCustomFields((rows) => {
      const next = [...rows]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  function addCustomFieldRow() {
    setCustomFields((rows) => [...rows, { key: '', value: '' }])
  }

  function removeCustomFieldRow(index: number) {
    setCustomFields((rows) => rows.filter((_, i) => i !== index))
  }

  function handleFileSelect(file: File | null) {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl)
    setUploadFile(file)
    setUploadPreviewUrl(file ? URL.createObjectURL(file) : null)

    // Best-effort fallback: default "taken at" to the file's last-modified
    // time if nothing is set yet. Real EXIF date extraction would need a
    // small library — worth a follow-up if this isn't accurate enough.
    if (file && !uploadTakenAt && file.lastModified) {
      const d = new Date(file.lastModified)
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      setUploadTakenAt(local.toISOString().slice(0, 16))
    }
  }

  function resetUploadForm() {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl)
    setUploadFile(null)
    setUploadPreviewUrl(null)
    setUploadCaption('')
    setUploadTakenAt('')
    setUploadLocation('')
    setUploadMomentKey('')
    setCustomFields([{ key: '', value: '' }])
    setUploadError('')
  }

  async function handleUpload() {
    if (!uploadFile || !userId) {
      setUploadError('Choose a file first.')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const ext = uploadFile.name.split('.').pop()
      const path = `${loopId}/${crypto.randomUUID()}.${ext}`
      const { error: storageError } = await supabase.storage.from('content').upload(path, uploadFile)
      if (storageError) throw storageError

      const { data: contentRow, error: contentError } = await supabase
        .from('content')
        .insert({
          loop_id: loopId,
          uploaded_by: userId,
          storage_path: path,
          media_type: uploadFile.type.startsWith('video')
            ? 'video'
            : uploadFile.type.startsWith('audio')
            ? 'audio'
            : 'photo',
          caption: uploadCaption || null,
          taken_at: uploadTakenAt ? new Date(uploadTakenAt).toISOString() : null,
          location: uploadLocation || null,
          moment_key: uploadMomentKey || null,
        })
        .select()
        .single()
      if (contentError) throw contentError

      const validFields = customFields.filter((f) => f.key.trim() && f.value.trim())
      if (validFields.length > 0) {
        const { error: metaError } = await supabase.from('content_metadata').insert(
          validFields.map((f) => ({
            content_id: contentRow.id,
            key: f.key.trim(),
            value: f.value.trim(),
            added_by: userId,
          }))
        )
        if (metaError) throw metaError
      }

      resetUploadForm()
      setShowUpload(false)
      setCurrentId(contentRow.id)
      loadAll()
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  // ---------- Edit modal ----------

  function openEdit() {
    if (!current) return
    setEditCaption(current.caption || '')
    setEditTakenAt(current.taken_at ? new Date(current.taken_at).toISOString().slice(0, 16) : '')
    setEditLocation((current as any).location || '')
    setEditMomentKey(current.moment_key || '')
    setEditNewTagType('person')
    setEditNewTagValue('')
    setEditNewMetaKey('')
    setEditNewMetaValue('')
    setEditError('')
    setShowEdit(true)
  }

  async function saveEdit() {
    if (!current) return
    setEditSaving(true)
    setEditError('')
    const { error } = await supabase
      .from('content')
      .update({
        caption: editCaption || null,
        taken_at: editTakenAt ? new Date(editTakenAt).toISOString() : null,
        location: editLocation || null,
        moment_key: editMomentKey || null,
      })
      .eq('id', current.id)
    setEditSaving(false)
    if (error) {
      setEditError(error.message)
      return
    }
    loadAll()
  }

  async function deleteTag(tagContentId: string, tagValue: string, tagType: string, taggedBy: string) {
    await supabase
      .from('tags')
      .delete()
      .match({ content_id: tagContentId, value: tagValue, tag_type: tagType, tagged_by: taggedBy })
    loadAll()
  }

  async function addEditTag() {
    if (!editNewTagValue.trim() || !current || !userId) return
    await supabase.from('tags').insert({
      content_id: current.id,
      tag_type: editNewTagType,
      value: editNewTagValue,
      tagged_by: userId,
    })
    setEditNewTagValue('')
    loadAll()
  }

  async function deleteMetadata(metaId: string | undefined) {
    if (!metaId) return
    await supabase.from('content_metadata').delete().eq('id', metaId)
    loadAll()
  }

  async function addEditMetadata() {
    if (!editNewMetaKey.trim() || !editNewMetaValue.trim() || !current || !userId) return
    await supabase.from('content_metadata').insert({
      content_id: current.id,
      key: editNewMetaKey.trim(),
      value: editNewMetaValue.trim(),
      added_by: userId,
    })
    setEditNewMetaKey('')
    setEditNewMetaValue('')
    loadAll()
  }

  // ---------- Render ----------

  const uploadModal = showUpload && (
    <div className="modal-backdrop" onClick={() => { setShowUpload(false); resetUploadForm() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>Upload content</strong>
          <button className="modal-close" onClick={() => { setShowUpload(false); resetUploadForm() }}>✕</button>
        </div>

        <div className="modal-body">
          <input
            className="field"
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />

          {uploadPreviewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadPreviewUrl} alt="preview" className="upload-preview" />
          )}

          <input className="field" placeholder="Caption" value={uploadCaption} onChange={(e) => setUploadCaption(e.target.value)} />

          <input className="field" type="datetime-local" value={uploadTakenAt} onChange={(e) => setUploadTakenAt(e.target.value)} />
          <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>When the moment happened</p>

          <input className="field" placeholder="Location" value={uploadLocation} onChange={(e) => setUploadLocation(e.target.value)} />

          <input
            className="field"
            placeholder="Moment key (optional — same value on photos from the exact same instant)"
            value={uploadMomentKey}
            onChange={(e) => setUploadMomentKey(e.target.value)}
          />

          <p style={{ marginTop: 16, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Your own metadata</p>
          <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>Add any key/value pairs you want.</p>
          {customFields.map((field, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input className="field" style={{ marginBottom: 0 }} placeholder="key" value={field.key} onChange={(e) => updateCustomField(i, 'key', e.target.value)} />
              <input className="field" style={{ marginBottom: 0 }} placeholder="value" value={field.value} onChange={(e) => updateCustomField(i, 'value', e.target.value)} />
              <button className="btn-ghost" type="button" onClick={() => removeCustomFieldRow(i)} disabled={customFields.length === 1}>✕</button>
            </div>
          ))}
          <button className="btn-ghost" type="button" onClick={addCustomFieldRow}>+ Add another field</button>

          {uploadError && <p style={{ color: '#B4342A', marginTop: 10 }}>{uploadError}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={handleUpload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
          <button className="btn-ghost" onClick={() => { setShowUpload(false); resetUploadForm() }}>Cancel</button>
        </div>
      </div>
    </div>
  )

  const editModal = showEdit && current && (
    <div className="modal-backdrop" onClick={() => setShowEdit(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>Edit content</strong>
          <button className="modal-close" onClick={() => setShowEdit(false)}>✕</button>
        </div>

        <div className="modal-body">
          <input className="field" placeholder="Caption" value={editCaption} onChange={(e) => setEditCaption(e.target.value)} />
          <input className="field" type="datetime-local" value={editTakenAt} onChange={(e) => setEditTakenAt(e.target.value)} />
          <input className="field" placeholder="Location" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
          <input className="field" placeholder="Moment key" value={editMomentKey} onChange={(e) => setEditMomentKey(e.target.value)} />

          {editError && <p style={{ color: '#B4342A' }}>{editError}</p>}

          <div style={{ display: 'flex', gap: 10, margin: '6px 0 20px' }}>
            <button className="btn" onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save changes'}</button>
          </div>

          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Tags</p>
          <div style={{ marginBottom: 10 }}>
            {currentTags.length === 0 && <p className="muted">No tags yet.</p>}
            {currentTags.map((t, i) => (
              <span key={i} className="tag-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {t.tag_type}: {t.value}
                {(t.tagged_by === userId || current.uploaded_by === userId) && (
                  <span
                    style={{ cursor: 'pointer', fontWeight: 700 }}
                    onClick={() => deleteTag(t.content_id, t.value, t.tag_type, t.tagged_by)}
                  >
                    ✕
                  </span>
                )}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <select className="field" style={{ flex: '0 0 120px', marginBottom: 0 }} value={editNewTagType} onChange={(e) => setEditNewTagType(e.target.value)}>
              <option value="person">Person</option>
              <option value="place">Place</option>
              <option value="event">Event</option>
              <option value="thing">Thing</option>
              <option value="interest">Interest</option>
            </select>
            <input
              className="field"
              style={{ marginBottom: 0 }}
              placeholder="value"
              list="edit-tag-suggestions"
              value={editNewTagValue}
              onChange={(e) => setEditNewTagValue(e.target.value)}
            />
            <datalist id="edit-tag-suggestions">
              {suggestionsFor(editNewTagType).map((v) => <option key={v} value={v} />)}
            </datalist>
            <button className="btn-ghost" onClick={addEditTag}>Add</button>
          </div>

          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Your own metadata</p>
          <div style={{ marginBottom: 10 }}>
            {currentMetadata.length === 0 && <p className="muted">No custom fields yet.</p>}
            {currentMetadata.map((m, i) => (
              <span key={i} className="tag-chip" style={{ background: '#FBEAF0', color: '#72243E', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {m.key}: {m.value}
                <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => deleteMetadata(m.id)}>✕</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="field" style={{ marginBottom: 0 }} placeholder="key" value={editNewMetaKey} onChange={(e) => setEditNewMetaKey(e.target.value)} />
            <input className="field" style={{ marginBottom: 0 }} placeholder="value" value={editNewMetaValue} onChange={(e) => setEditNewMetaValue(e.target.value)} />
            <button className="btn-ghost" onClick={addEditMetadata}>Add</button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={() => setShowEdit(false)}>Close</button>
        </div>
      </div>
    </div>
  )

  if (!current) {
    return (
      <div className="page">
        <div className="brand"><span className="brand-ring" />{loopName || 'Loopany'}</div>
        <p className="muted">No content yet in this loop.</p>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setShowUpload(true)}>Upload something</button>
        {uploadModal}
      </div>
    )
  }

  const left = findTemporalNeighbor(current.id, content, -1)
  const right = findTemporalNeighbor(current.id, content, 1)
  const down = findStrongestRelated(current.id, content, tags, memberships, fatigueRef.current)
  const up = findWeakRelated(current.id, content, tags, memberships, fatigueRef.current)

  return (
    <div className="page">
      <div className="brand"><span className="brand-ring" />{loopName}</div>

      <div className="content-frame">
        <div className="stage">
          {currentImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="content-media" src={currentImageUrl} alt={current.caption || 'content'} />
          ) : (
            <div className="content-media" />
          )}

          <button className="edge-btn edge-top" disabled={!up} onClick={() => goTo(up)} title="Up — weak thread">↑</button>
          <button className="edge-btn edge-bottom" disabled={!down} onClick={() => goTo(down)} title="Down — strongest thread">↓</button>
          <button className="edge-btn edge-left" disabled={!left} onClick={() => goTo(left)} title="Left — earlier">←</button>
          <button className="edge-btn edge-right" disabled={!right} onClick={() => goTo(right)} title="Right — later">→</button>
        </div>

        <div className="content-meta">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{current.caption || 'Untitled moment'}</p>
              <p className="muted" style={{ margin: '0 0 4px' }}>
                {current.taken_at ? new Date(current.taken_at).toLocaleString() : 'No date recorded'}
                {' · weight '}{currentWeight.toFixed(2)}
              </p>
              <p className="muted" style={{ margin: '0 0 10px' }}>Added by {nameFor(current.uploaded_by)}</p>
            </div>
            {current.uploaded_by === userId && (
              <button className="btn-ghost" onClick={openEdit}>Edit</button>
            )}
          </div>
          {currentTags.map((t, i) => <span key={`tag-${i}`} className="tag-chip">{t.tag_type}: {t.value}</span>)}
          {currentMetadata.map((m, i) => (
            <span key={`meta-${i}`} className="tag-chip" style={{ background: '#FBEAF0', color: '#72243E' }}>{m.key}: {m.value}</span>
          ))}
        </div>
      </div>

      <div className="nav-grid nav-grid-secondary">
        <button className="nav-btn" onClick={jumpBack} disabled={history.length === 0}>⟲ Jump-Back</button>
        <button className="nav-btn" onClick={goRandom}>⚄ Random</button>
        <button className="nav-btn" onClick={() => setShowOut(true)}>⤢ Out (map)</button>
      </div>

      <button className="btn" style={{ marginTop: 16 }} onClick={() => setShowUpload(true)}>+ Upload content</button>

      {showOut && (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>All content in this loop</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {content.map((c) => (
              <button key={c.id} className="btn-ghost" style={{ borderColor: c.id === current.id ? 'var(--c-teal-deep)' : undefined }} onClick={() => { setCurrentId(c.id); setShowOut(false) }}>
                {c.caption || c.id.slice(0, 6)}
              </button>
            ))}
          </div>
          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setShowOut(false)}>Close map</button>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <strong>Add a tag</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select className="field" style={{ flex: '0 0 120px' }} value={newTagType} onChange={(e) => setNewTagType(e.target.value)}>
            <option value="person">Person</option>
            <option value="place">Place</option>
            <option value="event">Event</option>
            <option value="thing">Thing</option>
            <option value="interest">Interest</option>
          </select>
          <input
            className="field"
            placeholder="value"
            list="add-tag-suggestions"
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
          />
          <datalist id="add-tag-suggestions">
            {suggestionsFor(newTagType).map((v) => <option key={v} value={v} />)}
          </datalist>
          <button className="btn" onClick={addTag}>Add</button>
        </div>
      </div>

      <div className="card">
        <strong>Comments</strong>
        <ul style={{ paddingLeft: 0, listStyle: 'none', margin: '10px 0' }}>
          {currentComments.length === 0 && <p className="muted">No comments yet.</p>}
          {currentComments.map((c, i) => (
            <li key={i} style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>{nameFor(c.author_id)}</strong>
              <p style={{ margin: '2px 0 0' }}>{c.body}</p>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input className="field" placeholder="Add a comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
          <button className="btn" onClick={addComment}>Post</button>
        </div>
      </div>

      {uploadModal}
      {editModal}
    </div>
  )
}
