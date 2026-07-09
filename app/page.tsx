'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

type Loop = {
  id: string
  name: string
  mission: string | null
  visibility: string
}

export default function HomePage() {
  const supabase = createClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [loops, setLoops] = useState<Loop[]>([])
  const [newLoopName, setNewLoopName] = useState('')
  const [newLoopMission, setNewLoopMission] = useState('')

  async function ensureProfile(id: string, email: string | null | undefined) {
    await supabase.from('profiles').upsert(
      { id, email: email ?? null, display_name: email ?? null },
      { onConflict: 'id' }
    )
  }

  useEffect(() => {
    // If we've just arrived from a magic-link email, Supabase's PKCE flow
    // puts a one-time `code` in the URL that must be exchanged for a real
    // session — it isn't done automatically.
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error) {
          setAuthMessage(error.message)
          return
        }
        setUserId(data.session?.user?.id ?? null)
        if (data.session?.user) ensureProfile(data.session.user.id, data.session.user.email)
        // Clean the code out of the URL so a refresh doesn't try to reuse it.
        window.history.replaceState({}, '', url.pathname)
      })
    } else {
      supabase.auth.getUser().then(({ data }) => {
        setUserId(data.user?.id ?? null)
        if (data.user) ensureProfile(data.user.id, data.user.email)
      })
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    loadLoops()
  }, [userId])

  async function loadLoops() {
    const { data } = await supabase
      .from('loop_memberships')
      .select('loops(id, name, mission, visibility)')
      .eq('user_id', userId)
    const rows = (data ?? []).map((r: any) => r.loops).filter(Boolean)
    setLoops(rows)
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithOtp({ email })
    setAuthMessage(error ? error.message : 'Check your email for a magic link.')
  }

  async function createLoop() {
    if (!newLoopName.trim() || !userId) return
    const { data, error } = await supabase
      .from('loops')
      .insert({ name: newLoopName, mission: newLoopMission, created_by: userId })
      .select()
      .single()
    if (error) {
      alert(error.message)
      return
    }
    await supabase.from('loop_memberships').insert({
      loop_id: data.id,
      user_id: userId,
      generation: 0,
    })
    setNewLoopName('')
    setNewLoopMission('')
    loadLoops()
  }

  if (!userId) {
    return (
      <div className="page">
        <div className="brand"><span className="brand-ring" />Loopany</div>
        <p className="muted">You&apos;re in good company. Sign in to see your loops.</p>
        <div className="card">
          <input
            className="field"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn" onClick={signIn}>Send magic link</button>
          {authMessage && <p className="muted" style={{ marginTop: 10 }}>{authMessage}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="brand"><span className="brand-ring" />Loopany</div>

      <div className="card">
        <strong>Start a new Loop</strong>
        <div style={{ marginTop: 12 }}>
          <input
            className="field"
            placeholder="Loop name (e.g. Dick & Hope Johnson)"
            value={newLoopName}
            onChange={(e) => setNewLoopName(e.target.value)}
          />
          <textarea
            className="field"
            placeholder="Mission — who this is for and what it's for"
            rows={2}
            value={newLoopMission}
            onChange={(e) => setNewLoopMission(e.target.value)}
          />
          <button className="btn" onClick={createLoop}>Create Loop</button>
        </div>
      </div>

      <h3 style={{ marginTop: 28 }}>Your Loops</h3>
      {loops.length === 0 && <p className="muted">No loops yet — create one above.</p>}
      {loops.map((loop) => (
        <Link key={loop.id} href={`/loop/${loop.id}`} style={{ textDecoration: 'none' }}>
          <div className="card">
            <strong>{loop.name}</strong>
            {loop.mission && <p className="muted" style={{ marginTop: 6 }}>{loop.mission}</p>}
          </div>
        </Link>
      ))}
    </div>
  )
}
