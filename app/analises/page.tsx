'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '../../lib/supabase/client'
import { BarChart3, Loader2, Info, ChevronDown } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Report = {
  id: string; year: number; quarter: number; stake_name: string
}
type Indicator = {
  id: string; ward_name: string
  indicator_number: number; indicator_name: string
  value: number | null; stake_real: number | null; stake_potential: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WARD_ORDER = [
  'Cachoeira do Sul', 'Santa Cruz do Sul Campus', 'Estrela', 'Lajeado',
  'Marina', 'Rio Pardo', 'Santa Cruz do Sul', 'Venâncio Aires',
]

const WARD_SHORT: Record<string, string> = {
  'Cachoeira do Sul':          'Cachoeira',
  'Santa Cruz do Sul Campus':  'Campus',
  'Estrela':                   'Estrela',
  'Lajeado':                   'Lajeado',
  'Marina':                    'Marina',
  'Rio Pardo':                 'Rio Pardo',
  'Santa Cruz do Sul':         'Sta. Cruz',
  'Venâncio Aires':            'Venâncio',
}

const CATEGORIES = [
  { label: 'Conversão e Crescimento', from: 1,  to: 9  },
  { label: 'Membros / Famílias',       from: 10, to: 13 },
  { label: 'Adultos',                  from: 14, to: 17 },
  { label: 'Jovens',                   from: 18, to: 20 },
  { label: 'Crianças',                 from: 21, to: 22 },
  { label: 'Conversos (últ. 12m)',     from: 23, to: 26 },
]

const QUARTER_LABEL: Record<number, string> = {
  1: 'Jan–Mar', 2: 'Abr–Jun', 3: 'Jul–Set', 4: 'Out–Dez',
}

// ── Heatmap cell level ────────────────────────────────────────────────────────
// Compara o valor de uma unidade com as demais para o mesmo indicador.
// Sem julgamento — apenas identifica tendências relativas dentro da estaca.

type CellLevel = 'strength' | 'neutral' | 'opportunity' | 'empty'

function getCellLevel(value: number | null, allValues: (number | null)[]): CellLevel {
  if (value === null) return 'empty'
  const valid = allValues.filter((v): v is number => v !== null && v > 0)
  if (valid.length < 2) return 'neutral'
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = sorted.filter(v => v <= value).length - 1
  const pct = idx / (sorted.length - 1)
  if (pct >= 0.66) return 'strength'
  if (pct <= 0.33) return 'opportunity'
  return 'neutral'
}

const CELL_CLASS: Record<CellLevel, string> = {
  strength:    'bg-emerald-50  text-emerald-800 font-semibold',
  neutral:     'bg-white       text-gray-700',
  opportunity: 'bg-amber-50    text-amber-800',
  empty:       'bg-gray-50     text-gray-300',
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalisesPage() {
  const supabase = useMemo(() => createClient(), [])

  const [reports, setReports]       = useState<Report[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadingInd, setLoadingInd] = useState(false)

  // ── Load confirmed reports ──
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('quarterly_reports')
        .select('id, year, quarter, stake_name')
        .eq('status', 'confirmed')
        .order('year', { ascending: false })
        .order('quarter', { ascending: false })
      const rows = (data ?? []) as Report[]
      setReports(rows)
      if (rows.length > 0) setSelectedId(rows[0].id)
      setLoading(false)
    }
    load()
  }, [supabase])

  // ── Load indicators for selected report ──
  const loadIndicators = useCallback(async (reportId: string) => {
    setLoadingInd(true)
    const { data } = await supabase
      .from('quarterly_report_indicators')
      .select('*')
      .eq('report_id', reportId)
      .order('indicator_number')
    setIndicators((data ?? []) as Indicator[])
    setLoadingInd(false)
  }, [supabase])

  useEffect(() => {
    if (selectedId) loadIndicators(selectedId)
  }, [selectedId, loadIndicators])

  // ── Derived ──
  const wardNames = useMemo(() => {
    const available = new Set(indicators.filter(i => i.ward_name !== '__stake__').map(i => i.ward_name))
    return WARD_ORDER.filter(w => available.has(w))
  }, [indicators])

  const indNumbers = useMemo(() =>
    [...new Set(indicators.map(i => i.indicator_number))].sort((a, b) => a - b)
  , [indicators])

  // indMap: number → wardName → Indicator
  const indMap = useMemo(() => {
    const map = new Map<number, Map<string, Indicator>>()
    for (const ind of indicators) {
      if (!map.has(ind.indicator_number)) map.set(ind.indicator_number, new Map())
      map.get(ind.indicator_number)!.set(ind.ward_name, ind)
    }
    return map
  }, [indicators])

  // Conta de forças/oportunidades por unidade (para o resumo)
  const wardSummary = useMemo(() => {
    const summary: Record<string, { strength: number; opportunity: number }> = {}
    for (const wn of wardNames) summary[wn] = { strength: 0, opportunity: 0 }

    for (const num of indNumbers) {
      const wardData = indMap.get(num)
      if (!wardData) continue
      const allValues = wardNames.map(wn => wardData.get(wn)?.value ?? null)
      for (let i = 0; i < wardNames.length; i++) {
        const level = getCellLevel(allValues[i], allValues)
        if (level === 'strength')    summary[wardNames[i]].strength++
        if (level === 'opportunity') summary[wardNames[i]].opportunity++
      }
    }
    return summary
  }, [wardNames, indNumbers, indMap])

  const selectedReport = reports.find(r => r.id === selectedId)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#0e4f66] flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-sky-600" />
            Análises
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Tendências e oportunidades de crescimento por unidade da Estaca.
          </p>
        </div>

        {/* Report selector */}
        {reports.length > 0 && (
          <div className="relative">
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {reports.map(r => (
                <option key={r.id} value={r.id}>
                  T{r.quarter} {r.year} — {QUARTER_LABEL[r.quarter]}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* Loading / empty */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-12 text-center">
          <BarChart3 className="w-12 h-12 text-sky-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-800">Nenhum relatório confirmado ainda</h3>
          <p className="text-sm text-gray-500 mt-1">
            Confirme pelo menos um Relatório Trimestral para ver as análises.
          </p>
        </div>
      )}

      {!loading && selectedReport && (
        <>
          {/* ── Análise 1: Mapa de Calor ── */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">

            <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-gray-900 text-base">Mapa de Calor — Indicadores por Unidade</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  T{selectedReport.quarter} {selectedReport.year} · {QUARTER_LABEL[selectedReport.quarter]} · {selectedReport.stake_name}
                </p>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-3 text-[11px] font-medium flex-shrink-0">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" />
                  <span className="text-emerald-700">Ponto de força</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block" />
                  <span className="text-gray-500">Em crescimento</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300 inline-block" />
                  <span className="text-amber-700">Oportunidade</span>
                </span>
              </div>
            </div>

            {loadingInd ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando indicadores...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-700 text-white text-[10px] uppercase">
                      <th className="text-left px-4 py-2.5 font-semibold sticky left-0 bg-slate-700 z-10 min-w-[220px] border-r border-slate-600">
                        Indicador
                      </th>
                      {wardNames.map((w, i) => (
                        <th
                          key={w}
                          title={w}
                          className={`text-center px-2 py-2.5 font-semibold min-w-[75px] border-r border-slate-600 ${i === wardNames.length - 1 ? 'border-r-0' : ''}`}
                        >
                          {WARD_SHORT[w] ?? w.split(' ')[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => {
                      const catNums = indNumbers.filter(n => n >= cat.from && n <= cat.to)
                      if (catNums.length === 0) return null
                      return (
                        <>
                          <tr key={`cat-${cat.label}`}>
                            <td
                              colSpan={wardNames.length + 1}
                              className="px-4 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100 border-y border-slate-200"
                            >
                              {cat.label}
                            </td>
                          </tr>

                          {catNums.map((num, rowIdx) => {
                            const wardData = indMap.get(num)
                            if (!wardData) return null
                            const firstName = wardData.values().next().value
                            const indName   = firstName?.indicator_name ?? `Indicador ${num}`
                            const allValues = wardNames.map(wn => wardData.get(wn)?.value ?? null)
                            const isEven    = rowIdx % 2 === 0

                            return (
                              <tr key={num} className={`border-b border-gray-100 hover:brightness-95 transition-all ${isEven ? '' : 'brightness-[0.98]'}`}>
                                <td className={`px-4 py-2 text-gray-700 sticky left-0 border-r-2 border-gray-200 max-w-[220px] ${isEven ? 'bg-white' : 'bg-gray-50/60'}`}>
                                  <span className="text-gray-400 mr-1 tabular-nums">{num}.</span>
                                  <span className="line-clamp-1" title={indName}>{indName}</span>
                                </td>

                                {wardNames.map((wn, colIdx) => {
                                  const val   = wardData.get(wn)?.value ?? null
                                  const level = getCellLevel(val, allValues)
                                  return (
                                    <td
                                      key={wn}
                                      title={`${wn}: ${val ?? '—'}`}
                                      className={`text-center px-2 py-2 tabular-nums border-r border-gray-100 last:border-r-0 ${CELL_CLASS[level]}`}
                                    >
                                      {val ?? <span className="text-gray-200">—</span>}
                                    </td>
                                  )
                                })}
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
          </div>

          {/* ── Resumo por unidade ── */}
          {!loadingInd && wardNames.length > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Info size={16} className="text-sky-500" />
                <h2 className="font-bold text-gray-900 text-sm">Perfil de cada Unidade</h2>
                <span className="text-xs text-gray-400">— comparação interna da Estaca</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {wardNames.map(wn => {
                  const { strength, opportunity } = wardSummary[wn] ?? { strength: 0, opportunity: 0 }
                  const total = indNumbers.length
                  return (
                    <div key={wn} className="bg-gray-50 rounded-2xl p-4 space-y-2">
                      <p className="text-xs font-bold text-gray-700 leading-tight">{WARD_SHORT[wn] ?? wn}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        <span className="text-xs text-gray-600">
                          <span className="font-bold text-emerald-700">{strength}</span> pontos de força
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                        <span className="text-xs text-gray-600">
                          <span className="font-bold text-amber-700">{opportunity}</span> oportunidades
                        </span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-emerald-400 rounded-full"
                          style={{ width: `${total > 0 ? (strength / total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
                <span className="font-semibold">Como interpretar:</span> "Ponto de força" indica que a unidade está entre as mais desenvolvidas neste indicador dentro da Estaca — não é uma comparação com metas externas. "Oportunidade" identifica áreas com potencial de crescimento. Cada unidade contribui de forma única ao avanço do Reino.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
