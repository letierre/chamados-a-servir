'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '../../lib/supabase/client'
import {
  Brain, Sparkles, Loader2, Clock, RefreshCw,
  AlertCircle, CheckCircle2, Trophy, TriangleAlert, Lightbulb,
  ChevronDown, ChevronUp, Calendar,
} from 'lucide-react'

type Analysis = {
  id: string
  generated_at: string
  week_start: string
  content: string
  trigger_type: string
}

// ─── Seção parseada ──────────────────────────────────────────────────
type SectionType = 'positive' | 'alert' | 'action' | 'other'

type Section = {
  title: string
  type: SectionType
  items: string[]  // cada bullet já sem o "- "
}

function detectType(title: string): SectionType {
  const t = title.toLowerCase()
  if (t.includes('destaque') || t.includes('positiv')) return 'positive'
  if (t.includes('alert') || t.includes('atenção')) return 'alert'
  if (t.includes('ação') || t.includes('açoes') || t.includes('ações') || t.includes('conselho')) return 'action'
  return 'other'
}

function parseAnalysis(content: string): Section[] {
  const lines = content.split('\n')
  const sections: Section[] = []
  let current: Section | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Heading: **Texto**
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      if (current) sections.push(current)
      const title = line.slice(2, -2)
      current = { title, type: detectType(title), items: [] }
      continue
    }

    // Bullet
    if (line.startsWith('- ')) {
      if (!current) current = { title: '', type: 'other', items: [] }
      current.items.push(line.slice(2))
      continue
    }

    // Parágrafo solto → adiciona como item à seção atual ou cria seção genérica
    if (current) {
      current.items.push(line)
    } else {
      sections.push({ title: '', type: 'other', items: [line] })
    }
  }

  if (current) sections.push(current)
  return sections.filter(s => s.items.length > 0)
}

// ─── Estilos por tipo de seção ───────────────────────────────────────
const SECTION_STYLES: Record<SectionType, {
  card: string; header: string; icon: React.ReactNode; bullet: string; text: string; titleColor: string
}> = {
  positive: {
    card: 'bg-emerald-50 border-emerald-200',
    header: 'bg-emerald-100/70 border-b border-emerald-200',
    icon: <Trophy size={16} className="text-emerald-600" />,
    bullet: 'bg-emerald-400',
    text: 'text-emerald-900',
    titleColor: 'text-emerald-800',
  },
  alert: {
    card: 'bg-amber-50 border-amber-200',
    header: 'bg-amber-100/70 border-b border-amber-200',
    icon: <TriangleAlert size={16} className="text-amber-600" />,
    bullet: 'bg-amber-400',
    text: 'text-amber-900',
    titleColor: 'text-amber-800',
  },
  action: {
    card: 'bg-sky-50 border-sky-200',
    header: 'bg-sky-100/70 border-b border-sky-200',
    icon: <Lightbulb size={16} className="text-sky-600" />,
    bullet: 'bg-sky-400',
    text: 'text-sky-900',
    titleColor: 'text-sky-800',
  },
  other: {
    card: 'bg-slate-50 border-slate-200',
    header: 'bg-slate-100/70 border-b border-slate-200',
    icon: <Brain size={16} className="text-slate-500" />,
    bullet: 'bg-slate-400',
    text: 'text-slate-700',
    titleColor: 'text-slate-700',
  },
}

// ─── renderiza inline bold ────────────────────────────────────────────
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>
      : part
  )
}

