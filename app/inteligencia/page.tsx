'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '../../lib/supabase/client'
import {
  Brain, Sparkles, Loader2, Clock, RefreshCw,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
} from 'lucide-react'

type Analysis = {
  id: string
  generated_at: string
  week_start: string
  content: string
  trigger_type: string
}

// ─── markdown renderer simples ───────────────────────────────────────
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    const k = key++

    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      const content = line.slice(2, -2)
      elements.push(
        <h3 key={k} className="font-black text-slate-800 text-sm mt-5 mb-2 first:mt-0">
          {content}
        </h3>
      )
      continue
    }

    if (line.startsWith('- ')) {
      const content = line.slice(2)
      elements.push(
        <div key={k} className="flex gap-2.5 mb-2">
          <span className="text-indigo-400 font-black mt-0.5 flex-shrink-0">•</span>
          <span className="text-slate-700 text-sm leading-relaxed">
            {renderInline(content)}
          </span>
        </div>
      )
      continue
    }

    if (line.trim() === '') {
      elements.push(<div key={k} className="h-1" />)
      continue
    }

    elements.push(
      <p key={k} className="text-slate-700 text-sm leading-relaxed mb-2">
        {renderInline(line)}
      </p>
    )
  }

  return elements
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function formatSunday(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

// ─── componente de análise individual ────────────────────────────────
function AnalysisCard({ analysis, isLatest }: { analysis: Analysis; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(isLatest)

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
      isLatest ? 'border-indigo-200 shadow-indigo-50' : 'border-slate-100'
    }`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isLatest && (
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black rounded-full uppercase flex-shrink-0">
              Mais recente
            </span>
          )}
          <div className="text-left min-w-0">
            <p className="font-bold text-slate-800 text-sm capitalize truncate">
              {formatSunday(analysis.week_start)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Gerada em {formatDate(analysis.generated_at)}
              {analysis.trigger_type === 'cron' && ' • automática'}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 text-slate-400">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-50">
          <div className="bg-indigo-50/60 rounded-xl p-5">
            {renderMarkdown(analysis.content)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── página principal ─────────────────────────────────────────────────
export default function InteligenciaPage() {
  const supabase = createClient()

  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadAnalyses = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_analyses')
      .select('id, generated_at, week_start, content, trigger_type')
      .order('generated_at', { ascending: false })
      .limit(8)
    if (error) {
      setError('Tabela de análises não encontrada. Execute o arquivo docs/ai-analise-migration.sql no Supabase antes de usar este módulo.')
    } else {
      setAnalyses(data ?? [])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadAnalyses() }, [loadAnalyses])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/ai/analise-estaca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_type: 'manual', save: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setSuccessMsg(`Análise gerada para a semana de ${formatSunday(json.week_start)}.`)
      await loadAnalyses()
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar análise.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center shadow-sm border border-indigo-100">
              <Brain size={24} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Inteligência</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                Análise cirúrgica da estaca gerada por IA
              </p>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto"
          >
            {generating
              ? <><Loader2 size={16} className="animate-spin" /> Gerando...</>
              : <><Sparkles size={16} /> Gerar agora</>
            }
          </button>
        </div>

        {/* Info box */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4 flex gap-3">
          <Clock size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-indigo-700 leading-relaxed">
            A análise é gerada automaticamente toda <strong>segunda-feira às 8h</strong> com base nos dados da semana anterior.
            Use <em>Gerar agora</em> para uma análise imediata com os dados mais recentes.
          </p>
        </div>

        {/* Feedback messages */}
        {successMsg && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
            <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-emerald-700">{successMsg}</p>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700">{error}</p>
          </div>
        )}

        {/* Generating skeleton */}
        {generating && (
          <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4 text-indigo-600">
              <Brain size={20} />
              <span className="font-bold text-sm">Analisando dados da estaca...</span>
            </div>
            <div className="space-y-3">
              {[80, 60, 90, 50, 70].map((w, i) => (
                <div key={i} className="h-3 bg-indigo-100 rounded-full animate-pulse" style={{ width: `${w}%` }} />
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-4">
              Isso pode levar até 30 segundos — buscando tendências e rankings por ala.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-indigo-400" />
          </div>
        )}

        {/* Empty state */}
        {!loading && !generating && analyses.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Brain size={36} className="text-indigo-300" />
            </div>
            <div>
              <p className="font-bold text-slate-700 text-lg">Nenhuma análise gerada ainda</p>
              <p className="text-slate-400 text-sm mt-1">
                Clique em <strong>Gerar agora</strong> para a primeira análise.
              </p>
            </div>
          </div>
        )}

        {/* Analysis list */}
        {!loading && analyses.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                Histórico — últimas {analyses.length} análises
              </h2>
              <button
                onClick={loadAnalyses}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                <RefreshCw size={13} /> Atualizar
              </button>
            </div>
            {analyses.map((a, i) => (
              <AnalysisCard key={a.id} analysis={a} isLatest={i === 0} />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
