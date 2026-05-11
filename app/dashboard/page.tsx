'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '../../lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  Users, UserPlus, Heart, Church,
  Award, BookOpen, Target,
  Trophy, AlertCircle,
  Search, BarChart3,
  FileText, FileSpreadsheet,
  TrendingUp, Printer, Bot, Sparkles, Loader2,
  CalendarRange, X,
  ClipboardList
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { buildReportPdf, safeFileName } from '../../lib/relatorios/build-pdf'
import type { ReportConfig } from '../../lib/relatorios/build-message'

// ═══════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════

type Period = 'current_month' | 'last_month' | '90d' | '12m' | 'current_year' | 'custom'

type Ward = { id: string; name: string; membership_count: number | null }
type Indicator = { id: string; slug: string; display_name: string; order_index: number }

type RpcRow = {
  ward_id: string; ward_name: string; ward_membership: number | null
  indicator_id: string; display_name: string; slug: string
  indicator_type: string; aggregation_method: string
  responsibility: string; order_index: number; computed_value: number
}

type CardData = {
  id: string; slug: string; display_name: string; value: number; subtitle: string
  bestWard: string; bestValue: number; worstWard: string; worstValue: number
}

type WardMetric = {
  id: string; slug: string; display_name: string
  value: number; target: number; gap: number; progress: number
}

// ═══════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════

const STAKE_ID = '__stake__'

const COLORS = { title: '#0e4f66', chartLine: '#0ea5e9' }

const ICON_MAP: Record<string, React.ReactNode> = {
  frequencia_sacramental: <Church className="w-4 h-4 md:w-6 md:h-6 text-sky-600" />,
  batismo_converso: <UserPlus className="w-4 h-4 md:w-6 md:h-6 text-emerald-600" />,
  membros_retornando_a_igreja: <Users className="w-4 h-4 md:w-6 md:h-6 text-orange-600" />,
  membros_participantes: <Users className="w-4 h-4 md:w-6 md:h-6 text-blue-600" />,
  membros_jejuando: <Heart className="w-4 h-4 md:w-6 md:h-6 text-rose-600" />,
  missionario_servindo_missao_do_brasil: <BookOpen className="w-4 h-4 md:w-6 md:h-6 text-indigo-600" />,
  recomendacao_templo_com_investidura: <Award className="w-4 h-4 md:w-6 md:h-6 text-amber-600" />,
  recomendacao_templo_sem_investidura: <Award className="w-4 h-4 md:w-6 md:h-6 text-yellow-600" />,
}

const PERIOD_LABELS: Record<Period, string> = {
  current_month: 'Mês Atual', last_month: 'Mês Passado', '90d': '90 Dias', '12m': '12 Meses',
  current_year: 'Ano Atual', custom: 'Personalizado',
}
const PERIOD_OPTIONS: Period[] = ['current_month', 'last_month', '90d', '12m', 'current_year', 'custom']

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function getDateRange(period: Period, customStart?: string, customEnd?: string): { start: string; end: string } {
  const now = new Date()
  let start: Date, end: Date
  switch (period) {
    case 'current_month': start = new Date(now.getFullYear(), now.getMonth(), 1); end = now; break
    case 'last_month': start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); break
    case '90d': start = new Date(now); start.setDate(start.getDate() - 90); end = now; break
    case '12m': start = new Date(now); start.setFullYear(start.getFullYear() - 1); end = now; break
    case 'current_year': start = new Date(now.getFullYear(), 0, 1); end = now; break
    case 'custom':
      if (customStart && customEnd) return { start: customStart, end: customEnd }
      start = new Date(now.getFullYear(), now.getMonth(), 1); end = now; break
  }
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

// Slugs de recomendação que devem usar média em períodos longos
const RECOMENDACAO_SLUGS = ['recomendacao_templo_com_investidura', 'recomendacao_templo_sem_investidura']

function processCards(rows: RpcRow[], period: Period): CardData[] {
  const byIndicator = new Map<string, RpcRow[]>()
  for (const row of rows) {
    const existing = byIndicator.get(row.indicator_id) || []
    existing.push(row)
    byIndicator.set(row.indicator_id, existing)
  }
  const cards: CardData[] = []
  const periodLabel = PERIOD_LABELS[period]

  // Períodos que abrangem múltiplos meses — recomendações mostram média
  const isLongPeriod = ['90d', '12m', 'current_year', 'custom'].includes(period)

  for (const [indicatorId, wardRows] of byIndicator) {
    const first = wardRows[0]
    const slug = first.slug
    const isRecomendacao = RECOMENDACAO_SLUGS.includes(slug)

    // Valor principal: soma de todas as alas
    let mainValue = wardRows.reduce((acc, r) => acc + r.computed_value, 0)

    // Recomendações em períodos longos: calcular média entre as alas
    // (cada ala retorna seu computed_value que já é a média do período via RPC)
    // O mainValue é a soma das médias de cada ala — exibimos a soma e ajustamos o subtitle
    let subtitle = ''
    if (isRecomendacao && isLongPeriod) {
      subtitle = `Média (${periodLabel})`
    } else if (first.aggregation_method === 'avg') {
      subtitle = `Média (${periodLabel})`
    } else if (first.aggregation_method === 'sum' || first.aggregation_method === 'sum_yearly') {
      subtitle = `Total (${periodLabel})`
    } else {
      subtitle = 'Atual'
    }

    // Batismo: sempre exibir como total do período
    if (slug === 'batismo_converso') {
      subtitle = `Total (${periodLabel})`
    }

    let best = { name: '-', value: 0, score: -1 }
    let worst = { name: '-', value: 0, score: Infinity }
    for (const row of wardRows) {
      const members = row.ward_membership && row.ward_membership > 0 ? row.ward_membership : 1
      const score = (row.computed_value / members) * 1000
      if (score > best.score) best = { name: row.ward_name, value: row.computed_value, score }
      if (score < worst.score) worst = { name: row.ward_name, value: row.computed_value, score }
    }
    if (best.score === -1) best = { name: '-', value: 0, score: 0 }
    if (worst.score === Infinity) worst = { name: '-', value: 0, score: 0 }

    cards.push({
      id: indicatorId, slug, display_name: first.display_name,
      value: mainValue, subtitle, bestWard: best.name, bestValue: best.value,
      worstWard: worst.name, worstValue: worst.value,
    })
  }
  const orderMap = new Map(rows.map(r => [r.indicator_id, r.order_index]))
  cards.sort((a, b) => (orderMap.get(a.id) || 0) - (orderMap.get(b.id) || 0))
  return cards
}

