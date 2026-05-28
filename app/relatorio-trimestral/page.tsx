'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '../../lib/supabase/client'
import {
  Upload, FileText, CheckCircle2, AlertCircle, Loader2,
  BarChart3, Users, Check, X, ChevronRight,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Report = {
  id: string; year: number; quarter: number
  stake_name: string; stake_id: string
  status: 'extracted' | 'confirmed'; uploaded_at: string
}
type Indicator = {
  id: string; ward_name: string
  indicator_number: number; indicator_name: string
  value: number | null; stake_real: number | null; stake_potential: number | null
}
type Convert = {
  id: string; ward_name: string; name: string
  gender: 'M' | 'F' | null; age: number | null; priesthood: string | null
  attended_sacrament: boolean | null; has_calling: boolean | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { label: 'Conversão e Crescimento', from: 1, to: 9 },
  { label: 'Membros / Famílias',       from: 10, to: 13 },
  { label: 'Adultos',                  from: 14, to: 17 },
  { label: 'Jovens',                   from: 18, to: 20 },
  { label: 'Crianças',                 from: 21, to: 22 },
  { label: 'Conversos (últ. 12m)',     from: 23, to: 26 },
]

const QUARTER_LABEL: Record<number, string> = {
  1: 'Jan – Mar', 2: 'Abr – Jun', 3: 'Jul – Set', 4: 'Out – Dez',
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RelatorioTrimestralPage() {
  const supabase = useMemo(() => createClient(), [])

  const [reports, setReports]           = useState<Report[]>([])
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [indicators, setIndicators]     = useState<Indicator[]>([])
  const [converts, setConverts]         = useState<Convert[]>([])
  const [tab, setTab]                   = useState<'indicators' | 'converts'>('indicators')
  const [selectedWard, setSelectedWard] = useState('')
  const [loading, setLoading]           = useState(true)
  const [uploading, setUploading]       = useState(false)
  const [confirming, setConfirming]     = useState(false)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [toast, setToast]               = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (type: 'ok' | 'error', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4500)
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  const openReport = useCallback(async (r: Report) => {
    setActiveReport(r)
    setTab('indicators')
    setEditingId(null)
    const [{ data: inds }, { data: convs }] = await Promise.all([
      supabase.from('quarterly_report_indicators')
        .select('*').eq('report_id', r.id).order('indicator_number'),
      supabase.from('quarterly_report_converts')
        .select('*').eq('report_id', r.id).order('ward_name').order('name'),
    ])
    const rows = (inds ?? []) as Indicator[]
    const cvs  = (convs ?? []) as Convert[]
    setIndicators(rows)
    setConverts(cvs)
    const firstWard = [...new Set(cvs.map(c => c.ward_name))].sort()[0] ?? ''
    setSelectedWard(firstWard)
  }, [supabase])

  const loadReports = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('quarterly_reports')
      .select('*')
      .order('year', { ascending: false })
      .order('quarter', { ascending: false })
    const rows = (data ?? []) as Report[]
    setReports(rows)
    const pending = rows.find(r => r.status === 'extracted')
    if (pending) await openReport(pending)
    else setActiveReport(null)
    setLoading(false)
  }, [supabase, openReport])

  useEffect(() => { loadReports() }, [loadReports])

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('pdf', file)
      const res  = await fetch('/api/relatorio-trimestral/extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { showToast('error', data.error || 'Erro ao processar PDF.'); return }
      showToast('ok', `T${data.quarter} ${data.year} extraído — ${data.convertsCount} conversos, ${data.indicatorsCount} valores.`)
      await loadReports()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setUploading(false)
    }
  }

  // ── Inline editing ────────────────────────────────────────────────────────

  const saveIndicator = async (id: string, raw: string, field: 'value' | 'stake_real' | 'stake_potential') => {
    const num = raw === '' ? null : parseInt(raw, 10)
    if (raw !== '' && isNaN(num!)) { setEditingId(null); return }
    await supabase.from('quarterly_report_indicators').update({ [field]: num }).eq('id', id)
    setIndicators(prev => prev.map(i => i.id === id ? { ...i, [field]: num } : i))
    setEditingId(null)
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!activeReport) return
    setConfirming(true)
    const { error } = await supabase
      .from('quarterly_reports').update({ status: 'confirmed' }).eq('id', activeReport.id)
    setConfirming(false)
    if (error) { showToast('error', error.message); return }
    showToast('ok', 'Relatório confirmado e salvo.')
    await loadReports()
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const wardNames = useMemo(() =>
    [...new Set(indicators.filter(i => i.ward_name !== '__stake__').map(i => i.ward_name))].sort()
  , [indicators])

  const indMap = useMemo(() => {
    const map = new Map<number, Map<string, Indicator>>()
    for (const ind of indicators) {
      if (!map.has(ind.indicator_number)) map.set(ind.indicator_number, new Map())
      map.get(ind.indicator_number)!.set(ind.ward_name, ind)
    }
    return map
  }, [indicators])

  const indNumbers = useMemo(() =>
    [...new Set(indicators.map(i => i.indicator_number))].sort((a, b) => a - b)
  , [indicators])

  const allConvertWards = useMemo(() =>
    [...new Set(converts.map(c => c.ward_name))].sort()
  , [converts])

  const wardConverts = useMemo(() =>
    converts.filter(c => c.ward_name === selectedWard)
  , [converts, selectedWard])

  const isConfirmed = activeReport?.status === 'confirmed'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium max-w-sm ${
          toast.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {toast.type === 'ok' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#0e4f66] flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-sky-600" />
            Relatório Trimestral
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Importe o PDF oficial e a IA extrai os dados automaticamente.
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl shadow-sm transition-colors disabled:opacity-60"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploading ? 'Processando PDF...' : 'Importar PDF'}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
        </div>
      )}

      {/* ── Review / View Panel ── */}
      {!loading && activeReport && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">

          {/* Panel header */}
          <div className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b ${
            isConfirmed ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
          }`}>
            <div className="flex items-center gap-2">
              {isConfirmed
                ? <CheckCircle2 size={18} className="text-emerald-600" />
                : <AlertCircle   size={18} className="text-amber-600"   />}
              <div>
                <span className={`font-bold ${isConfirmed ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {isConfirmed ? 'Confirmado' : 'Aguardando Confirmação'}
                </span>
                <p className={`text-sm mt-0.5 ${isConfirmed ? 'text-emerald-700' : 'text-amber-700'}`}>
                  T{activeReport.quarter} {activeReport.year} — {QUARTER_LABEL[activeReport.quarter]} — {activeReport.stake_name}
                </p>
              </div>
            </div>
            {!isConfirmed && (
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm disabled:opacity-60 flex-shrink-0"
              >
                {confirming ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {confirming ? 'Salvando...' : 'Confirmar Relatório'}
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {[
              { key: 'indicators', label: 'Indicadores', icon: BarChart3, count: indNumbers.length },
              { key: 'converts',   label: 'Conversos',   icon: Users,     count: converts.length },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as any)}
                className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                  tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <t.icon size={15} />
                {t.label}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                  tab === t.key ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'
                }`}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* ── Indicators Table ── */}
          {tab === 'indicators' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                    <th className="text-left px-4 py-2 font-semibold sticky left-0 bg-gray-50 z-10 min-w-[220px]">Indicador</th>
                    {wardNames.map(w => (
                      <th key={w} className="text-center px-2 py-2 font-semibold min-w-[65px]" title={w}>
                        {w.split(' ')[0]}
                      </th>
                    ))}
                    <th className="text-center px-2 py-2 font-semibold min-w-[65px] bg-sky-50/60 text-sky-700">Total</th>
                    <th className="text-center px-2 py-2 font-semibold min-w-[75px] bg-emerald-50/60 text-emerald-700">Potencial</th>
                    <th className="text-center px-2 py-2 font-semibold min-w-[50px] bg-violet-50/60 text-violet-700">%</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map(cat => {
                    const catNums = indNumbers.filter(n => n >= cat.from && n <= cat.to)
                    if (catNums.length === 0) return null
                    return (
                      <>
                        <tr key={`cat-${cat.label}`}>
                          <td colSpan={wardNames.length + 4}
                            className="px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50/80 sticky left-0">
                            {cat.label}
                          </td>
                        </tr>
                        {catNums.map(num => {
                          const wardData  = indMap.get(num)
                          if (!wardData) return null
                          const stakeRow  = wardData.get('__stake__')
                          const firstName = wardData.values().next().value
                          const indName   = firstName?.indicator_name ?? `Indicador ${num}`
                          const pct = stakeRow?.stake_real != null && stakeRow?.stake_potential
                            ? Math.round((stakeRow.stake_real / stakeRow.stake_potential) * 100)
                            : null

                          return (
                            <tr key={num} className="border-t border-gray-50 hover:bg-gray-50/40">
                              {/* Indicator name */}
                              <td className="px-4 py-2 text-gray-700 sticky left-0 bg-white hover:bg-gray-50/40 max-w-[220px]">
                                <span className="text-gray-400 mr-1 tabular-nums">{num}.</span>
                                <span className="line-clamp-2 leading-snug" title={indName}>{indName}</span>
                              </td>

                              {/* Ward values */}
                              {wardNames.map(wn => {
                                const row = wardData.get(wn)
                                const eid = `ind-${row?.id}`
                                return (
                                  <td key={wn} className="text-center px-1 py-1">
                                    {row ? (
                                      editingId === eid && !isConfirmed ? (
                                        <input
                                          autoFocus type="number"
                                          defaultValue={row.value ?? ''}
                                          onWheel={e => e.currentTarget.blur()}
                                          onBlur={e => saveIndicator(row.id, e.target.value, 'value')}
                                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingId(null) }}
                                          className="w-14 text-center border border-sky-300 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-sky-400 text-xs"
                                        />
                                      ) : (
                                        <button
                                          disabled={isConfirmed}
                                          onClick={() => !isConfirmed && setEditingId(eid)}
                                          className="w-full text-center font-medium text-gray-800 hover:text-sky-700 hover:bg-sky-50 rounded px-1 py-0.5 disabled:cursor-default"
                                        >
                                          {row.value ?? '—'}
                                        </button>
                                      )
                                    ) : <span className="text-gray-300">—</span>}
                                  </td>
                                )
                              })}

                              {/* Stake total */}
                              <td className="text-center px-1 py-1 bg-sky-50/30">
                                {stakeRow ? (
                                  editingId === `stk-${stakeRow.id}` && !isConfirmed ? (
                                    <input autoFocus type="number"
                                      defaultValue={stakeRow.stake_real ?? ''}
                                      onWheel={e => e.currentTarget.blur()}
                                      onBlur={e => saveIndicator(stakeRow.id, e.target.value, 'stake_real')}
                                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingId(null) }}
                                      className="w-14 text-center border border-sky-300 rounded px-1 py-0.5 outline-none text-xs"
                                    />
                                  ) : (
                                    <button disabled={isConfirmed}
                                      onClick={() => !isConfirmed && setEditingId(`stk-${stakeRow.id}`)}
                                      className="font-bold text-sky-700 hover:text-sky-900 hover:bg-sky-100 rounded px-1 py-0.5 disabled:cursor-default">
                                      {stakeRow.stake_real ?? '—'}
                                    </button>
                                  )
                                ) : <span className="text-gray-300">—</span>}
                              </td>

                              {/* Potential */}
                              <td className="text-center px-1 py-1 bg-emerald-50/30">
                                {stakeRow ? (
                                  editingId === `pot-${stakeRow.id}` && !isConfirmed ? (
                                    <input autoFocus type="number"
                                      defaultValue={stakeRow.stake_potential ?? ''}
                                      onWheel={e => e.currentTarget.blur()}
                                      onBlur={e => saveIndicator(stakeRow.id, e.target.value, 'stake_potential')}
                                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingId(null) }}
                                      className="w-16 text-center border border-emerald-300 rounded px-1 py-0.5 outline-none text-xs"
                                    />
                                  ) : (
                                    <button disabled={isConfirmed}
                                      onClick={() => !isConfirmed && setEditingId(`pot-${stakeRow.id}`)}
                                      className="font-semibold text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 rounded px-1 py-0.5 disabled:cursor-default">
                                      {stakeRow.stake_potential ?? '—'}
                                    </button>
                                  )
                                ) : <span className="text-gray-300">—</span>}
                              </td>

                              {/* Percentage */}
                              <td className={`text-center px-1 py-1 bg-violet-50/30 font-bold tabular-nums ${
                                pct == null ? 'text-gray-300'
                                  : pct >= 50 ? 'text-emerald-600'
                                  : pct >= 25 ? 'text-amber-600'
                                  : 'text-rose-600'
                              }`}>
                                {pct != null ? `${pct}%` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Converts Tab ── */}
          {tab === 'converts' && (
            <div className="p-4 space-y-4">
              {/* Ward selector */}
              <div className="flex flex-wrap gap-2">
                {allConvertWards.map(w => {
                  const cnt = converts.filter(c => c.ward_name === w).length
                  return (
                    <button
                      key={w}
                      onClick={() => setSelectedWard(w)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        selectedWard === w ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {w.replace(/ (Ward|Branch)$/, '')}
                      <span className="ml-1.5 opacity-70 text-xs">({cnt})</span>
                    </button>
                  )
                })}
              </div>

              {/* Convert list */}
              {wardConverts.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">Nenhum converso para esta unidade.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <th className="text-left px-4 py-2 font-semibold">Nome</th>
                        <th className="text-center px-2 py-2 font-semibold">Sexo</th>
                        <th className="text-center px-2 py-2 font-semibold">Idade</th>
                        <th className="text-left px-3 py-2 font-semibold">Sacerdócio</th>
                        <th className="text-center px-2 py-2 font-semibold">Freq. Sacr.</th>
                        <th className="text-center px-2 py-2 font-semibold">Chamado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wardConverts.map(c => (
                        <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-medium text-gray-800">{c.name}</td>
                          <td className="text-center px-2 py-2.5">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                              c.gender === 'M' ? 'bg-blue-100 text-blue-700' : c.gender === 'F' ? 'bg-pink-100 text-pink-700' : 'text-gray-300'
                            }`}>{c.gender ?? '—'}</span>
                          </td>
                          <td className="text-center px-2 py-2.5 text-gray-600 tabular-nums">{c.age ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-600 text-xs">{c.priesthood ?? <span className="text-gray-300">—</span>}</td>
                          <td className="text-center px-2 py-2.5">
                            {c.attended_sacrament === null
                              ? <span className="text-gray-300">—</span>
                              : c.attended_sacrament
                              ? <Check size={14} className="text-emerald-500 mx-auto" />
                              : <X    size={14} className="text-rose-400   mx-auto" />}
                          </td>
                          <td className="text-center px-2 py-2.5">
                            {c.has_calling === null
                              ? <span className="text-gray-300">—</span>
                              : c.has_calling
                              ? <Check size={14} className="text-emerald-500 mx-auto" />
                              : <X    size={14} className="text-rose-400   mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !activeReport && reports.length === 0 && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-12 text-center">
          <FileText className="w-12 h-12 text-sky-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-800">Nenhum relatório importado ainda</h3>
          <p className="text-sm text-gray-500 mt-1">Importe o PDF oficial do Relatório Trimestral para começar.</p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl"
          >
            <Upload size={18} /> Importar PDF
          </button>
        </div>
      )}

      {/* History */}
      {!loading && reports.filter(r => r.status === 'confirmed').length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Relatórios Confirmados</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {reports.filter(r => r.status === 'confirmed').map(r => (
              <button
                key={r.id}
                onClick={() => openReport(r)}
                className={`bg-white rounded-2xl border shadow-sm p-4 text-left hover:shadow-md transition-all group ${
                  activeReport?.id === r.id ? 'border-sky-300 ring-2 ring-sky-100' : 'border-gray-100 hover:border-sky-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">
                    Confirmado
                  </span>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-sky-400 transition-colors" />
                </div>
                <div className="font-bold text-gray-900 text-base">T{r.quarter} {r.year}</div>
                <div className="text-xs text-gray-500 mt-0.5">{QUARTER_LABEL[r.quarter]}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
