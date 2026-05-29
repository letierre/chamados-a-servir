'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '../../lib/supabase/client'
import {
  BarChart3, Loader2, Info, ChevronDown,
  TrendingUp, Users, Flame, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

type Report = {
  id: string; year: number; quarter: number; stake_name: string; status: string
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
  baptism_record_id: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WARD_ORDER = [
  'Cachoeira do Sul', 'Santa Cruz do Sul Campus', 'Estrela', 'Lajeado',
  'Marina', 'Rio Pardo', 'Santa Cruz do Sul', 'Venâncio Aires',
]

const WARD_SHORT: Record<string, string> = {
  'Cachoeira do Sul':         'Cachoeira',
  'Santa Cruz do Sul Campus': 'Campus',
  'Estrela':                  'Estrela',
  'Lajeado':                  'Lajeado',
  'Marina':                   'Marina',
  'Rio Pardo':                'Rio Pardo',
  'Santa Cruz do Sul':        'Sta. Cruz',
  'Venâncio Aires':           'Venâncio',
}

const WARD_COLORS: Record<string, string> = {
  'Cachoeira do Sul':         '#3b82f6',
  'Santa Cruz do Sul Campus': '#8b5cf6',
  'Estrela':                  '#10b981',
  'Lajeado':                  '#f59e0b',
  'Marina':                   '#ef4444',
  'Rio Pardo':                '#06b6d4',
  'Santa Cruz do Sul':        '#ec4899',
  'Venâncio Aires':           '#84cc16',
}

const CATEGORIES = [
  { label: 'Conversão e Crescimento', from: 1,  to: 9  },
  { label: 'Membros / Famílias',       from: 10, to: 13 },
  { label: 'Adultos',                  from: 14, to: 17 },
  { label: 'Jovens',                   from: 18, to: 20 },
  { label: 'Crianças',                 from: 21, to: 22 },
  { label: 'Conversos (últ. 12m)',     from: 23, to: 26 },
]

// Indicadores-chave para o radar (escolhidos por representatividade)
const RADAR_INDICATORS = [1, 2, 3, 5, 7, 14, 18, 23]

const QUARTER_LABEL: Record<number, string> = {
  1: 'Jan–Mar', 2: 'Abr–Jun', 3: 'Jul–Set', 4: 'Out–Dez',
}

// ── Heatmap helpers ───────────────────────────────────────────────────────────

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

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'heatmap',   label: 'Mapa de Calor',   icon: Flame },
  { key: 'trend',     label: 'Evolução',         icon: TrendingUp },
  { key: 'radar',     label: 'Radar',            icon: BarChart3 },
  { key: 'funnel',    label: 'Retenção',         icon: Users },
  { key: 'ranking',   label: 'Comparativo',      icon: ArrowUp },
] as const
type TabKey = typeof TABS[number]['key']

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalisesPage() {
  const supabase = useMemo(() => createClient(), [])

  const [allReports, setAllReports]       = useState<Report[]>([])
  const [selectedId, setSelectedId]       = useState<string>('')
  const [indicators, setIndicators]       = useState<Indicator[]>([])
  const [converts, setConverts]           = useState<Convert[]>([])
  const [allIndicators, setAllIndicators] = useState<Record<string, Indicator[]>>({}) // reportId → rows
  const [loading, setLoading]             = useState(true)
  const [loadingInd, setLoadingInd]       = useState(false)
  const [tab, setTab]                     = useState<TabKey>('heatmap')
  const [trendIndicator, setTrendIndicator] = useState<number>(1)
  const [radarWard, setRadarWard]         = useState<string>('')

  // ── Load all confirmed reports ──
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('quarterly_reports')
        .select('id, year, quarter, stake_name, status')
        .eq('status', 'confirmed')
        .order('year').order('quarter')
      const rows = (data ?? []) as Report[]
      setAllReports(rows)
      if (rows.length > 0) setSelectedId(rows[rows.length - 1].id) // default: most recent
      setLoading(false)
    }
    load()
  }, [supabase])

  // ── Load indicators + converts for selected report ──
  const loadReport = useCallback(async (reportId: string) => {
    setLoadingInd(true)
    const [{ data: inds }, { data: convs }] = await Promise.all([
      supabase.from('quarterly_report_indicators').select('*').eq('report_id', reportId).order('indicator_number'),
      supabase.from('quarterly_report_converts').select('*').eq('report_id', reportId),
    ])
    setIndicators((inds ?? []) as Indicator[])
    setConverts((convs ?? []) as Convert[])
    setLoadingInd(false)
  }, [supabase])

  // ── Load ALL reports' indicators for trend analysis ──
  const loadAllIndicators = useCallback(async (reports: Report[]) => {
    if (reports.length < 2) return
    const results: Record<string, Indicator[]> = {}
    await Promise.all(reports.map(async r => {
      const { data } = await supabase
        .from('quarterly_report_indicators')
        .select('*').eq('report_id', r.id).order('indicator_number')
      results[r.id] = (data ?? []) as Indicator[]
    }))
    setAllIndicators(results)
  }, [supabase])

  useEffect(() => {
    if (selectedId) loadReport(selectedId)
  }, [selectedId, loadReport])

  useEffect(() => {
    if (allReports.length > 0) loadAllIndicators(allReports)
  }, [allReports, loadAllIndicators])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const wardNames = useMemo(() => {
    const available = new Set(indicators.filter(i => i.ward_name !== '__stake__').map(i => i.ward_name))
    return WARD_ORDER.filter(w => available.has(w))
  }, [indicators])

  const indNumbers = useMemo(() =>
    [...new Set(indicators.map(i => i.indicator_number))].sort((a, b) => a - b)
  , [indicators])

  const indMap = useMemo(() => {
    const map = new Map<number, Map<string, Indicator>>()
    for (const ind of indicators) {
      if (!map.has(ind.indicator_number)) map.set(ind.indicator_number, new Map())
      map.get(ind.indicator_number)!.set(ind.ward_name, ind)
    }
    return map
  }, [indicators])

  const indNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const ind of indicators) {
      if (ind.ward_name !== '__stake__' && !map.has(ind.indicator_number))
        map.set(ind.indicator_number, ind.indicator_name)
    }
    return map
  }, [indicators])

  // Ward summary (for heatmap cards)
  const wardSummary = useMemo(() => {
    const s: Record<string, { strength: number; opportunity: number }> = {}
    for (const wn of wardNames) s[wn] = { strength: 0, opportunity: 0 }
    for (const num of indNumbers) {
      const wd = indMap.get(num); if (!wd) continue
      const vals = wardNames.map(wn => wd.get(wn)?.value ?? null)
      wardNames.forEach((wn, i) => {
        const l = getCellLevel(vals[i], vals)
        if (l === 'strength')    s[wn].strength++
        if (l === 'opportunity') s[wn].opportunity++
      })
    }
    return s
  }, [wardNames, indNumbers, indMap])

  // Trend data for selected indicator across all quarters
  const trendData = useMemo(() => {
    return allReports.map(r => {
      const inds = allIndicators[r.id] ?? []
      const point: Record<string, any> = {
        label: `T${r.quarter} ${r.year}`,
      }
      for (const wn of wardNames) {
        const row = inds.find(i => i.indicator_number === trendIndicator && i.ward_name === wn)
        point[WARD_SHORT[wn] ?? wn] = row?.value ?? null
      }
      // stake total
      const stakeRow = inds.find(i => i.indicator_number === trendIndicator && i.ward_name === '__stake__')
      point['Estaca'] = stakeRow?.stake_real ?? null
      return point
    })
  }, [allReports, allIndicators, wardNames, trendIndicator])

  // Radar data for selected ward
  const radarData = useMemo(() => {
    if (!radarWard && wardNames.length > 0) return []
    const wn = radarWard || wardNames[0]
    return RADAR_INDICATORS
      .filter(n => indMap.has(n))
      .map(n => {
        const wd    = indMap.get(n)!
        const val   = wd.get(wn)?.value ?? 0
        const all   = wardNames.map(w => wd.get(w)?.value ?? 0)
        const max   = Math.max(...all, 1)
        const avg   = all.reduce((a, b) => a + b, 0) / (all.length || 1)
        const name  = indNames.get(n) ?? `Ind. ${n}`
        const short = name.length > 25 ? name.slice(0, 24) + '…' : name
        return { indicator: short, unidade: Math.round((val / max) * 100), media: Math.round((avg / max) * 100) }
      })
  }, [radarWard, wardNames, indMap, indNames])

  // Convert retention funnel per ward
  const retentionData = useMemo(() => {
    const wards = [...new Set(converts.map(c => c.ward_name))].sort()
    return wards.map(wn => {
      const members = converts.filter(c => c.ward_name === wn)
      const total       = members.length
      const sacrament   = members.filter(c => c.attended_sacrament === true).length
      const hasCalling  = members.filter(c => c.has_calling === true).length
      const ordained    = members.filter(c => c.priesthood && c.priesthood !== 'Não Ordenado' && c.priesthood !== 'N/A').length
      return {
        ward: WARD_SHORT[wn] ?? wn.split(' ')[0],
        'Batizados': total,
        'Frequentaram Sacramento': sacrament,
        'Com Chamado': hasCalling,
        'Ordenados': ordained,
      }
    })
  }, [converts])

  // Ranking per indicator with trend arrows (compare last 2 reports)
  const rankingData = useMemo(() => {
    if (indNumbers.length === 0 || wardNames.length === 0) return []
    const prevReport = allReports[allReports.length - 2]
    const prevInds   = prevReport ? (allIndicators[prevReport.id] ?? []) : []

    return indNumbers.map(num => {
      const wd = indMap.get(num)
      if (!wd) return null
      const name = indNames.get(num) ?? `Indicador ${num}`

      const wardRows = wardNames.map(wn => {
        const curr = wd.get(wn)?.value ?? 0
        const prev = prevInds.find(i => i.indicator_number === num && i.ward_name === wn)?.value ?? null
        const trend = prev === null ? 'new' : curr > prev ? 'up' : curr < prev ? 'down' : 'same'
        return { ward: wn, short: WARD_SHORT[wn] ?? wn, value: curr, trend }
      }).sort((a, b) => b.value - a.value)

      return { num, name, wards: wardRows }
    }).filter(Boolean) as { num: number; name: string; wards: { ward: string; short: string; value: number; trend: string }[] }[]
  }, [indNumbers, wardNames, indMap, indNames, allReports, allIndicators])

  const selectedReport = allReports.find(r => r.id === selectedId)

  useEffect(() => {
    if (wardNames.length > 0 && !radarWard) setRadarWard(wardNames[0])
  }, [wardNames, radarWard])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#0e4f66] flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-sky-600" />
            Análises
          </h1>
          <p className="text-sm text-gray-500 mt-1">Tendências, pontos de força e oportunidades de crescimento.</p>
        </div>

        {allReports.length > 0 && (
          <div className="relative">
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {[...allReports].reverse().map(r => (
                <option key={r.id} value={r.id}>
                  T{r.quarter} {r.year} — {QUARTER_LABEL[r.quarter]}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
        </div>
      )}

      {!loading && allReports.length === 0 && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-12 text-center">
          <TrendingUp className="w-12 h-12 text-sky-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-800">Nenhum relatório confirmado ainda</h3>
          <p className="text-sm text-gray-500 mt-1">Confirme pelo menos um Relatório Trimestral para ver as análises.</p>
        </div>
      )}

      {!loading && selectedReport && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-gray-100 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
                  tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </div>

          {loadingInd && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
            </div>
          )}

          {!loadingInd && (
            <div className="p-6 space-y-6">

              {/* ── 1. MAPA DE CALOR ── */}
              {tab === 'heatmap' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="font-bold text-gray-900">Mapa de Calor — Indicadores por Unidade</h2>
                      <p className="text-xs text-gray-500 mt-0.5">T{selectedReport.quarter} {selectedReport.year} · {selectedReport.stake_name}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-medium">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" /><span className="text-emerald-700">Ponto de força</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block" /><span className="text-gray-500">Em crescimento</span></span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300 inline-block" /><span className="text-amber-700">Oportunidade</span></span>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-700 text-white text-[10px] uppercase">
                          <th className="text-left px-4 py-2.5 font-semibold sticky left-0 bg-slate-700 z-10 min-w-[200px] border-r border-slate-600">Indicador</th>
                          {wardNames.map(w => (
                            <th key={w} title={w} className="text-center px-2 py-2.5 font-semibold min-w-[72px] border-r border-slate-600 last:border-r-0">
                              {WARD_SHORT[w] ?? w.split(' ')[0]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CATEGORIES.map(cat => {
                          const catNums = indNumbers.filter(n => n >= cat.from && n <= cat.to)
                          if (!catNums.length) return null
                          return (
                            <>
                              <tr key={`cat-${cat.label}`}>
                                <td colSpan={wardNames.length + 1} className="px-4 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100 border-y border-slate-200">
                                  {cat.label}
                                </td>
                              </tr>
                              {catNums.map((num, rowIdx) => {
                                const wd = indMap.get(num); if (!wd) return null
                                const name = wd.values().next().value?.indicator_name ?? `Indicador ${num}`
                                const vals = wardNames.map(wn => wd.get(wn)?.value ?? null)
                                return (
                                  <tr key={num} className={`border-b border-gray-100 hover:brightness-95 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                                    <td className={`px-4 py-2 text-gray-700 sticky left-0 border-r-2 border-gray-200 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                                      <span className="text-gray-400 mr-1">{num}.</span>
                                      <span className="line-clamp-1" title={name}>{name}</span>
                                    </td>
                                    {wardNames.map((wn, ci) => {
                                      const val   = wd.get(wn)?.value ?? null
                                      const level = getCellLevel(val, vals)
                                      return (
                                        <td key={wn} title={`${wn}: ${val ?? '—'}`}
                                          className={`text-center px-2 py-2 tabular-nums border-r border-gray-100 last:border-r-0 ${CELL_CLASS[level]}`}>
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

                  {/* Ward summary cards */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Info size={15} className="text-sky-500" />
                      <h3 className="font-bold text-gray-800 text-sm">Perfil de cada Unidade</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {wardNames.map(wn => {
                        const { strength, opportunity } = wardSummary[wn] ?? { strength: 0, opportunity: 0 }
                        return (
                          <div key={wn} className="bg-gray-50 rounded-2xl p-4 space-y-2">
                            <p className="text-xs font-bold text-gray-700">{WARD_SHORT[wn] ?? wn}</p>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              <span className="text-xs text-gray-600"><span className="font-bold text-emerald-700">{strength}</span> pontos de força</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              <span className="text-xs text-gray-600"><span className="font-bold text-amber-700">{opportunity}</span> oportunidades</span>
                            </div>
                            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${indNumbers.length > 0 ? (strength / indNumbers.length) * 100 : 0}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                      Comparação interna à Estaca — não reflete metas externas. Cada unidade contribui de forma única ao avanço do Reino.
                    </p>
                  </div>
                </div>
              )}

              {/* ── 2. EVOLUÇÃO TRIMESTRAL ── */}
              {tab === 'trend' && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-gray-900">Evolução Trimestral</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Acompanha a trajetória de cada indicador ao longo do tempo.</p>
                    </div>
                    <div className="relative">
                      <select
                        value={trendIndicator}
                        onChange={e => setTrendIndicator(Number(e.target.value))}
                        className="appearance-none bg-white border border-gray-200 rounded-xl px-3 py-2 pr-8 text-sm font-medium text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-300"
                      >
                        {indNumbers.map(n => (
                          <option key={n} value={n}>{n}. {indNames.get(n) ?? `Indicador ${n}`}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {allReports.length < 2 ? (
                    <div className="bg-sky-50 border border-sky-100 rounded-2xl p-6 text-center">
                      <TrendingUp className="w-8 h-8 text-sky-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-sky-800">Evolução disponível a partir do 2º trimestre confirmado</p>
                      <p className="text-xs text-sky-600 mt-1">Importe e confirme mais relatórios para visualizar a trajetória.</p>
                    </div>
                  ) : (
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={36} />
                          <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
                            labelStyle={{ fontWeight: 700, color: '#0f172a', marginBottom: 4 }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {wardNames.map(wn => (
                            <Line
                              key={wn}
                              type="monotone"
                              dataKey={WARD_SHORT[wn] ?? wn}
                              stroke={WARD_COLORS[wn] ?? '#94a3b8'}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              activeDot={{ r: 5 }}
                              connectNulls
                            />
                          ))}
                          <Line type="monotone" dataKey="Estaca" stroke="#0e4f66" strokeWidth={3} strokeDasharray="6 3" dot={{ r: 4 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400">
                    Linha tracejada = total da Estaca. Cada trimestre representa o esforço coletivo e o crescimento acumulado.
                  </p>
                </div>
              )}

              {/* ── 3. RADAR POR UNIDADE ── */}
              {tab === 'radar' && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-gray-900">Radar por Unidade</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Perfil multidimensional de cada unidade nos indicadores principais.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {wardNames.map(wn => (
                        <button
                          key={wn}
                          onClick={() => setRadarWard(wn)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            radarWard === wn ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                          style={radarWard === wn ? { backgroundColor: WARD_COLORS[wn] ?? '#3b82f6' } : {}}
                        >
                          {WARD_SHORT[wn] ?? wn}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="indicator" tick={{ fontSize: 10, fill: '#475569' }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} tickCount={4} />
                        <Radar
                          name={WARD_SHORT[radarWard] ?? radarWard}
                          dataKey="unidade"
                          stroke={WARD_COLORS[radarWard] ?? '#3b82f6'}
                          fill={WARD_COLORS[radarWard] ?? '#3b82f6'}
                          fillOpacity={0.25}
                          strokeWidth={2}
                        />
                        <Radar
                          name="Média da Estaca"
                          dataKey="media"
                          stroke="#94a3b8"
                          fill="#94a3b8"
                          fillOpacity={0.1}
                          strokeDasharray="5 3"
                          strokeWidth={1.5}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}
                          formatter={(v: any) => [`${v}%`, '']}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Valores normalizados (0–100%) em relação à unidade de maior valor na Estaca para cada indicador. A linha cinza mostra a média da Estaca como referência — não como meta.
                  </p>
                </div>
              )}

              {/* ── 4. FUNIL DE RETENÇÃO ── */}
              {tab === 'funnel' && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-bold text-gray-900">Retenção de Conversos</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Acompanha o engajamento dos membros batizados neste trimestre — sacramento, chamado e ordenação.
                    </p>
                  </div>

                  {converts.length === 0 ? (
                    <div className="bg-gray-50 rounded-2xl p-8 text-center">
                      <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Nenhum converso registrado neste relatório.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Stake-level funnel */}
                      <div className="bg-sky-50 rounded-2xl p-5 space-y-3">
                        <p className="text-sm font-bold text-sky-800">Visão Geral da Estaca</p>
                        {(() => {
                          const total    = converts.length
                          const sacr     = converts.filter(c => c.attended_sacrament).length
                          const calling  = converts.filter(c => c.has_calling).length
                          const ord      = converts.filter(c => c.priesthood && c.priesthood !== 'Não Ordenado').length
                          const steps = [
                            { label: 'Batizados no trimestre',   value: total,   pct: 100,                            color: 'bg-sky-500' },
                            { label: 'Frequentaram o Sacramento', value: sacr,   pct: Math.round((sacr / total) * 100),   color: 'bg-emerald-500' },
                            { label: 'Receberam um Chamado',     value: calling, pct: Math.round((calling / total) * 100), color: 'bg-violet-500' },
                            { label: 'Ordenados ao Sacerdócio',  value: ord,     pct: Math.round((ord / total) * 100),     color: 'bg-amber-500' },
                          ]
                          return steps.map(s => (
                            <div key={s.label} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-sky-700 font-medium">{s.label}</span>
                                <span className="font-bold text-sky-800">{s.value} <span className="font-normal text-sky-600">({s.pct}%)</span></span>
                              </div>
                              <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                                <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${s.pct}%` }} />
                              </div>
                            </div>
                          ))
                        })()}
                      </div>

                      {/* Per ward */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {retentionData.filter(d => d['Batizados'] > 0).map(d => {
                          const total   = d['Batizados'] as number
                          const sacr    = d['Frequentaram Sacramento'] as number
                          const calling = d['Com Chamado'] as number
                          return (
                            <div key={d.ward} className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
                              <p className="text-xs font-bold text-gray-700">{d.ward}</p>
                              <div className="space-y-1.5">
                                {[
                                  { label: 'Batizados',    v: total,   color: 'bg-sky-400' },
                                  { label: 'Sacramento',   v: sacr,    color: 'bg-emerald-400' },
                                  { label: 'Chamado',      v: calling, color: 'bg-violet-400' },
                                ].map(s => (
                                  <div key={s.label} className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">{s.label}</span>
                                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div className={`h-full ${s.color} rounded-full`} style={{ width: total > 0 ? `${(s.v / total) * 100}%` : '0%' }} />
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-600 w-6 text-right">{s.v}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-[11px] text-gray-400">
                        Retenção reflete o cuidado pastoral com cada novo membro. Os números são referência para direcionar visitas e acompanhamento — não métricas de desempenho.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── 5. RANKING COMPARATIVO ── */}
              {tab === 'ranking' && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-bold text-gray-900">Comparativo entre Unidades</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Posição de cada unidade por indicador.
                      {allReports.length >= 2 && <> Setas indicam variação em relação ao trimestre anterior.</>}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {rankingData.map(row => (
                      <div key={row.num} className="bg-gray-50 rounded-2xl p-4">
                        <p className="text-xs font-bold text-gray-700 mb-3">
                          <span className="text-gray-400 mr-1">{row.num}.</span>{row.name}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {row.wards.map((w, pos) => (
                            <div
                              key={w.ward}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                                pos === 0
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : pos >= row.wards.length - 1
                                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                                  : 'bg-white border-gray-200 text-gray-700'
                              }`}
                            >
                              <span className="text-[10px] text-gray-400 font-normal">{pos + 1}º</span>
                              {w.short}
                              <span className="tabular-nums font-bold">{w.value}</span>
                              {w.trend === 'up'   && <ArrowUp   size={11} className="text-emerald-500" />}
                              {w.trend === 'down' && <ArrowDown size={11} className="text-amber-500"   />}
                              {w.trend === 'same' && <Minus     size={11} className="text-gray-400"    />}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    A posição identifica onde cada unidade está neste momento — toda jornada tem ritmos diferentes. O destaque verde indica liderança neste indicador; âmbar sinaliza potencial de crescimento.
                  </p>
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
  )
}