// ─── card de uma seção ───────────────────────────────────────────────
function SectionCard({ section }: { section: Section }) {
  const s = SECTION_STYLES[section.type]
  return (
    <div className={`rounded-2xl border overflow-hidden ${s.card}`}>
      {section.title && (
        <div className={`px-4 py-3 flex items-center gap-2 ${s.header}`}>
          {s.icon}
          <span className={`font-black text-xs uppercase tracking-wider ${s.titleColor}`}>
            {section.title}
          </span>
        </div>
      )}
      <div className="p-4 space-y-3">
        {section.items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${s.bullet}`} />
            <p className={`text-sm leading-relaxed ${s.text}`}>
              {renderInline(item)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── análise completa ────────────────────────────────────────────────
function FullAnalysis({ analysis }: { analysis: Analysis }) {
  const sections = parseAnalysis(analysis.content)
  const weekLabel = new Date(analysis.week_start + 'T12:00:00')
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  const generatedAt = new Date(analysis.generated_at)
    .toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    })

  return (
    <div className="space-y-4">
      {/* Hero header */}
      <div className="rounded-2xl overflow-hidden border border-indigo-200 shadow-sm">
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Brain size={20} className="text-indigo-200" />
                <span className="text-indigo-200 text-xs font-bold uppercase tracking-widest">
                  Análise da Estaca
                </span>
              </div>
              <h2 className="text-white font-black text-lg leading-tight capitalize">
                Semana de {weekLabel}
              </h2>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="px-2.5 py-1 bg-white/15 text-white text-[10px] font-bold rounded-full">
                {analysis.trigger_type === 'cron' ? 'Automática' : 'Manual'}
              </span>
            </div>
          </div>
        </div>
        <div className="bg-indigo-50 px-6 py-2.5 flex items-center gap-2 border-t border-indigo-200">
          <Clock size={12} className="text-indigo-400" />
          <span className="text-xs text-indigo-500">Gerada em {generatedAt}</span>
        </div>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-1 gap-4">
        {sections.map((s, i) => (
          <SectionCard key={i} section={s} />
        ))}
      </div>
    </div>
  )
}

// ─── card histórico (colapsável) ─────────────────────────────────────
function HistoryCard({ analysis }: { analysis: Analysis }) {
  const [expanded, setExpanded] = useState(false)
  const sections = parseAnalysis(analysis.content)
  const weekLabel = new Date(analysis.week_start + 'T12:00:00')
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  const generatedAt = new Date(analysis.generated_at)
    .toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    })

  // Contagem de seções por tipo para o resumo
  const alertCount = sections.filter(s => s.type === 'alert').flatMap(s => s.items).length
  const positiveCount = sections.filter(s => s.type === 'positive').flatMap(s => s.items).length

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-5 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Calendar size={16} className="text-slate-500" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="font-bold text-slate-800 text-sm capitalize truncate">
            Semana de {weekLabel}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            {alertCount > 0 && (
              <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                <TriangleAlert size={10} /> {alertCount} {alertCount === 1 ? 'alerta' : 'alertas'}
              </span>
            )}
            {positiveCount > 0 && (
              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                <Trophy size={10} /> {positiveCount} {positiveCount === 1 ? 'destaque' : 'destaques'}
              </span>
            )}
            <span className="text-[10px] text-slate-400">{generatedAt}</span>
          </div>
        </div>
        <div className="text-slate-400 flex-shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-50 pt-4 space-y-3">
          {sections.map((s, i) => <SectionCard key={i} section={s} />)}
        </div>
      )}
    </div>
  )
}

// ─── página ──────────────────────────────────────────────────────────
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
      setSuccessMsg(`Análise gerada com sucesso.`)
      await loadAnalyses()
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar análise.')
    } finally {
      setGenerating(false)
    }
  }

  const latest = analyses[0]
  const history = analyses.slice(1)

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center shadow-sm border border-indigo-100">
              <Brain size={24} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Inteligência</h1>
              <p className="text-slate-400 text-sm mt-0.5">Análise cirúrgica da estaca por IA</p>
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto"
          >
            {generating
              ? <><Loader2 size={16} className="animate-spin" /> Gerando...</>
              : <><Sparkles size={16} /> Gerar agora</>}
          </button>
        </div>

        {/* Info */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-3.5 flex gap-3">
          <Clock size={15} className="text-indigo-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-indigo-700 leading-relaxed">
            Gerada automaticamente toda <strong>segunda-feira às 8h</strong> com base nas últimas 4 semanas de dados, tendências e ranking por ala.
          </p>
        </div>

        {/* Feedback */}
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
          <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-5">
              <div className="flex items-center gap-2 mb-3">
                <Loader2 size={18} className="text-indigo-200 animate-spin" />
                <span className="text-indigo-200 text-sm font-bold">Analisando dados da estaca...</span>
              </div>
              <div className="space-y-2">
                {[75, 55, 85, 45, 65].map((w, i) => (
                  <div key={i} className="h-2.5 bg-white/20 rounded-full animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
            <div className="px-6 py-4 space-y-3">
              {['emerald', 'amber', 'sky'].map(color => (
                <div key={color} className={`h-24 bg-${color}-50 rounded-xl border border-${color}-200 animate-pulse`} />
              ))}
              <p className="text-xs text-slate-400 text-center pt-1">Isso pode levar até 30 segundos</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-indigo-400" />
          </div>
        )}

        {/* Empty */}
        {!loading && !generating && analyses.length === 0 && !error && (
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

        {/* Latest analysis */}
        {!loading && !generating && latest && (
          <FullAnalysis analysis={latest} />
        )}

        {/* History */}
        {!loading && history.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Análises anteriores
              </h2>
              <button
                onClick={loadAnalyses}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                <RefreshCw size={12} /> Atualizar
              </button>
            </div>
            {history.map(a => <HistoryCard key={a.id} analysis={a} />)}
          </div>
        )}

      </div>
    </div>
  )
}
