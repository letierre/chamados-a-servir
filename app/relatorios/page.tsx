'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabase/client'
import {
  Bell, Plus, Pencil, Trash2, Send,
  X, Loader2, CheckCircle2, AlertCircle, Clock, MessageSquare, FileDown,
} from 'lucide-react'
import { buildReportPdf, safeFileName } from '../../lib/relatorios/build-pdf'
import type { ReportConfig as PdfReportConfig } from '../../lib/relatorios/build-message'

// ═══════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════

type Frequency = 'daily' | 'weekly' | 'monthly'
type Period = 'current_month' | 'last_month' | '90d' | '12m' | 'current_year'
type ReportType = 'summary' | 'nominal' | 'sumo_briefing'
type NominalSource = 'baptism' | 'returning' | 'missionary'
type GenderFilter = 'all' | 'M' | 'F'

type Ward = { id: string; name: string }
type Indicator = { id: string; slug: string; display_name: string; order_index: number }

type ReportConfig = {
  id: string
  name: string
  recipient_whatsapp: string
  frequency: Frequency
  send_time: string
  send_day: number | null
  indicators: string[]
  ward_ids: string[]
  period: Period
  include_targets: boolean
  include_ranking: boolean
  is_active: boolean
  report_type: ReportType
  nominal_source: NominalSource | null
  age_min: number | null
  age_max: number | null
  gender_filter: GenderFilter
  last_sent_at: string | null
  last_send_status: string | null
  created_at: string
  updated_at: string
}

type FormState = {
  id?: string
  name: string
  recipient_whatsapp: string
  frequency: Frequency
  send_time: string
  send_day: number
  indicators: string[]
  ward_ids: string[]
  period: Period
  include_targets: boolean
  include_ranking: boolean
  is_active: boolean
  report_type: ReportType
  nominal_source: NominalSource
  age_min: string
  age_max: string
  gender_filter: GenderFilter
}

// ═══════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════