// ═══════════════════════════════════════
// COMPONENTE
// ═══════════════════════════════════════

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('current_month')
  const [selectedWardId, setSelectedWardId] = useState('')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [customDateStart, setCustomDateStart] = useState('')
  const [customDateEnd, setCustomDateEnd] = useState('')
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false)

  // Raio-X por Indicador
  const [xrayIndicatorId, setXrayIndicatorId] = useState('')

  // Gráfico
  const [chartWardId, setChartWardId] = useState(STAKE_ID)
  const [chartIndicatorId, setChartIndicatorId] = useState('')
  const [chartData, setChartData] = useState<{ week: string; valor: number }[]>([])
  const [isChartLoading, setIsChartLoading] = useState(false)

  // AI e Impressão
  const [isPrintingXRay, setIsPrintingXRay] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [sumoBriefingLoading, setSumoBriefingLoading] = useState(false)
  const [displayedAiResult, setDisplayedAiResult] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)

  // Dados
  const [rpcData, setRpcData] = useState<RpcRow[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [targetMatrix, setTargetMatrix] = useState<Record<string, Record<string, number>>>({})
  const [stakeTotals, setStakeTotals] = useState<Record<string, number>>({})

  // ─── Carregar definições ───
  const loadDefinitions = useCallback(async () => {
    const [indRes, wardRes] = await Promise.all([
      supabase.from('indicators').select('id, slug, display_name, order_index').eq('active', true).order('order_index'),
      supabase.from('wards').select('id, name, membership_count').eq('active', true).order('name'),
    ])
    if (indRes.data) {
      setIndicators(indRes.data)
      if (indRes.data.length > 0) {
        setChartIndicatorId(indRes.data[0].id)
        setXrayIndicatorId(indRes.data[0].id)
      }
    }
    if (wardRes.data) {
      setWards(wardRes.data)
      if (wardRes.data.length > 0) {
        setSelectedWardId(STAKE_ID)
        setChartWardId(STAKE_ID)
      }
    }
  }, [supabase])

  // ─── Carregar dados Visão Geral ───
  const loadDashboardData = useCallback(async () => {
    if (wards.length === 0) return
    if (selectedPeriod === 'custom' && (!customDateStart || !customDateEnd)) return
    setLoading(true)
    try {
      const { start, end } = getDateRange(selectedPeriod, customDateStart, customDateEnd)

      // Buscar dados do RPC e contagem real de batismos nominais em paralelo
      // Filtramos por baptism_date (data real do batismo), não week_start (semana de lançamento)
      const [rpcRes, baptismRes] = await Promise.all([
        supabase.rpc('get_dashboard_data_v2', { p_start: start, p_end: end }),
        supabase.from('baptism_records')
          .select('ward_id', { count: 'exact' })
          .gte('baptism_date', start)
          .lte('baptism_date', end),
      ])

      if (!rpcRes.error && rpcRes.data) {
        let rows: RpcRow[] = rpcRes.data

        // Corrigir batismo: substituir computed_value pelo total real de baptism_records
        if (baptismRes.count !== null && baptismRes.count !== undefined) {
          // Contar por ala
          const { data: baptismByWard } = await supabase
            .from('baptism_records')
            .select('ward_id')
            .gte('baptism_date', start)
            .lte('baptism_date', end)

          if (baptismByWard) {
            const wardCounts = new Map<string, number>()
            baptismByWard.forEach((r: { ward_id: string }) => {
              wardCounts.set(r.ward_id, (wardCounts.get(r.ward_id) || 0) + 1)
            })

            rows = rows.map(row => {
              if (row.slug === 'batismo_converso') {
                return { ...row, computed_value: wardCounts.get(row.ward_id) || 0 }
              }
              return row
            })
          }
        }

        setRpcData(rows)
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [supabase, selectedPeriod, wards, customDateStart, customDateEnd])

  // ─── Carregar metas ───
  const loadTargets = useCallback(async () => {
    if (indicators.length === 0) return
    const { data: targets } = await supabase.from('targets').select('*').eq('year', selectedYear)
    const matrix: Record<string, Record<string, number>> = {}
    const totals: Record<string, number> = {}
    indicators.forEach(ind => { totals[ind.id] = 0 })
    if (targets) {
      targets.forEach((t: any) => {
        const wId = String(t.ward_id), iId = String(t.indicator_id), val = Number(t.target_value) || 0
        if (!matrix[wId]) matrix[wId] = {}
        matrix[wId][iId] = val
        if (totals[iId] !== undefined) totals[iId] += val
      })
    }
    setTargetMatrix(matrix)
    setStakeTotals(totals)
  }, [supabase, selectedYear, indicators])

  // ─── Carregar Gráfico — com suporte Estaca ───
  const loadChartData = useCallback(async () => {
    if (!chartWardId || !chartIndicatorId) return
    setIsChartLoading(true)
    try {
      const start = new Date()
      start.setDate(start.getDate() - 90)
      const { data } = await supabase.rpc('get_report_data', {
        p_start: start.toISOString().split('T')[0],
        p_end: new Date().toISOString().split('T')[0],
      })
      if (data) {
        const byIndicator = data.filter((d: any) => d.indicator_id === chartIndicatorId)

        if (chartWardId === STAKE_ID) {
          // ESTACA: somar valores de todas as alas por semana
          const weekMap = new Map<string, number>()
          byIndicator.forEach((d: any) => {
            weekMap.set(d.week_start, (weekMap.get(d.week_start) || 0) + d.raw_value)
          })
          setChartData(
            Array.from(weekMap.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([week, valor]) => ({
                week: new Date(week + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                valor,
              }))
          )
        } else {
          // ALA INDIVIDUAL
          const filtered = byIndicator.filter((d: any) => d.ward_id === chartWardId)
          setChartData(filtered.map((d: any) => ({
            week: new Date(d.week_start + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            valor: d.raw_value,
          })))
        }
      }
    } catch (err) { console.error(err) }
    finally { setIsChartLoading(false) }
  }, [supabase, chartWardId, chartIndicatorId])

  // ─── Effects ───
  useEffect(() => { loadDefinitions() }, [loadDefinitions])
  useEffect(() => { loadDashboardData() }, [loadDashboardData])
  useEffect(() => { loadTargets() }, [loadTargets])
  useEffect(() => { loadChartData() }, [loadChartData])
  useEffect(() => { setAiResult(null); setDisplayedAiResult(null) }, [selectedWardId])

  // Typing effect
  useEffect(() => {
    if (!aiResult) { setDisplayedAiResult(null); setIsTyping(false); return }
    setIsTyping(true)
    let text = '', idx = 0
    const interval = setInterval(() => {
      if (idx < aiResult.length) { text += aiResult[idx]; setDisplayedAiResult(text); idx++ }
      else { setIsTyping(false); clearInterval(interval) }
    }, 15)
    return () => clearInterval(interval)
  }, [aiResult])

  // ─── Dados Processados ───
  const mainCards = useMemo(() => processCards(rpcData, selectedPeriod), [rpcData, selectedPeriod])

  // Raio-X — suporta Estaca (soma de todas as alas) ou ala individual
  const wardMetrics: WardMetric[] = useMemo(() => {
    if (!selectedWardId || indicators.length === 0) return []

    if (selectedWardId === STAKE_ID) {
      // ESTACA: somar computed_value de todas as alas por indicador
      return indicators.map(ind => {
        const rows = rpcData.filter(r => r.indicator_id === ind.id)
        const value = rows.reduce((sum, r) => sum + r.computed_value, 0)
        const target = stakeTotals[ind.id] || 0
        const gap = target > 0 ? Math.max(0, target - value) : 0
        const progress = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
        return { id: ind.id, slug: ind.slug, display_name: ind.display_name, value, target, gap, progress }
      })
    }

    return indicators.map(ind => {
      const row = rpcData.find(r => r.ward_id === selectedWardId && r.indicator_id === ind.id)
      const value = row?.computed_value || 0
      const target = targetMatrix[selectedWardId]?.[ind.id] || 0
      const gap = target > 0 ? Math.max(0, target - value) : 0
      const progress = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
      return { id: ind.id, slug: ind.slug, display_name: ind.display_name, value, target, gap, progress }
    })
  }, [rpcData, selectedWardId, indicators, targetMatrix, stakeTotals])

  // Raio-X por Indicador — todas as alas para um indicador selecionado
  type IndicatorXRayItem = {
    wardId: string; wardName: string; membership: number
    value: number; target: number; gap: number; progress: number
  }
  const indicatorXRayData: IndicatorXRayItem[] = useMemo(() => {
    if (!xrayIndicatorId || wards.length === 0) return []
    const selectedInd = indicators.find(i => i.id === xrayIndicatorId)
    if (!selectedInd) return []

    return wards.map(ward => {
      const row = rpcData.find(r => r.ward_id === ward.id && r.indicator_id === xrayIndicatorId)
      const value = row?.computed_value || 0
      const target = targetMatrix[ward.id]?.[xrayIndicatorId] || 0
      const gap = target > 0 ? Math.max(0, target - value) : 0
      const progress = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
      return { wardId: ward.id, wardName: ward.name, membership: ward.membership_count || 0, value, target, gap, progress }
    }).sort((a, b) => b.progress - a.progress) // Ordenar pelo progresso (melhor primeiro)
  }, [rpcData, xrayIndicatorId, wards, indicators, targetMatrix])

  const xrayIndicatorSlug = indicators.find(i => i.id === xrayIndicatorId)?.slug || ''

  // ─── Ações ───
  const handlePrintXRay = () => {
    setIsPrintingXRay(true)
    setTimeout(() => { window.print(); setIsPrintingXRay(false) }, 300)
  }

  const handleGenerateAI = async () => {
    if (wardMetrics.length === 0) return
    setAiLoading(true); setAiResult(null); setDisplayedAiResult(null)
    try {
      const startHist = new Date(); startHist.setDate(startHist.getDate() - 90)
      const { data: history } = await supabase.rpc('get_report_data', {
        p_start: startHist.toISOString().split('T')[0],
        p_end: new Date().toISOString().split('T')[0],
      })
      const wardName = selectedWardId === STAKE_ID
        ? 'Estaca Santa Cruz do Sul (Consolidado)'
        : (wards.find(w => w.id === selectedWardId)?.name || 'Unidade')
      const historyFiltered = selectedWardId === STAKE_ID
        ? (history || [])
        : (history || []).filter((h: any) => h.ward_id === selectedWardId)

      const payload = {
        unidade: wardName,
        data_analise: new Date().toLocaleDateString('pt-BR'),
        periodo_selecionado: PERIOD_LABELS[selectedPeriod],
        metricas_atuais: wardMetrics.map(m => ({
          indicador: m.display_name, valor_atual: m.value, meta: m.target,
          progresso: m.progress, distancia_meta: m.gap,
        })),
        historico_90_dias: historyFiltered.map((h: any) => ({
          indicador: h.display_name, data: h.week_start, valor: h.raw_value,
        })),
      }
      const response = await fetch('/api/ai/analise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(err.error || `HTTP ${response.status}`)
      }
      const json = await response.json()
      setAiResult(json.analise || 'A análise não retornou conteúdo.')
    } catch (error) {
      console.error('Erro webhook IA:', error)
      setAiResult('Ocorreu um erro ao comunicar com a inteligência artificial. Tente novamente.')
    } finally { setAiLoading(false) }
  }

  const handleGenerateSumoBriefing = async () => {
    if (wardMetrics.length === 0) return
    setSumoBriefingLoading(true)
    try {
      const period = selectedPeriod === 'custom' ? 'current_month' : selectedPeriod
      const cfg: ReportConfig = {
        id: 'sumo-dashboard',
        name: `Relatório do Sumo — ${selectedWardName}`,
        recipient_whatsapp: '',
        frequency: 'daily',
        send_time: '08:00',
        send_day: null,
        indicators: [],
        ward_ids: selectedWardId === STAKE_ID ? [] : [selectedWardId],
        period,
        include_targets: true,
        include_ranking: false,
        is_active: false,
        report_type: 'sumo_briefing',
      }
      const supabase = createClient()
      const doc = await buildReportPdf(supabase, cfg)
      doc.save(safeFileName(cfg.name))
      // Salva no histórico
      const { data: session } = await supabase.auth.getSession()
      if (session.session?.user?.id) {
        await supabase.from('generated_documents').insert({
          user_id: session.session.user.id,
          name: cfg.name,
          report_type: cfg.report_type,
          ward_name: selectedWardName,
        })
      }
    } catch (error) {
      console.error('Erro relatório do sumo:', error)
    } finally { setSumoBriefingLoading(false) }
  }

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════

  const selectedWardName = selectedWardId === STAKE_ID
    ? 'Estaca Santa Cruz do Sul'
    : (wards.find(w => w.id === selectedWardId)?.name || '')

  return (
    <main className={`w-full min-h-screen font-sans ${isPrintingXRay ? 'is-printing-xray print:bg-white print:overflow-visible' : ''}`}>
      <div className="w-full mx-auto space-y-8 print:space-y-4 print:overflow-visible">
        
        {/* HEADER */}
        <header className="pt-2 pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hide-on-xray-print">
          <div className="text-center md:text-left">
            <h1 className="text-2xl md:text-4xl font-black tracking-tight leading-tight" style={{ color: COLORS.title }}>Dashboard</h1>
            <p className="text-slate-500 font-bold uppercase text-[10px] md:text-xs tracking-widest mt-1">Análise & Performance</p>
          </div>
          <div className="relative group flex justify-center md:justify-end">
            <button className="flex items-center gap-2 px-5 py-2.5 bg-[#0069a8] text-white font-bold text-xs rounded-xl hover:bg-[#00588d] transition-all shadow-lg">
              <FileText size={16} /> Exportar Relatórios
              <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
            </button>
            <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button onClick={() => router.push('/relatorio')} className="w-full text-left px-4 py-3 hover:bg-sky-50 flex items-center gap-3 transition-colors">
                <FileText size={16} className="text-[#0069a8] shrink-0" /><div><p className="text-sm font-bold text-slate-700">Relatório Visual</p><p className="text-[10px] text-slate-400">Imprimir Estaca / PDF</p></div>
              </button>
              <div className="mx-3 my-1 border-t border-slate-100" />
              <button onClick={() => router.push('/relatorio?csv=1')} className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex items-center gap-3 transition-colors">
                <FileSpreadsheet size={16} className="text-emerald-600 shrink-0" /><div><p className="text-sm font-bold text-slate-700">Dados Brutos</p><p className="text-[10px] text-slate-400">CSV para Excel</p></div>
              </button>
            </div>
          </div>
        </header>

        {/* BLOCO 1: VISÃO GERAL */}
        <section className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm md:shadow-xl overflow-hidden p-4 md:p-8 hide-on-xray-print">
          <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-sky-600" /><h2 className="text-lg font-black text-slate-700">Visão Geral da Estaca</h2></div>
            <div className="relative flex flex-col items-end gap-2 w-full md:w-auto">
              <div className="flex p-1 bg-slate-100 rounded-xl overflow-hidden w-full md:w-auto overflow-x-auto shrink-0">
                {PERIOD_OPTIONS.map((p) => (
                  <button key={p} onClick={() => {
                    if (p === 'custom') {
                      setShowCustomDatePicker(true)
                      setSelectedPeriod('custom')
                    } else {
                      setShowCustomDatePicker(false)
                      setSelectedPeriod(p)
                    }
                  }}
                    className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-lg text-[10px] md:text-xs font-black transition-all whitespace-nowrap flex items-center gap-1 justify-center ${
                      selectedPeriod === p ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}>
                    {p === 'custom' && <CalendarRange size={12} />}
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Date picker personalizado */}
              {showCustomDatePicker && selectedPeriod === 'custom' && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 w-72 animate-in slide-in-from-top-2 fade-in duration-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Período Personalizado</span>
                    <button onClick={() => setShowCustomDatePicker(false)} className="text-slate-300 hover:text-slate-500 p-1"><X size={14} /></button>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">De:</label>
                      <input type="date" value={customDateStart}
                        onChange={(e) => setCustomDateStart(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Até:</label>
                      <input type="date" value={customDateEnd}
                        onChange={(e) => setCustomDateEnd(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all" />
                    </div>
                    <button
                      onClick={() => {
                        if (customDateStart && customDateEnd) setShowCustomDatePicker(false)
                      }}
                      disabled={!customDateStart || !customDateEnd}
                      className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs py-2.5 rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      Aplicar Filtro
                    </button>
                  </div>
                  {customDateStart && customDateEnd && (
                    <p className="text-[10px] text-slate-400 font-medium text-center mt-2">
                      {new Date(customDateStart + 'T12:00:00').toLocaleDateString('pt-BR')} — {new Date(customDateEnd + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className={`grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6 ${loading ? 'opacity-50' : ''}`}>
            {mainCards.map((card) => (
              <div key={card.id} className="group bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm hover:border-sky-200 hover:shadow-md transition-all flex flex-col justify-between h-full min-h-[160px]">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex flex-col">
                    <span className="text-[9px] md:text-xs font-black text-slate-500 uppercase tracking-wide leading-3 pr-1 line-clamp-3">{card.display_name}</span>
                    <span className="text-[8px] md:text-[10px] text-slate-400 font-medium mt-1">{card.subtitle}</span>
                  </div>
                  <div className="p-1.5 md:p-3 bg-slate-50 group-hover:bg-sky-50 rounded-lg md:rounded-2xl transition-colors shrink-0">{ICON_MAP[card.slug]}</div>
                </div>
                <div className="mt-2 mb-2"><p className="text-2xl md:text-4xl font-black text-slate-800 tracking-tight group-hover:text-sky-700 transition-colors">{card.value}</p></div>
                <div className="mt-auto pt-3 border-t border-slate-50 grid grid-cols-2 gap-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1 mb-0.5"><Trophy className="w-3 h-3 text-amber-500" /><span className="text-[8px] font-bold text-slate-400 uppercase">Destaque</span></div>
                    <span className="text-[9px] font-bold text-slate-700 truncate" title={card.bestWard}>{card.bestWard}</span>
                    <span className="text-[9px] text-slate-400">{card.bestValue}</span>
                  </div>
                  <div className="flex flex-col border-l border-slate-50 pl-2">
                    <div className="flex items-center gap-1 mb-0.5"><AlertCircle className="w-3 h-3 text-rose-400" /><span className="text-[8px] font-bold text-slate-400 uppercase">Atenção</span></div>
                    <span className="text-[9px] font-bold text-slate-700 truncate" title={card.worstWard}>{card.worstWard}</span>
                    <span className="text-[9px] text-slate-400">{card.worstValue}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BLOCO 2: GRÁFICO DE EVOLUÇÃO — com Estaca */}
        <section className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm md:shadow-xl overflow-hidden hide-on-xray-print">
          <div className="p-4 md:p-8 bg-sky-50/30 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="p-2 bg-sky-100 rounded-lg text-sky-600"><TrendingUp className="w-5 h-5" /></div>
              <div><h2 className="text-lg md:text-xl font-black text-slate-800">Evolução Semanal</h2><p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase">Últimos 90 dias</p></div>
            </div>
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <select value={chartWardId} onChange={(e) => setChartWardId(e.target.value)}
                className="bg-white border border-slate-200 text-slate-700 text-[10px] md:text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block w-full p-2 font-bold shadow-sm">
                <option value={STAKE_ID}>📊 Estaca (Todas)</option>
                {wards.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
              </select>
              <select value={chartIndicatorId} onChange={(e) => setChartIndicatorId(e.target.value)}
                className="bg-white border border-slate-200 text-slate-700 text-[10px] md:text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block w-full p-2 font-bold shadow-sm">
                {indicators.map((i) => (<option key={i.id} value={i.id}>{i.display_name}</option>))}
              </select>
            </div>
          </div>
          <div className="p-4 md:p-8 h-72 md:h-96 relative">
            {isChartLoading && (<div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>)}
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} labelStyle={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }} />
                  <Line type="monotone" dataKey="valor" name={chartWardId === STAKE_ID ? 'Estaca Total' : 'Valor'}
                    stroke={COLORS.chartLine} strokeWidth={3} dot={{ r: 4, fill: COLORS.chartLine, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (<div className="flex h-full items-center justify-center text-slate-400 font-medium text-sm">Sem dados semanais para este filtro.</div>)}
          </div>
        </section>

        {/* BLOCO 3: RAIO-X — com Estaca */}
        <section className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm md:shadow-xl overflow-hidden print:overflow-visible xray-section print:shadow-none print:border-none">
          <div className="p-4 md:px-8 md:pt-6 md:pb-0 bg-slate-50/50 border-b border-slate-100 hide-on-xray-print">
            {/* Linha 1: Título + Ações + Select */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 shrink-0">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 print:hidden"><Search className="w-5 h-5" /></div>
                <h2 className="text-lg md:text-xl font-black text-slate-800">Raio-X da Unidade</h2>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button onClick={handleGenerateAI} disabled={aiLoading || isTyping}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] md:text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 shrink-0">
                  {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  <span className="hidden sm:inline">Análise IA</span><span className="sm:hidden">IA</span>
                </button>
                <button onClick={handleGenerateSumoBriefing} disabled={sumoBriefingLoading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] md:text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 shrink-0">
                  {sumoBriefingLoading ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
                  <span className="hidden sm:inline">Relatório do Sumo</span><span className="sm:hidden">Sumo</span>
                </button>
                <button onClick={handlePrintXRay}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-[10px] md:text-xs font-bold rounded-lg transition-colors shadow-sm shrink-0">
                  <Printer size={14} /><span className="hidden sm:inline">Exportar Raio-X</span><span className="sm:hidden">PDF</span>
                </button>
                <select value={selectedWardId} onChange={(e) => setSelectedWardId(e.target.value)}
                  className="bg-white border border-slate-300 text-slate-700 text-xs md:text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 p-2 font-bold min-w-[140px] shrink-0">
                  <option value={STAKE_ID}>Estaca (Todas)</option>
                  {wards.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
                </select>
              </div>
            </div>

            {/* Linha 2: Filtros de período — largura total, alinhados */}
            <div className="relative print:hidden pb-4">
              <div className="flex p-1 bg-slate-100 rounded-xl w-full overflow-x-auto">
                {PERIOD_OPTIONS.map((p) => (
                  <button key={p} onClick={() => {
                    if (p === 'custom') {
                      setShowCustomDatePicker(true)
                      setSelectedPeriod('custom')
                    } else {
                      setShowCustomDatePicker(false)
                      setSelectedPeriod(p)
                    }
                  }}
                    className={`flex-1 px-2 md:px-4 py-2 rounded-lg text-[10px] md:text-xs font-black transition-all whitespace-nowrap flex items-center gap-1 justify-center ${
                      selectedPeriod === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}>
                    {p === 'custom' && <CalendarRange size={11} />}
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Date picker inline para custom */}
              {showCustomDatePicker && selectedPeriod === 'custom' && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 w-72 animate-in slide-in-from-top-2 fade-in duration-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Período Personalizado</span>
                    <button onClick={() => setShowCustomDatePicker(false)} className="text-slate-300 hover:text-slate-500 p-1"><X size={14} /></button>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">De:</label>
                      <input type="date" value={customDateStart} onChange={(e) => setCustomDateStart(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Até:</label>
                      <input type="date" value={customDateEnd} onChange={(e) => setCustomDateEnd(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all" />
                    </div>
                    <button onClick={() => { if (customDateStart && customDateEnd) setShowCustomDatePicker(false) }}
                      disabled={!customDateStart || !customDateEnd}
                      className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs py-2.5 rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      Aplicar Filtro
                    </button>
                  </div>
                  {customDateStart && customDateEnd && (
                    <p className="text-[10px] text-slate-400 font-medium text-center mt-2">
                      {new Date(customDateStart + 'T12:00:00').toLocaleDateString('pt-BR')} — {new Date(customDateEnd + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Header impressão */}
          <div className="hidden print:block print:pt-6 print:pb-8 print:px-2">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 print:break-words">{selectedWardName}</h1>
            <p className="text-sm font-bold text-slate-500 mt-2 uppercase tracking-wider">Raio-X de Desempenho • {PERIOD_LABELS[selectedPeriod]}</p>
          </div>

          {/* IA */}
          {(displayedAiResult || aiLoading) && (
            <div className="m-4 md:m-8 p-5 bg-indigo-50 border border-indigo-100 rounded-2xl relative transition-all print:break-inside-avoid print:m-0 print:mb-6 print:border-indigo-300">
              <div className="flex items-center gap-2 mb-3 text-indigo-700">
                <Bot size={20} /><h3 className="font-black text-sm">Insights da Inteligência Artificial</h3>
                {aiLoading && <Loader2 size={14} className="animate-spin ml-2 text-indigo-400" />}
              </div>
              <p className="text-sm text-indigo-900 font-medium whitespace-pre-wrap leading-relaxed min-h-[20px]">
                {displayedAiResult}
                {isTyping && <span className="animate-pulse inline-block w-1.5 h-4 ml-0.5 bg-indigo-600 align-middle print:hidden"></span>}
                {aiLoading && !displayedAiResult && <span className="animate-pulse text-indigo-400">Analisando os dados...</span>}
              </p>
            </div>
          )}

          {/* Cards do Raio-X */}
          <div className="p-4 md:p-8 print:p-0 print:overflow-visible">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-2 print:gap-4 print:overflow-visible">
              {wardMetrics.map((metric) => (
                <div key={metric.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative overflow-hidden print:border-slate-300 print:break-inside-avoid print:shadow-none">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="text-slate-400 scale-75 origin-left">{ICON_MAP[metric.slug]}</div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate max-w-[120px] print:max-w-[180px]" title={metric.display_name}>{metric.display_name}</span>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-2xl font-black text-slate-800">{metric.value}</span>
                    <div className="text-right">
                      <span className="block text-[10px] text-slate-400 uppercase font-bold">Meta</span>
                      <span className="text-sm font-bold text-slate-600">{metric.target}</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2 print:border print:border-slate-300 print:bg-transparent">
                    <div className={`h-1.5 rounded-full print:bg-slate-500 ${metric.progress >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${metric.progress}%` }}></div>
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-bold">
                    <span className={metric.progress >= 100 ? 'text-emerald-600 print:text-slate-800' : 'text-sky-600 print:text-slate-800'}>{metric.progress}% Concluído</span>
                    {metric.target > 0 && metric.gap > 0 ? (
                      <span className="text-rose-500 print:text-slate-600">Faltam {metric.gap}</span>
                    ) : (metric.target > 0 && <span className="text-emerald-500 print:text-slate-800">Meta Batida!</span>)}
                  </div>
                </div>
              ))}
              {wardMetrics.length === 0 && (<div className="col-span-full text-center py-10 text-slate-400 text-sm font-medium">Selecione uma unidade para ver o Raio-X.</div>)}
            </div>
          </div>
        </section>

        {/* BLOCO 4: RAIO-X POR INDICADOR */}
        <section className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm md:shadow-xl overflow-hidden hide-on-xray-print">
          <div className="p-4 md:px-8 md:pt-6 md:pb-0 bg-emerald-50/30 border-b border-slate-100">
            {/* Linha 1: Título + Select */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 shrink-0">
                <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600"><BarChart3 className="w-5 h-5" /></div>
                <div>
                  <h2 className="text-lg md:text-xl font-black text-slate-800">Raio-X por Indicador</h2>
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase">Comparativo entre unidades</p>
                </div>
              </div>
              <select value={xrayIndicatorId} onChange={(e) => setXrayIndicatorId(e.target.value)}
                className="bg-white border border-slate-300 text-slate-700 text-xs md:text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 p-2.5 font-bold min-w-[200px] shadow-sm">
                {indicators.map((i) => (<option key={i.id} value={i.id}>{i.display_name}</option>))}
              </select>
            </div>

            {/* Linha 2: Filtros de período */}
            <div className="relative pb-4">
              <div className="flex p-1 bg-slate-100 rounded-xl w-full overflow-x-auto">
                {PERIOD_OPTIONS.map((p) => (
                  <button key={p} onClick={() => {
                    if (p === 'custom') {
                      setShowCustomDatePicker(true)
                      setSelectedPeriod('custom')
                    } else {
                      setShowCustomDatePicker(false)
                      setSelectedPeriod(p)
                    }
                  }}
                    className={`flex-1 px-2 md:px-4 py-2 rounded-lg text-[10px] md:text-xs font-black transition-all whitespace-nowrap flex items-center gap-1 justify-center ${
                      selectedPeriod === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}>
                    {p === 'custom' && <CalendarRange size={11} />}
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 md:p-8">
            {indicatorXRayData.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm font-medium">Selecione um indicador para comparar.</div>
            ) : (
              <>
                {/* Estaca total */}
                {(() => {
                  const stakeValue = indicatorXRayData.reduce((s, w) => s + w.value, 0)
                  const stakeTarget = indicatorXRayData.reduce((s, w) => s + w.target, 0)
                  const stakeProgress = stakeTarget > 0 ? Math.min(100, Math.round((stakeValue / stakeTarget) * 100)) : 0
                  const stakeGap = stakeTarget > 0 ? Math.max(0, stakeTarget - stakeValue) : 0
                  return (
                    <div className="bg-slate-800 rounded-2xl p-5 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="p-2.5 bg-white/10 rounded-xl">
                          {ICON_MAP[xrayIndicatorSlug] || <BarChart3 className="w-6 h-6 text-white" />}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total da Estaca</p>
                          <p className="text-3xl md:text-4xl font-black text-white">{stakeValue.toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 md:gap-8">
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Meta</p>
                          <p className="text-xl font-black text-white">{stakeTarget.toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Progresso</p>
                          <p className={`text-xl font-black ${stakeProgress >= 100 ? 'text-emerald-400' : 'text-sky-400'}`}>{stakeProgress}%</p>
                        </div>
                        {stakeGap > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Faltam</p>
                            <p className="text-xl font-black text-rose-400">{stakeGap}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Cards por unidade */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {indicatorXRayData.map((ward, idx) => {
                    const isTop = idx === 0
                    const isBottom = idx === indicatorXRayData.length - 1
                    return (
                      <div key={ward.wardId} className={`rounded-xl p-4 border relative overflow-hidden transition-all ${
                        isTop ? 'bg-emerald-50 border-emerald-200' :
                        isBottom ? 'bg-rose-50 border-rose-200' :
                        'bg-slate-50 border-slate-100'
                      }`}>
                        {/* Badge de posição */}
                        <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                          isTop ? 'bg-emerald-600 text-white' :
                          isBottom ? 'bg-rose-500 text-white' :
                          'bg-slate-200 text-slate-500'
                        }`}>
                          {idx + 1}
                        </div>

                        {/* Nome da ala */}
                        <div className="mb-3 pr-8">
                          <span className={`text-[10px] font-black uppercase tracking-wider ${
                            isTop ? 'text-emerald-700' : isBottom ? 'text-rose-700' : 'text-slate-500'
                          }`}>{ward.wardName}</span>
                          <span className="text-[9px] text-slate-400 block">{ward.membership} membros</span>
                        </div>

                        {/* Valor */}
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-2xl font-black text-slate-800">{ward.value}</span>
                          <div className="text-right">
                            <span className="block text-[10px] text-slate-400 uppercase font-bold">Meta</span>
                            <span className="text-sm font-bold text-slate-600">{ward.target}</span>
                          </div>
                        </div>

                        {/* Barra de progresso */}
                        <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                          <div className={`h-1.5 rounded-full ${
                            ward.progress >= 100 ? 'bg-emerald-500' :
                            isBottom ? 'bg-rose-500' : 'bg-sky-500'
                          }`} style={{ width: `${ward.progress}%` }}></div>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-between items-center text-[10px] font-bold">
                          <span className={
                            ward.progress >= 100 ? 'text-emerald-600' :
                            isBottom ? 'text-rose-500' : 'text-sky-600'
                          }>{ward.progress}%</span>
                          {ward.target > 0 && ward.gap > 0 ? (
                            <span className="text-rose-500">Faltam {ward.gap}</span>
                          ) : (ward.target > 0 && <span className="text-emerald-500">Meta Batida!</span>)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        {/* BLOCO 5: METAS */}
        <section className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm md:shadow-xl overflow-hidden hide-on-xray-print">
          <div className="p-4 md:p-8 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between bg-slate-50/50 gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="p-2 md:p-3 bg-amber-50 rounded-xl shrink-0"><Target className="w-5 h-5 md:w-6 md:h-6 text-amber-600" /></div>
              <div><h2 className="text-base md:text-2xl font-black text-slate-800">Metas {selectedYear}</h2></div>
            </div>
            <div className="flex gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-sm w-full md:w-auto overflow-x-auto shrink-0">
              {[2025, 2026, 2027].map((year) => (
                <button key={year} onClick={() => setSelectedYear(year)}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-md text-[10px] md:text-sm font-black transition-all whitespace-nowrap ${selectedYear === year ? 'bg-sky-700 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {year}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto relative pb-2">
            {wards.length === 0 ? (
              <div className="p-8 text-center text-slate-400 font-bold text-xs">Carregando...</div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-100/50">
                    <th className="sticky left-0 bg-slate-100 z-20 p-3 text-[9px] md:text-xs font-black text-slate-500 uppercase tracking-widest border-b border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] min-w-[100px]">Unidade</th>
                    {indicators.map((ind) => (
                      <th key={ind.id} className="p-2 md:p-3 text-center align-bottom border-b border-slate-200 min-w-[70px] md:min-w-[100px]">
                        <div className="flex flex-col items-center justify-end w-full gap-1.5">
                          <div className="shrink-0">{ICON_MAP[ind.slug]}</div>
                          <span className="hidden md:block text-[10px] lg:text-[11px] leading-3 font-bold text-slate-600 uppercase tracking-tight w-full max-w-[120px] whitespace-normal break-words line-clamp-2">{ind.display_name}</span>
                          <span className="md:hidden truncate text-[9px] font-semibold text-slate-500 w-full max-w-[60px]">{ind.display_name}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-sky-50/30 border-b border-sky-100">
                    <td className="sticky left-0 bg-sky-50 z-10 p-3 border-r border-sky-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      <span className="font-black text-sky-800 uppercase text-[9px] md:text-xs">Total</span>
                    </td>
                    {indicators.map((ind) => (
                      <td key={ind.id} className="p-3 text-center"><span className="text-sm md:text-xl font-black text-sky-900">{stakeTotals[ind.id] || 0}</span></td>
                    ))}
                  </tr>
                  {wards.map((ward) => (
                    <tr key={ward.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                      <td className="sticky left-0 bg-white hover:bg-slate-50 z-10 p-3 font-bold text-slate-700 text-[10px] md:text-sm border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">{ward.name}</td>
                      {indicators.map((ind) => (
                        <td key={ind.id} className="p-3 text-center font-bold text-slate-600 text-xs md:text-base">
                          {targetMatrix[ward.id]?.[ind.id] !== undefined ? targetMatrix[ward.id][ind.id] : <span className="text-slate-300">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* FOOTER */}
        <footer className="py-8 border-t border-slate-200 text-center opacity-50 space-y-2 hide-on-xray-print">
          <Church className="w-4 h-4 text-slate-400 mx-auto mb-2" />
          <p className="text-[10px] text-slate-500 font-medium">Este sistema não é um produto oficial da Igreja de Jesus Cristo dos Santos dos Últimos Dias.</p>
          <p className="text-[9px] text-slate-400 font-mono">Versão 1.7.0</p>
        </footer>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          html, body { height: auto !important; overflow: visible !important; background: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { margin: 15mm 10mm; size: A4 portrait; }
          .is-printing-xray .hide-on-xray-print { display: none !important; }
          .is-printing-xray .xray-section { box-shadow: none !important; border: none !important; padding: 0 !important; overflow: visible !important; display: block !important; }
          .print\\:break-inside-avoid { page-break-inside: avoid !important; break-inside: avoid !important; }
        }
      `}} />
    </main>
  )
}