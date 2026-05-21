'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'
import {
  AlertTriangle, CheckCircle2, ExternalLink,
  Loader2, Filter, Calendar, X,
} from 'lucide-react'

type PendingRow = {
  ward_id: string
  ward_name: string
  indicator_id: string
  indicator_name: string
  indicator_slug: string
  order_index: number
  week_start: string
  weeks_overdue: number
}

const THEME = {
  primary: '#0069a8',
  textTitle: '#157493',
}

function formatSunday(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

function urgencyBadge(weeks: number) {
  if (weeks === 0) return 'bg-slate-100 text-slate-500'
  if (weeks === 1) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function urgencyBorder(weeks: number) {
  if (weeks === 0) return 'border-l-slate-300'
  if (weeks === 1) return 'border-l-amber-400'
  return 'border-l-red-500'
}

function urgencyDot(weeks: number) {
  if (weeks === 0) return 'bg-slate-400'
  if (weeks === 1) return 'bg-amber-400'
  return 'bg-red-500'
}

export default function PendenciasPage() {
  const supabase = createClient()
  const router = useRouter()

  const [pending, setPending] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterWard, setFilterWard] = useState('')
  const [filterIndicator, setFilterIndicator] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.rpc('get_all_pending')
      if (data) setPending(data)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const uniqueWards = useMemo(() => {
    const map = new Map<string, string>()
    pending.forEach(r => map.set(r.ward_id, r.ward_name))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [pending])

  const uniqueIndicators = useMemo(() => {
    const map = new Map<string, string>()
    pending.forEach(r => map.set(r.indicator_id, r.indicator_name))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [pending])

  const filtered = useMemo(() => {
    return pending.filter(r => {
      if (filterWard && r.ward_id !== filterWard) return false
      if (filterIndicator && r.indicator_id !== filterIndicator) return false
      return true
    })
  }, [pending, filterWard, filterIndicator])

  const grouped = useMemo(() => {
    const groups = new Map<string, PendingRow[]>()
    filtered.forEach(r => {
      if (!groups.has(r.week_start)) groups.set(r.week_start, [])
      groups.get(r.week_start)!.push(r)
    })
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const hasFilters = filterWard || filterIndicator

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center shadow-sm border border-red-100">
            <AlertTriangle size={24} className="text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Pendências</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Lançamentos que ainda não foram registrados nem revisados
            </p>
          </div>
        </div>

        {/* Summary cards */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="text-3xl font-bold" style={{ color: THEME.primary }}>
                {filtered.length}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {filtered.length === 1 ? 'pendência' : 'pendências'}
                {hasFilters ? ' (filtradas)' : ' no total'}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="text-3xl font-bold text-slate-700">{grouped.length}</div>
              <div className="text-sm text-slate-500 mt-1">
                {grouped.length === 1 ? 'semana afetada' : 'semanas afetadas'}
              </div>
            </div>
            {!hasFilters && pending.length > 0 && (
              <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div className="text-3xl font-bold text-red-600">
                  {pending.filter(r => r.weeks_overdue >= 2).length}
                </div>
                <div className="text-sm text-slate-500 mt-1">com 2+ semanas de atraso</div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        {!loading && pending.length > 0 && (
          <div className="bg-white rounded-2xl px-4 py-3 border border-slate-100 shadow-sm flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Filter size={15} />
              <span className="text-sm font-medium">Filtrar</span>
            </div>
            <select
              value={filterWard}
              onChange={e => setFilterWard(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white text-slate-700"
            >
              <option value="">Todas as alas</option>
              {uniqueWards.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <select
              value={filterIndicator}
              onChange={e => setFilterIndicator(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white text-slate-700"
            >
              <option value="">Todos os indicadores</option>
              {uniqueIndicators.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            {hasFilters && (
              <button
                onClick={() => { setFilterWard(''); setFilterIndicator('') }}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={14} />
                Limpar
              </button>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={36} className="animate-spin text-sky-400" />
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-700">
                {hasFilters ? 'Nenhuma pendência encontrada para os filtros.' : 'Tudo em dia!'}
              </p>
              <p className="text-slate-400 text-sm mt-1">
                {hasFilters
                  ? 'Tente ajustar os filtros para ver outras pendências.'
                  : 'Não há lançamentos pendentes no histórico.'}
              </p>
            </div>
          </div>
        )}

        {/* Grouped weeks */}
        {!loading && grouped.map(([week, rows]) => {
          const overdue = rows[0].weeks_overdue
          return (
            <div
              key={week}
              className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden border-l-4 ${urgencyBorder(overdue)}`}
            >
              {/* Week header */}
              <div className="px-5 py-4 border-b border-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urgencyDot(overdue)}`} />
                  <Calendar size={15} className="text-slate-400" />
                  <span className="font-bold text-slate-700 capitalize text-sm">
                    {formatSunday(week)}
                  </span>
                  {overdue === 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-600 font-semibold">
                      Semana atual
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${urgencyBadge(overdue)}`}>
                    {overdue === 0
                      ? 'Em andamento'
                      : overdue === 1
                        ? '1 semana atrás'
                        : `${overdue} semanas atrás`}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {rows.length} {rows.length === 1 ? 'pendente' : 'pendentes'}
                  </span>
                </div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-50">
                {rows.map(row => (
                  <div
                    key={`${row.ward_id}-${row.indicator_id}`}
                    className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-slate-700 text-sm truncate block">
                        {row.ward_name}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-slate-500 text-sm truncate block">
                        {row.indicator_name}
                      </span>
                    </div>
                    <button
                      onClick={() => router.push(`/lancamentos?semana=${week}`)}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      style={{ color: THEME.primary }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#e8f4fb')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <ExternalLink size={13} />
                      Ir lançar
                    </button>
                  </div>
                ))}
              </div>

              {/* Footer: link to launch all in this week */}
              <div className="px-5 py-2.5 bg-slate-50/50 border-t border-slate-50">
                <button
                  onClick={() => router.push(`/lancamentos?semana=${week}`)}
                  className="text-xs font-semibold transition-colors"
                  style={{ color: THEME.textTitle }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  → Abrir semana de {new Date(week + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })} no painel de lançamentos
                </button>
              </div>
            </div>
          )
        })}

      </div>
    </div>
  )
}