const PERIOD_LABELS: Record<Period, string> = {
  current_month: 'Mês Atual',
  last_month: 'Mês Passado',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
  current_year: 'Ano Atual',
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const NOMINAL_SOURCE_LABELS: Record<NominalSource, string> = {
  baptism: 'Batismos',
  returning: 'Retornando',
  missionary: 'Missionários',
}

const DEFAULT_FORM: FormState = {
  name: '',
  recipient_whatsapp: '',
  frequency: 'weekly',
  send_time: '08:00',
  send_day: 1,
  indicators: [],
  ward_ids: [],
  period: '90d',
  include_targets: true,
  include_ranking: true,
  is_active: true,
  report_type: 'summary',
  nominal_source: 'baptism',
  age_min: '',
  age_max: '',
  gender_filter: 'all',
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ═══════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════

export default function RelatoriosPage() {
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [configs, setConfigs] = useState<ReportConfig[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [indicators, setIndicators] = useState<Indicator[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)

  const [pdfManualOpen, setPdfManualOpen] = useState(false)
  const [pdfManualForm, setPdfManualForm] = useState<FormState>(DEFAULT_FORM)
  const [pdfManualBuilding, setPdfManualBuilding] = useState(false)

  const [sendingId, setSendingId] = useState<string | null>(null)
  const [pdfId, setPdfId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [docHistory, setDocHistory] = useState<{ id: string; name: string; report_type: string; ward_name: string | null; created_at: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const showToast = useCallback((type: 'ok' | 'error', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4500)
  }, [])

  // ─── Carregar tudo ───
  const loadAll = useCallback(async () => {
    setLoading(true)
    const [cfgRes, indRes, wardRes] = await Promise.all([
      supabase.from('report_configs').select('*').order('created_at', { ascending: false }),
      supabase.from('indicators').select('id, slug, display_name, order_index').eq('active', true).order('order_index'),
      supabase.from('wards').select('id, name').eq('active', true).order('name'),
    ])
    if (cfgRes.data) setConfigs(cfgRes.data as ReportConfig[])
    if (indRes.data) setIndicators(indRes.data)
    if (wardRes.data) setWards(wardRes.data)
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadAll() }, [loadAll])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const { data: session } = await supabase.auth.getSession()
    if (!session.session?.user?.id) { setHistoryLoading(false); return }
    const { data } = await supabase
      .from('generated_documents')
      .select('id, name, report_type, ward_name, created_at')
      .eq('user_id', session.session.user.id)
      .order('created_at', { ascending: false })
      .limit(15)
    if (data) setDocHistory(data as any[])
    setHistoryLoading(false)
  }, [supabase])

  useEffect(() => { loadHistory() }, [loadHistory])

  // ─── Ações ───
  function openNew() {
    setForm({
      ...DEFAULT_FORM,
      indicators: indicators.map(i => i.slug),
    })
    setModalOpen(true)
  }

  function openEdit(cfg: ReportConfig) {
    setForm({
      id: cfg.id,
      name: cfg.name,
      recipient_whatsapp: cfg.recipient_whatsapp,
      frequency: cfg.frequency,
      send_time: cfg.send_time || '08:00',
      send_day: cfg.send_day ?? 1,
      indicators: cfg.indicators || [],
      ward_ids: cfg.ward_ids || [],
      period: cfg.period,
      include_targets: cfg.include_targets,
      include_ranking: cfg.include_ranking,
      is_active: cfg.is_active,
      report_type: cfg.report_type || 'summary',
      nominal_source: (cfg.nominal_source as NominalSource) || 'baptism',
      age_min: cfg.age_min !== null && cfg.age_min !== undefined ? String(cfg.age_min) : '',
      age_max: cfg.age_max !== null && cfg.age_max !== undefined ? String(cfg.age_max) : '',
      gender_filter: cfg.gender_filter || 'all',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return showToast('error', 'Dê um nome ao relatório.')
    if (!form.recipient_whatsapp.trim()) return showToast('error', 'Informe o número do WhatsApp.')
    if (form.report_type === 'summary' && form.indicators.length === 0) {
      return showToast('error', 'Selecione ao menos um indicador.')
    }

    setSaving(true)
    const isNominal = form.report_type === 'nominal'
    const isSumo = form.report_type === 'sumo_briefing'
    const payload = {
      name: form.name.trim(),
      recipient_whatsapp: form.recipient_whatsapp.replace(/\D/g, ''),
      frequency: form.frequency,
      send_time: form.send_time,
      send_day: form.frequency === 'daily' ? null : form.send_day,
      indicators: (isNominal || isSumo) ? [] : form.indicators,
      ward_ids: form.ward_ids,
      period: form.period,
      include_targets: isNominal ? false : form.include_targets,
      include_ranking: isNominal ? false : form.include_ranking,
      is_active: form.is_active,
      report_type: form.report_type,
      nominal_source: isNominal ? form.nominal_source : null,
      age_min: isNominal && form.age_min !== '' ? Number(form.age_min) : null,
      age_max: isNominal && form.age_max !== '' ? Number(form.age_max) : null,
      gender_filter: isNominal ? form.gender_filter : 'all',
    }

    const res = form.id
      ? await supabase.from('report_configs').update(payload).eq('id', form.id)
      : await supabase.from('report_configs').insert(payload)

    setSaving(false)

    if (res.error) return showToast('error', res.error.message)
    setModalOpen(false)
    showToast('ok', form.id ? 'Relatório atualizado.' : 'Relatório criado.')
    loadAll()
  }

  async function handleDelete(cfg: ReportConfig) {
    if (!confirm(`Excluir "${cfg.name}"?`)) return
    const { error } = await supabase.from('report_configs').delete().eq('id', cfg.id)
    if (error) return showToast('error', error.message)
    showToast('ok', 'Relatório excluído.')
    loadAll()
  }

  async function handleSendNow(cfg: ReportConfig) {
    setSendingId(cfg.id)
    try {
      const res = await fetch('/api/relatorios/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: cfg.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) showToast('error', data.error || `Falha (${res.status})`)
      else showToast('ok', 'Relatório enviado!')
      loadAll()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSendingId(null)
    }
  }

  async function handleDownloadPdf(cfg: ReportConfig) {
    setPdfId(cfg.id)
    try {
      const doc = await buildReportPdf(supabase, cfg as unknown as PdfReportConfig)
      doc.save(safeFileName(cfg.name))
      showToast('ok', 'PDF gerado!')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao gerar PDF')
    } finally {
      setPdfId(null)
    }
  }

  async function handleDeleteHistory(id: string) {
    await supabase.from('generated_documents').delete().eq('id', id)
    setDocHistory(prev => prev.filter(d => d.id !== id))
  }

  const REPORT_TYPE_LABELS: Record<string, string> = {
    summary: 'Resumo de Indicadores',
    nominal: 'Lista de Nomes',
    sumo_briefing: 'Relatório do Sumo',
  }

  function openPdfManual() {
    setPdfManualForm({
      ...DEFAULT_FORM,
      name: 'Relatório avulso',
      // pré-seleciona todos os indicadores quando for resumo
      indicators: indicators.map(i => i.slug),
    })
    setPdfManualOpen(true)
  }

  async function handleGenerateManualPdf() {
    if (!pdfManualForm.name.trim()) return showToast('error', 'Informe um título para o PDF.')
    if (pdfManualForm.report_type === 'summary' && pdfManualForm.indicators.length === 0) {
      return showToast('error', 'Selecione ao menos um indicador.')
    }
    setPdfManualBuilding(true)
    try {
      const cfg: PdfReportConfig = {
        id: 'manual',
        name: pdfManualForm.name.trim(),
        recipient_whatsapp: '',
        frequency: 'daily',
        send_time: '08:00',
        send_day: null,
        indicators: pdfManualForm.indicators,
        ward_ids: pdfManualForm.ward_ids,
        period: pdfManualForm.period,
        include_targets: pdfManualForm.include_targets,
        include_ranking: pdfManualForm.include_ranking,
        is_active: false,
        report_type: pdfManualForm.report_type,
        nominal_source: pdfManualForm.report_type === 'nominal' ? pdfManualForm.nominal_source : null,
        age_min: pdfManualForm.age_min ? Number(pdfManualForm.age_min) : null,
        age_max: pdfManualForm.age_max ? Number(pdfManualForm.age_max) : null,
        gender_filter: pdfManualForm.gender_filter,
      }
      const doc = await buildReportPdf(supabase, cfg)
      doc.save(safeFileName(cfg.name))
      // Salva no histórico
      const { data: session } = await supabase.auth.getSession()
      if (session.session?.user?.id) {
        const wardLabel = pdfManualForm.ward_ids.length === 0
          ? 'Estaca (todas as alas)'
          : pdfManualForm.ward_ids.map(id => wards.find(w => w.id === id)?.name).filter(Boolean).join(', ')
        await supabase.from('generated_documents').insert({
          user_id: session.session.user.id,
          name: cfg.name,
          report_type: cfg.report_type,
          ward_name: wardLabel || '—',
        })
      }
      showToast('ok', 'PDF gerado!')
      setPdfManualOpen(false)
      loadHistory()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao gerar PDF')
    } finally {
      setPdfManualBuilding(false)
    }
  }

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium max-w-sm ${
          toast.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {toast.type === 'ok' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#0e4f66] flex items-center gap-2">
            <MessageSquare className="w-7 h-7 text-sky-600" />
            Relatórios WhatsApp
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gerencie relatórios e envie manualmente via WhatsApp ou baixe em PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openPdfManual}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-sm transition-colors"
            title="Gera um PDF agora com filtros customizados, sem precisar salvar."
          >
            <FileDown size={18} />
            Gerar PDF
          </button>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl shadow-sm transition-colors"
          >
            <Plus size={18} />
            Novo Relatório
          </button>
        </div>
      </div>

      {/* Listagem */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando relatórios...
        </div>
      ) : configs.length === 0 ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center">
          <Bell className="w-12 h-12 text-sky-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-800">Nenhum relatório configurado ainda</h3>
          <p className="text-sm text-gray-500 mt-1">Configure um relatório ou gere um PDF na hora.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={openPdfManual}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
            >
              <FileDown size={18} /> Gerar PDF agora
            </button>
            <button
              onClick={openNew}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl"
            >
              <Plus size={18} /> Criar Relatório
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {configs.map(cfg => (
            <ReportCard
              key={cfg.id}
              cfg={cfg}
              indicators={indicators}
              wards={wards}
              sending={sendingId === cfg.id}
              generatingPdf={pdfId === cfg.id}
              onEdit={() => openEdit(cfg)}
              onDelete={() => handleDelete(cfg)}
              onSend={() => handleSendNow(cfg)}
              onDownloadPdf={() => handleDownloadPdf(cfg)}
            />
          ))}
        </div>
      )}

      {/* Histórico de documentos gerados */}
      {docHistory.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Histórico de Documentos</h3>
            <button onClick={loadHistory} className="text-xs text-sky-600 hover:text-sky-800 font-semibold">
              {historyLoading ? <Loader2 size={12} className="animate-spin inline" /> : 'Atualizar'}
            </button>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-2 font-semibold">Documento</th>
                  <th className="text-left px-4 py-2 font-semibold hidden sm:table-cell">Tipo</th>
                  <th className="text-left px-4 py-2 font-semibold hidden md:table-cell">Unidade</th>
                  <th className="text-left px-4 py-2 font-semibold hidden md:table-cell">Data</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {docHistory.map(doc => (
                  <tr key={doc.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-800 truncate max-w-[180px]">{doc.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell">{REPORT_TYPE_LABELS[doc.report_type] || doc.report_type}</td>
                    <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell truncate max-w-[150px]">{doc.ward_name || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden md:table-cell">
                      {new Date(doc.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDeleteHistory(doc.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Remover do histórico"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal — criar/editar relatório agendado */}
      {modalOpen && (
        <ReportModal
          form={form}
          setForm={setForm}
          wards={wards}
          indicators={indicators}
          saving={saving}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}

      {/* Modal — gerar PDF avulso (sem salvar) */}
      {pdfManualOpen && (
        <ReportModal
          form={pdfManualForm}
          setForm={setPdfManualForm}
          wards={wards}
          indicators={indicators}
          saving={pdfManualBuilding}
          onClose={() => setPdfManualOpen(false)}
          onSave={handleGenerateManualPdf}
          pdfMode
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════
// CARD DE RELATÓRIO
// ═══════════════════════════════════════

function ReportCard({
  cfg, indicators, wards, sending, generatingPdf,
  onEdit, onDelete, onSend, onDownloadPdf,
}: {
  cfg: ReportConfig
  indicators: Indicator[]
  wards: Ward[]
  sending: boolean
  generatingPdf: boolean
  onEdit: () => void
  onDelete: () => void
  onSend: () => void
  onDownloadPdf: () => void
}) {
  const indicatorNames = cfg.indicators
    .map(slug => indicators.find(i => i.slug === slug)?.display_name)
    .filter(Boolean) as string[]

  const wardLabel =
    cfg.ward_ids.length === 0
      ? 'Estaca (todas as alas)'
      : cfg.ward_ids
          .map(id => wards.find(w => w.id === id)?.name)
          .filter(Boolean)
          .join(', ')

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 truncate">{cfg.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{cfg.recipient_whatsapp}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <Clock size={14} className="text-sky-600 flex-shrink-0" />
          <span>{PERIOD_LABELS[cfg.period]}</span>
        </div>
        <div className="text-gray-600">
          <span className="text-xs text-gray-400">Para: </span>
          <span className="truncate">{wardLabel}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {cfg.report_type === 'nominal' ? (
          <>
            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full font-semibold">
              📋 {cfg.nominal_source ? NOMINAL_SOURCE_LABELS[cfg.nominal_source] : 'Lista'}
            </span>
            {(cfg.age_min !== null || cfg.age_max !== null) && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                {cfg.age_min ?? '—'}–{cfg.age_max ?? '—'} anos
              </span>
            )}
            {cfg.gender_filter && cfg.gender_filter !== 'all' && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                {cfg.gender_filter === 'M' ? 'Masculino' : 'Feminino'}
              </span>
            )}
          </>
        ) : cfg.report_type === 'sumo_briefing' ? (
          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full font-semibold">
            📝 Relatório do Sumo Conselheiro
          </span>
        ) : (
          <>
            {indicatorNames.slice(0, 3).map(n => (
              <span key={n} className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-full">
                {n.length > 22 ? n.slice(0, 20) + '…' : n}
              </span>
            ))}
            {indicatorNames.length > 3 && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                +{indicatorNames.length - 3}
              </span>
            )}
          </>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
        <span className="text-gray-400">Último envio:</span>{' '}
        <span className={cfg.last_send_status?.startsWith('error') ? 'text-rose-600 font-medium' : 'text-gray-700'}>
          {formatDateTime(cfg.last_sent_at)}
        </span>
        {cfg.last_send_status?.startsWith('error') && (
          <p className="text-rose-600 mt-1 text-[11px] truncate">{cfg.last_send_status}</p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onSend}
          disabled={sending || generatingPdf}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send size={14} />}
          {sending ? 'Enviando' : 'Enviar agora'}
        </button>
        <button
          onClick={onDownloadPdf}
          disabled={sending || generatingPdf}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          title="Gerar e baixar PDF deste relatório"
        >
          {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown size={14} />}
          PDF
        </button>
        <button
          onClick={onEdit}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          title="Editar"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
          title="Excluir"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// MODAL CRIAR/EDITAR
// ═══════════════════════════════════════

function ReportModal({
  form, setForm, wards, indicators, saving, onClose, onSave, pdfMode = false,
}: {
  form: FormState
  setForm: (f: FormState) => void
  wards: Ward[]
  indicators: Indicator[]
  saving: boolean
  onClose: () => void
  onSave: () => void
  pdfMode?: boolean
}) {
  const toggleIndicator = (slug: string) => {
    setForm({
      ...form,
      indicators: form.indicators.includes(slug)
        ? form.indicators.filter(s => s !== slug)
        : [...form.indicators, slug],
    })
  }

  const toggleWard = (id: string) => {
    setForm({
      ...form,
      ward_ids: form.ward_ids.includes(id)
        ? form.ward_ids.filter(w => w !== id)
        : [...form.ward_ids, id],
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {pdfMode ? 'Gerar PDF Avulso' : form.id ? 'Editar Relatório' : 'Novo Relatório'}
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Tipo do relatório */}
          <Field label="Tipo de relatório">
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'summary' as const, title: 'Resumo de Indicadores', desc: 'Números, metas e ranking' },
                { value: 'nominal' as const, title: 'Lista de Nomes', desc: 'Batismos, retornando, missionários' },
                { value: 'sumo_briefing' as const, title: 'Relatório do Sumo', desc: 'Indicadores e pauta para o conselho da ala' },
              ]).map(opt => {
                const active = form.report_type === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, report_type: opt.value })}
                    className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                      active
                        ? 'bg-sky-50 border-sky-400 ring-2 ring-sky-200'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`font-semibold text-sm ${active ? 'text-sky-800' : 'text-gray-800'}`}>
                      {opt.title}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Nome + Whatsapp */}
          <div className={`grid grid-cols-1 ${pdfMode ? '' : 'md:grid-cols-2'} gap-4`}>
            <Field label={pdfMode ? 'Título do PDF' : 'Nome do relatório'}>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={pdfMode ? 'Ex: Relatório de batismos — abril' : 'Ex: Resumo semanal estaca'}
                className="input"
              />
            </Field>
            {!pdfMode && (
              <Field label="WhatsApp (com DDI)">
                <input
                  type="text"
                  value={form.recipient_whatsapp}
                  onChange={e => setForm({ ...form, recipient_whatsapp: e.target.value })}
                  placeholder="5551999990000"
                  className="input font-mono"
                />
              </Field>
            )}
          </div>

          {/* Período */}
          <Field label="Período dos dados">
            <select
              value={form.period}
              onChange={e => setForm({ ...form, period: e.target.value as Period })}
              className="input"
            >
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
              ))}
            </select>
          </Field>

          {/* Indicadores (somente resumo) */}
          {form.report_type === 'summary' && (
            <Field label={`Indicadores (${form.indicators.length}/${indicators.length})`}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, indicators: indicators.map(i => i.slug) })}
                  disabled={form.indicators.length === indicators.length}
                  className="px-3 py-1 text-xs font-semibold rounded-lg border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, indicators: [] })}
                  disabled={form.indicators.length === 0}
                  className="px-3 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Limpar
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {indicators.map(ind => {
                  const checked = form.indicators.includes(ind.slug)
                  return (
                    <label
                      key={ind.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                        checked
                          ? 'bg-sky-50 border-sky-200 text-sky-800'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleIndicator(ind.slug)}
                        className="accent-sky-600"
                      />
                      <span className="truncate">{ind.display_name}</span>
                    </label>
                  )
                })}
              </div>
            </Field>
          )}

          {/* Fonte + filtros nominais (somente lista de nomes) */}
          {form.report_type === 'nominal' && (
            <>
              <Field label="Fonte dos nomes">
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(NOMINAL_SOURCE_LABELS) as NominalSource[]).map(src => {
                    const active = form.nominal_source === src
                    return (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setForm({ ...form, nominal_source: src })}
                        className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                          active
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-800 ring-2 ring-indigo-200'
                            : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        {NOMINAL_SOURCE_LABELS[src]}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Idade mínima">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={form.age_min}
                    onChange={e => setForm({ ...form, age_min: e.target.value })}
                    placeholder="Ex: 18"
                    className="input"
                    disabled={form.nominal_source === 'missionary'}
                  />
                </Field>
                <Field label="Idade máxima">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={form.age_max}
                    onChange={e => setForm({ ...form, age_max: e.target.value })}
                    placeholder="Ex: 30"
                    className="input"
                    disabled={form.nominal_source === 'missionary'}
                  />
                </Field>
                <Field label="Gênero">
                  <select
                    value={form.gender_filter}
                    onChange={e => setForm({ ...form, gender_filter: e.target.value as GenderFilter })}
                    className="input"
                  >
                    <option value="all">Todos</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                </Field>
              </div>
              {form.nominal_source === 'missionary' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠️ Missionários não possuem data de nascimento — filtro de idade é ignorado.
                </p>
              )}
            </>
          )}

          {/* Alas */}
          <Field label={`Alas (${form.ward_ids.length === 0 ? `Estaca — todas as ${wards.length}` : `${form.ward_ids.length} de ${wards.length}`})`}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, ward_ids: wards.map(w => w.id) })}
                disabled={form.ward_ids.length === wards.length}
                className="px-3 py-1 text-xs font-semibold rounded-lg border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Selecionar todas
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, ward_ids: [] })}
                disabled={form.ward_ids.length === 0}
                className="px-3 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Limpar (= estaca toda)
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {wards.map(w => {
                const checked = form.ward_ids.includes(w.id)
                return (
                  <label
                    key={w.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                      checked
                        ? 'bg-sky-50 border-sky-200 text-sky-800'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleWard(w.id)}
                      className="accent-sky-600"
                    />
                    <span className="truncate">{w.name}</span>
                  </label>
                )
              })}
            </div>
          </Field>

          {/* Toggles */}
          <div className="flex flex-wrap gap-6 pt-2">
            {form.report_type === 'summary' && (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.include_targets}
                    onChange={e => setForm({ ...form, include_targets: e.target.checked })}
                    className="accent-sky-600 w-4 h-4"
                  />
                  Incluir metas e progresso
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.include_ranking}
                    onChange={e => setForm({ ...form, include_ranking: e.target.checked })}
                    className="accent-sky-600 w-4 h-4"
                  />
                  Incluir ranking por ala
                </label>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-semibold text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={`inline-flex items-center gap-2 px-5 py-2 ${pdfMode ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'} text-white rounded-xl font-semibold text-sm disabled:opacity-60`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : pdfMode ? <FileDown size={16} /> : null}
            {pdfMode
              ? (saving ? 'Gerando PDF...' : 'Gerar PDF')
              : (saving ? 'Salvando...' : 'Salvar')}
          </button>
        </div>
      </div>

      {/* Estilos utilitários */}
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          background: white;
          font-size: 0.875rem;
          color: #111827;
          outline: none;
          transition: border-color 150ms, box-shadow 150ms;
        }
        :global(.input:focus) {
          border-color: #0284c7;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
        }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}
