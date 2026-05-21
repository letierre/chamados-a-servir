'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'
import {
  Building2, Target, Calendar, Hash, Save, Loader2,
  AlertCircle, CheckCircle2, History, Clock, ExternalLink,
  Users, X, BookOpen, Plus, Trash2, UserPlus, ClipboardCheck,
  Eye, CalendarCheck, CalendarX2, Pencil
} from 'lucide-react'

// ═══════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════

const THEME = {
  primary: '#0069a8',
  primaryHover: '#00588d',
  textTitle: '#157493',
  bg: '#f8fafc',
}

// ═══════════════════════════════════════
// MAPEAMENTO DE LINKS DA IGREJA
// ═══════════════════════════════════════

const WARD_UNITS: Record<string, string> = {
  'Ala Cachoeira do Sul': '60208',
  'Ala Lajeado': '82252',
  'Ala Marina': '346136',
  'Ala Rio Pardo': '281441',
  'Ala Santa Cruz do Sul': '323306',
  'Ala Santa Cruz do Sul Campus': '331465',
  'Ala Venâncio Aires': '331686',
  'Ramo Estrela': '1547771',
}

const WARD_ORG_IDS: Record<string, string> = {
  'Ala Cachoeira do Sul': '1467',
  'Ala Lajeado': '29016',
  'Ala Marina': '20246',
  'Ala Rio Pardo': '14601',
  'Ala Santa Cruz do Sul': '7167',
  'Ala Santa Cruz do Sul Campus': '1218',
  'Ala Venâncio Aires': '33991',
  'Ramo Estrela': '4010323',
}

type LinkBuilder = (wardName: string) => string | null

const INDICATOR_LINKS: Record<string, LinkBuilder> = {
  frequencia_sacramental: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://lcr.churchofjesuschrist.org/report/sacrament-attendance?lang=por&unitNumber=${unit}` : null
  },
  membros_jejuando: (w) => {
    const org = WARD_ORG_IDS[w]
    return org ? `https://lcrffe.churchofjesuschrist.org/donations?orgId=${org}` : null
  },
  membros_participantes: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://bl.churchofjesuschrist.org/bp/pt/#/indicate-activity/297490/${unit}` : null
  },
  membros_retornando_a_igreja: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://lcr.churchofjesuschrist.org/one-work/progress-record?lang=por&unitNumber=${unit}&tab=returningMembers` : null
  },
  recomendacao_templo_com_investidura: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://lcr.churchofjesuschrist.org/temple/recommend/recommend-status?lang=por&type=REGULAR&status=active&unitNumber=${unit}` : null
  },
  recomendacao_templo_sem_investidura: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://lcr.churchofjesuschrist.org/temple/recommend/recommend-status?lang=por&type=REGULAR&status=active&unitNumber=${unit}` : null
  },
  batismo_converso: (w) => {
    const unit = WARD_UNITS[w]
    return unit ? `https://lcr.churchofjesuschrist.org/one-work/progress-record?lang=por&unitNumber=${unit}&tab=recentConverts` : null
  },
  missionario_servindo_missao_do_brasil: (_w) => {
    return 'https://missionaryrecommendations.churchofjesuschrist.org/recommendations/home/candidates?vctype=ft'
  },
}

const RECOMENDACAO_SLUGS = ['recomendacao_templo_com_investidura', 'recomendacao_templo_sem_investidura']

// Slugs nominais (sem campo numérico direto)
const NOMINAL_SLUGS = ['batismo_converso', 'membros_retornando_a_igreja', 'missionario_servindo_missao_do_brasil']

// ═══════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════

type Ward = { id: string; name: string; membership_count: number }
type Indicator = { id: string; display_name: string; slug: string; indicator_type: string }
type RecentEntry = {
  id: string; value: number; week_start: string
  wards: { name: string }; indicators: { display_name: string }
}
type Toast = { type: 'success' | 'error'; text: string } | null

type WeeklyStatusRow = {
  ward_id: string; ward_name: string
  indicator_id: string; indicator_name: string; indicator_slug: string
  order_index: number; launched: boolean; reviewed: boolean; value: number
}

// Tipo para domingos sem reunião
type SkipWeek = {
  id: string; week_date: string; reason: string; description: string; affects_slug: string
}

// Tipo para pessoa nominal (batismo/retornando)
// id e week_start_record só existem quando a linha foi carregada do banco;
// linhas novas (id undefined) usam o weekStart selecionado no formulário no save.
type NominalPerson = {
  id?: string
  name: string
  birth_date: string
  gender: string
  baptism_date: string
  week_start_record?: string
}

// Tipo para missionário
type MissionaryPerson = {
  id?: string
  name: string
  gender: string
  mission_start_date: string
  mission_end_date: string
  is_active?: boolean
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function getRecentSundays(count: number): string[] {
  const sundays: string[] = []
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  for (let i = 0; i < count; i++) {
    // Usar formatação local em vez de toISOString (que converte para UTC)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    sundays.push(`${yyyy}-${mm}-${dd}`)
    d.setDate(d.getDate() - 7)
  }
  return sundays
}

// ═══════════════════════════════════════
// VALIDAÇÃO
// ═══════════════════════════════════════

function validateForm(value: number, weekStart: string): string | null {
  if (!weekStart) return 'Selecione uma data.'
  if (isNaN(value) || value < 0) return 'Valor deve ser positivo.'
  if (value > 10000) return 'Valor parece muito alto. Verifique.'
  const today = new Date().toISOString().split('T')[0]
  if (weekStart > today) return 'Não é possível usar datas futuras.'
  const d = new Date(weekStart + 'T12:00:00')
  if (d.getDay() !== 0) return 'A data deve ser um domingo.'
  return null
}

// ═══════════════════════════════════════
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════

function ToastMessage({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  if (!toast) return null
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [toast, onClose])
  return (
    <div className="fixed top-6 right-6 z-[200] animate-in slide-in-from-top-3 fade-in duration-300">
      <div className={`flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border ${
        toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'
      }`}>
        {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
        <span className="font-bold text-sm">{toast.text}</span>
        <button onClick={onClose} className="ml-2 opacity-50 hover:opacity-100"><X size={14} /></button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════

export default function LancamentosPage() {
  const supabase = createClient()
  const router = useRouter()

  // Dados base
  const [wards, setWards] = useState<Ward[]>([])
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([])

  // Formulário principal
  const [wardId, setWardId] = useState('')
  const [indicatorId, setIndicatorId] = useState('')
  const [value, setValue] = useState('')
  const [weekStart, setWeekStart] = useState(() => getRecentSundays(1)[0])

  // Campos extras
  const [valueRecomSem, setValueRecomSem] = useState('')
  const [membershipCount, setMembershipCount] = useState('')
  // Último lançamento de membros para a ala selecionada (read-only, vem do histórico)
  const [latestMembership, setLatestMembership] = useState<{ count: number; week: string } | null>(null)

  // Nominais: batismo e retornando
  const [nominalPersons, setNominalPersons] = useState<NominalPerson[]>([{ name: '', birth_date: '', gender: '', baptism_date: '' }])
  // True quando o usuário começou a digitar nomes que ainda não foram salvos.
  // Evita que mudanças em weekStart/wardId apaguem entradas em andamento.
  const nominalDirtyRef = useRef(false)
  // True quando os nomes/missionários atualmente exibidos vieram do banco
  // (estamos editando registros existentes), false se for entrada nova.
  const [nominalLoadedFromDb, setNominalLoadedFromDb] = useState(false)
  const [missionariesLoadedFromDb, setMissionariesLoadedFromDb] = useState(false)

  // Nominais: missionários
  const [missionaries, setMissionaries] = useState<MissionaryPerson[]>([])
  const [loadingMissionaries, setLoadingMissionaries] = useState(false)

  // Painel de controle
  const [controlSunday, setControlSunday] = useState(() => getRecentSundays(1)[0])
  const [weeklyStatus, setWeeklyStatus] = useState<WeeklyStatusRow[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [reviewingCell, setReviewingCell] = useState<string | null>(null)
  const [availableSundays, setAvailableSundays] = useState(() => getRecentSundays(12))

  // Domingos sem reunião (conferências)
  const [skipWeeks, setSkipWeeks] = useState<SkipWeek[]>([])

  // UI
  const [loadingData, setLoadingData] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [showConfPopover, setShowConfPopover] = useState(false)
  const [savingConf, setSavingConf] = useState(false)

  // Derivados
  const selectedWard = wards.find(w => w.id === wardId)
  const selectedIndicator = indicators.find(i => i.id === indicatorId)
  const selectedSlug = selectedIndicator?.slug || ''

  const isRecomendacao = selectedSlug === 'recomendacao_templo_com_investidura'
  const isMembrosParticipantes = selectedSlug === 'membros_participantes'
  const isBatismo = selectedSlug === 'batismo_converso'
  const isRetornando = selectedSlug === 'membros_retornando_a_igreja'
  const isMissionario = selectedSlug === 'missionario_servindo_missao_do_brasil'
  const isNominal = isBatismo || isRetornando || isMissionario

  // ─── Skip weeks helpers ───
  const isSkipWeek = (date: string, slug?: string) =>
    skipWeeks.some(sw => sw.week_date === date && (slug ? sw.affects_slug === slug : true))

  const getSkipReason = (date: string) =>
    skipWeeks.find(sw => sw.week_date === date)

  // O domingo selecionado no form é conferência para frequência?
  const isFormDateSkipped = weekStart && selectedSlug === 'frequencia_sacramental' && isSkipWeek(weekStart, 'frequencia_sacramental')

  // O domingo do controle semanal é conferência?
  const controlSkip = getSkipReason(controlSunday)

  // ─── Quick Link ───
  const quickLink = selectedWard && selectedSlug
    ? INDICATOR_LINKS[selectedSlug]?.(selectedWard.name) ?? null
    : null

  // ─── Sincroniza data do formulário com o domingo selecionado no controle ───
  useEffect(() => {
    setWeekStart(controlSunday)
  }, [controlSunday])

  // ─── Lê ?semana= da URL e navega para aquele domingo no controle ───
  useEffect(() => {
    if (typeof window === 'undefined') return
    const semana = new URLSearchParams(window.location.search).get('semana')
    if (!semana) return
    const d = new Date(semana + 'T12:00:00')
    if (isNaN(d.getTime()) || d.getDay() !== 0) return
    setControlSunday(semana)
    setAvailableSundays(prev =>
      prev.includes(semana) ? prev : [semana, ...prev].sort().reverse()
    )
  }, [])

  // Reset ao mudar ala ou indicador
  useEffect(() => {
    setFormError(null)
    setValueRecomSem('')
    setMembershipCount('')
    setLatestMembership(null)
    setNominalPersons([{ name: '', birth_date: '', gender: '', baptism_date: '' }])
    nominalDirtyRef.current = false
    setNominalLoadedFromDb(false)
    setMissionaries([])
    setMissionariesLoadedFromDb(false)
  }, [wardId, indicatorId])

  // ─── Carrega último lançamento de membros (histórico) ao selecionar ala ───
  useEffect(() => {
    async function loadLatestMembership() {
      if (!isMembrosParticipantes || !wardId) { setLatestMembership(null); return }
      const { data, error } = await supabase.rpc('get_latest_ward_membership', { p_ward_id: wardId })
      if (error) { console.warn('get_latest_ward_membership:', error.message); setLatestMembership(null); return }
      if (data && data.length > 0) {
        setLatestMembership({ count: data[0].membership_count, week: data[0].week_start })
      } else if (selectedWard?.membership_count) {
        // Fallback: se ainda não há histórico, mostra o valor atual da ala
        setLatestMembership({ count: selectedWard.membership_count, week: '' })
      } else {
        setLatestMembership(null)
      }
    }
    loadLatestMembership()
  }, [isMembrosParticipantes, wardId, selectedWard, supabase])

  // ─── Pré-preenche input se já houver lançamento para esta semana ───
  useEffect(() => {
    async function loadWeekMembership() {
      if (!isMembrosParticipantes || !wardId || !weekStart) return
      const { data } = await supabase
        .from('weekly_ward_membership')
        .select('membership_count')
        .eq('ward_id', wardId)
        .eq('week_start', weekStart)
        .maybeSingle()
      if (data) setMembershipCount(String(data.membership_count))
      else setMembershipCount('')
    }
    loadWeekMembership()
  }, [isMembrosParticipantes, wardId, weekStart, supabase])

  // ─── Carregar nomes existentes (batismo/retornando) ───
  // Lista é da ala inteira, não de uma semana. Cada linha guarda sua própria
  // week_start (e id) para que o save reconcilie semana-a-semana sem perder
  // o histórico das outras semanas.
  useEffect(() => {
    async function loadExisting() {
      if (!isBatismo && !isRetornando) return
      if (!wardId) return

      if (isBatismo) {
        const { data, error } = await supabase
          .from('baptism_records')
          .select('id, person_name, birth_date, gender, baptism_date, week_start')
          .eq('ward_id', wardId)
          .order('week_start', { ascending: false })
          .order('person_name')
        if (error) {
          setFormError(`Falha ao buscar batismos existentes: ${error.message}`)
          return
        }
        if (data && data.length > 0) {
          setNominalPersons(data.map(d => ({
            id: d.id,
            name: d.person_name, birth_date: d.birth_date || '', gender: d.gender || '',
            baptism_date: d.baptism_date || '',
            week_start_record: d.week_start,
          })))
          nominalDirtyRef.current = false
          setNominalLoadedFromDb(true)
        } else if (!nominalDirtyRef.current) {
          setNominalPersons([{ name: '', birth_date: '', gender: '', baptism_date: '' }])
          setNominalLoadedFromDb(false)
        }
      } else if (isRetornando) {
        const { data, error } = await supabase
          .from('returning_member_records')
          .select('id, person_name, birth_date, gender, week_start')
          .eq('ward_id', wardId)
          .order('week_start', { ascending: false })
          .order('person_name')
        if (error) {
          setFormError(`Falha ao buscar retornando existentes: ${error.message}`)
          return
        }
        if (data && data.length > 0) {
          setNominalPersons(data.map(d => ({
            id: d.id,
            name: d.person_name, birth_date: d.birth_date || '', gender: d.gender || '',
            baptism_date: '',
            week_start_record: d.week_start,
          })))
          nominalDirtyRef.current = false
          setNominalLoadedFromDb(true)
        } else if (!nominalDirtyRef.current) {
          setNominalPersons([{ name: '', birth_date: '', gender: '', baptism_date: '' }])
          setNominalLoadedFromDb(false)
        }
      }
    }
    loadExisting()
  }, [isBatismo, isRetornando, wardId, supabase])

  // ─── Carregar missionários existentes ───
  useEffect(() => {
    async function loadMissionaries() {
      if (!isMissionario || !wardId) return
      setLoadingMissionaries(true)
      try {
        const { data, error } = await supabase
          .from('missionary_records')
          .select('id, person_name, gender, mission_start_date, mission_end_date')
          .eq('ward_id', wardId)
          .order('person_name')
        if (error) {
          setFormError(`Falha ao buscar missionários: ${error.message}`)
          setMissionaries([])
          setMissionariesLoadedFromDb(false)
          return
        }
        const today = new Date().toISOString().split('T')[0]
        if (data && data.length > 0) {
          setMissionaries(data.map(d => ({
            id: d.id, name: d.person_name, gender: d.gender || '',
            mission_start_date: d.mission_start_date || '',
            mission_end_date: d.mission_end_date || '',
            is_active: !d.mission_end_date || d.mission_end_date >= today,
          })))
          setMissionariesLoadedFromDb(true)
        } else {
          setMissionaries([])
          setMissionariesLoadedFromDb(false)
        }
      } finally {
        setLoadingMissionaries(false)
      }
    }
    loadMissionaries()
  }, [isMissionario, wardId, supabase])

  // ─── Carregar status semanal ───
  const loadWeeklyStatus = useCallback(async () => {
    if (!controlSunday) return
    setLoadingStatus(true)
    try {
      const { data } = await supabase.rpc('get_weekly_status', { p_week_start: controlSunday })
      if (data) setWeeklyStatus(data)
    } finally {
      setLoadingStatus(false)
    }
  }, [supabase, controlSunday])

  useEffect(() => {
    if (wards.length > 0 && indicators.length > 0) loadWeeklyStatus()
  }, [loadWeeklyStatus, wards, indicators])

  // ─── Carregar dados iniciais ───
  const fetchRecentEntries = useCallback(async () => {
    const { data } = await supabase
      .from('weekly_indicator_data')
      .select('id, value, week_start, wards(name), indicators(display_name)')
      .order('created_at', { ascending: false })
      .limit(5)
    if (data) setRecentEntries(data as any)
  }, [supabase])

  useEffect(() => {
    async function load() {
      try {
        const { data: session } = await supabase.auth.getSession()
        if (!session.session) { router.push('/login'); return }
        const [wRes, iRes, swRes] = await Promise.all([
          supabase.from('wards').select('id, name, membership_count').eq('active', true).order('name'),
          supabase.from('indicators').select('id, display_name, slug, indicator_type').eq('active', true).order('order_index'),
          supabase.from('skip_weeks').select('id, week_date, reason, description, affects_slug').order('week_date'),
        ])
        if (wRes.data) setWards(wRes.data)
        if (iRes.data) setIndicators(iRes.data)
        if (swRes.data) setSkipWeeks(swRes.data)
        await fetchRecentEntries()
      } finally {
        setLoadingData(false)
      }
    }
    load()
  }, [router, supabase, fetchRecentEntries])

  // ─── Helpers nominais ───
  function addNominalPerson() {
    nominalDirtyRef.current = true
    // Linha nova fica sem id e sem week_start_record; será atribuída ao
    // weekStart selecionado no save.
    setNominalPersons(prev => [...prev, { name: '', birth_date: '', gender: '', baptism_date: '' }])
  }
  function removeNominalPerson(i: number) {
    nominalDirtyRef.current = true
    setNominalPersons(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateNominalPerson(i: number, field: keyof NominalPerson, val: string) {
    nominalDirtyRef.current = true
    setNominalPersons(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }

  // ─── Helpers missionários ───
  function addMissionary() { setMissionaries(prev => [...prev, { name: '', gender: '', mission_start_date: '', mission_end_date: '' }]) }
  function removeMissionary(i: number) { setMissionaries(prev => prev.filter((_, idx) => idx !== i)) }
  function updateMissionary(i: number, field: keyof MissionaryPerson, val: string) {
    setMissionaries(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }

  // ─── Marcar como revisado (controle semanal) ───
  async function handleMarkReviewed(wId: string, indId: string) {
    const key = `${wId}-${indId}`
    setReviewingCell(key)
    try {
      const { data: session } = await supabase.auth.getSession()
      await supabase.from('weekly_reviews').upsert({
        ward_id: wId,
        indicator_id: indId,
        week_start: controlSunday,
        reviewed_by: session.session?.user?.id,
      }, { onConflict: 'ward_id,indicator_id,week_start' })
      await loadWeeklyStatus()
    } finally {
      setReviewingCell(null)
    }
  }

  // ─── Desmarcar revisado ───
  async function handleUnmarkReviewed(wId: string, indId: string) {
    const key = `${wId}-${indId}`
    setReviewingCell(key)
    try {
      await supabase.from('weekly_reviews')
        .delete()
        .eq('ward_id', wId)
        .eq('indicator_id', indId)
        .eq('week_start', controlSunday)
      await loadWeeklyStatus()
    } finally {
      setReviewingCell(null)
    }
  }

  // ─── Marcar domingo como conferência ───
  async function handleSetConference(reason: 'conferencia_geral' | 'conferencia_estaca') {
    setSavingConf(true)
    try {
      const desc = reason === 'conferencia_geral'
        ? `Conferência Geral — ${new Date(controlSunday + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
        : `Conferência de Estaca — ${new Date(controlSunday + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`

      await supabase.from('skip_weeks').upsert({
        week_date: controlSunday,
        reason,
        description: desc,
        affects_slug: 'frequencia_sacramental',
      }, { onConflict: 'week_date' })

      // Recarregar skip_weeks
      const { data } = await supabase.from('skip_weeks').select('id, week_date, reason, description, affects_slug').order('week_date')
      if (data) setSkipWeeks(data)

      setToast({ type: 'success', text: `Domingo marcado como ${reason === 'conferencia_geral' ? 'Conferência Geral' : 'Conferência de Estaca'}.` })
      setShowConfPopover(false)
    } finally {
      setSavingConf(false)
    }
  }

  // ─── Desmarcar conferência ───
  async function handleRemoveConference() {
    setSavingConf(true)
    try {
      await supabase.from('skip_weeks').delete().eq('week_date', controlSunday)

      const { data } = await supabase.from('skip_weeks').select('id, week_date, reason, description, affects_slug').order('week_date')
      if (data) setSkipWeeks(data)

      setToast({ type: 'success', text: 'Domingo desmarcado como conferência.' })
      setShowConfPopover(false)
    } finally {
      setSavingConf(false)
    }
  }

  // ─── Submit ───
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)

    try {
      const { data: session } = await supabase.auth.getSession()
      const userId = session.session?.user?.id

      // ─── BATISMO / RETORNANDO NOMINAL ───
      // A lista é da ala inteira. Cada linha do form aponta para a sua semana
      // (week_start_record); linhas novas usam o weekStart selecionado.
      // Salva reconciliando semana-a-semana: para cada semana afetada,
      // delete-all + insert-all + upsert weekly_indicator_data.
      if (isBatismo || isRetornando) {
        if (!wardId) { setFormError('Selecione uma ala.'); return }
        const validPersons = nominalPersons.filter(p => p.name.trim().length >= 2)
        // Ao menos uma linha precisa de semana válida (existente ou via weekStart selecionado)
        const hasNewRow = validPersons.some(p => !p.id)
        if (hasNewRow && !weekStart) {
          setFormError('Para adicionar nomes novos, selecione o domingo de referência.')
          return
        }
        if (hasNewRow) {
          const dateErr = validateForm(0, weekStart)
          if (dateErr && dateErr !== 'Valor deve ser positivo.') { setFormError(dateErr); return }
        }

        const tableName = isBatismo ? 'baptism_records' : 'returning_member_records'
        const recordLabel = isBatismo ? 'batismo' : 'membro retornando'

        // Coleta semanas afetadas: dos registros do form + de TODAS as linhas
        // originais carregadas (para detectar removidos)
        const weeksAffected = new Set<string>()
        for (const p of validPersons) {
          const w = p.id ? p.week_start_record : weekStart
          if (w) weeksAffected.add(w)
        }
        for (const p of nominalPersons) {
          if (p.id && p.week_start_record) weeksAffected.add(p.week_start_record)
        }

        // Para cada semana, decide quais linhas pertencem a ela e reescreve.
        for (const week of weeksAffected) {
          const personsForWeek = validPersons.filter(p => {
            const rowWeek = p.id ? p.week_start_record : weekStart
            return rowWeek === week
          })

          // Deleta tudo daquela ala+semana
          const { error: delErr } = await supabase.from(tableName)
            .delete().eq('ward_id', wardId).eq('week_start', week)
          if (delErr) { setFormError(`Erro ao limpar ${recordLabel}s da semana ${week}: ${delErr.message}`); return }

          // Insere as linhas atuais para essa semana (se houver)
          if (personsForWeek.length > 0) {
            const insertRows = personsForWeek.map(p => {
              const base: Record<string, unknown> = {
                ward_id: wardId, week_start: week, person_name: p.name.trim(),
                birth_date: p.birth_date || null, gender: p.gender || null, created_by: userId,
              }
              if (isBatismo) base.baptism_date = p.baptism_date || week
              return base
            })
            const { error: insErr } = await supabase.from(tableName).insert(insertRows)
            if (insErr) { setFormError(`Erro ao salvar ${recordLabel}s: ${insErr.message}`); return }
          }

          // Reconcilia weekly_indicator_data: deleta e (se há registros) reinsere
          await supabase.from('weekly_indicator_data').delete()
            .eq('ward_id', wardId).eq('indicator_id', indicatorId).eq('week_start', week)
          if (personsForWeek.length > 0) {
            const { error: wErr } = await supabase.from('weekly_indicator_data').insert({
              ward_id: wardId, indicator_id: indicatorId, value: personsForWeek.length,
              week_start: week, source: 'manual', created_by: userId,
            })
            if (wErr) { setFormError(`Erro ao salvar contagem da semana ${week}: ${wErr.message}`); return }
          }
        }

        setToast({ type: 'success', text: `${validPersons.length} ${recordLabel}(s) registrado(s) na ala!` })
        nominalDirtyRef.current = false
        // Recarrega os registros para atualizar ids/week_start_record
        // (o useEffect de loadExisting depende de wardId; um truque é forçar refetch)
        const { data: refreshed } = await supabase
          .from(tableName)
          .select(isBatismo
            ? 'id, person_name, birth_date, gender, baptism_date, week_start'
            : 'id, person_name, birth_date, gender, week_start')
          .eq('ward_id', wardId)
          .order('week_start', { ascending: false })
          .order('person_name')
        if (refreshed && refreshed.length > 0) {
          setNominalPersons(refreshed.map((d: any) => ({
            id: d.id, name: d.person_name, birth_date: d.birth_date || '',
            gender: d.gender || '', baptism_date: d.baptism_date || '',
            week_start_record: d.week_start,
          })))
          setNominalLoadedFromDb(true)
        } else {
          setNominalPersons([{ name: '', birth_date: '', gender: '', baptism_date: '' }])
          setNominalLoadedFromDb(false)
        }
        await fetchRecentEntries()
        await loadWeeklyStatus()
        return
      }

      // ─── CASO MISSIONÁRIOS ───
      if (isMissionario) {
        if (!wardId) { setFormError('Selecione uma ala.'); return }

        const validMissionaries = missionaries.filter(m => m.name.trim().length >= 2)

        // Deletar todos da ala e reinserir
        await supabase.from('missionary_records').delete().eq('ward_id', wardId)
        if (validMissionaries.length > 0) {
          const { error: mErr } = await supabase.from('missionary_records').insert(
            validMissionaries.map(m => ({
              ward_id: wardId, person_name: m.name.trim(), gender: m.gender || null,
              mission_start_date: m.mission_start_date || null,
              mission_end_date: m.mission_end_date || null,
              created_by: userId,
            }))
          )
          if (mErr) { setFormError('Erro ao salvar missionários: ' + mErr.message); return }
        }

        // Contar ativos e salvar em weekly_indicator_data
        const activeCount = validMissionaries.filter(m =>
          !m.mission_end_date || m.mission_end_date >= new Date().toISOString().split('T')[0]
        ).length

        // Usar o domingo mais recente como referência
        const sundayRef = weekStart || getRecentSundays(1)[0]
        await supabase.from('weekly_indicator_data').delete()
          .eq('ward_id', wardId).eq('indicator_id', indicatorId).eq('week_start', sundayRef)
        await supabase.from('weekly_indicator_data').insert({
          ward_id: wardId, indicator_id: indicatorId, value: activeCount,
          week_start: sundayRef, source: 'manual', created_by: userId,
        })

        setToast({ type: 'success', text: `${validMissionaries.length} missionário(s) salvos! (${activeCount} ativos)` })
        // Recarregar missionários da ala
        const { data: refreshed } = await supabase.rpc('get_missionary_names', { p_ward_id: wardId })
        if (refreshed) {
          setMissionaries(refreshed.map((d: any) => ({
            id: d.id, name: d.person_name, gender: d.gender || '',
            mission_start_date: d.mission_start_date || '', mission_end_date: d.mission_end_date || '',
            is_active: d.is_active,
          })))
        }
        await fetchRecentEntries()
        await loadWeeklyStatus()
        return
      }

      // ─── CASO PADRÃO (numérico) ───
      if (!wardId || !indicatorId || !value || !weekStart) { setFormError('Preencha todos os campos.'); return }

      const numValue = Number(value)
      const err = validateForm(numValue, weekStart)
      if (err) { setFormError(err); return }

      if (isRecomendacao && !valueRecomSem) { setFormError('Preencha o valor SEM investidura também.'); return }

      const { error } = await supabase.from('weekly_indicator_data').insert({
        ward_id: wardId, indicator_id: indicatorId, value: numValue,
        week_start: weekStart, source: 'manual', created_by: userId,
      })

      if (error) {
        if (error.code === '23505') setFormError('Este indicador já foi lançado para esta ala neste domingo.')
        else if (error.code === '23514') setFormError('Dados inválidos.')
        else setFormError('Erro: ' + error.message)
        return
      }

      let extraSuccess = ''

      // Recomendações SEM investidura
      if (isRecomendacao) {
        const semInvIndicator = indicators.find(i => i.slug === 'recomendacao_templo_sem_investidura')
        if (semInvIndicator) {
          const numSem = Number(valueRecomSem)
          const errSem = validateForm(numSem, weekStart)
          if (errSem) { setFormError('SEM investidura: ' + errSem); return }
          const { error: errSemDb } = await supabase.from('weekly_indicator_data').insert({
            ward_id: wardId, indicator_id: semInvIndicator.id, value: numSem,
            week_start: weekStart, source: 'manual', created_by: userId,
          })
          if (errSemDb) {
            if (errSemDb.code === '23505') extraSuccess = ' (Sem investidura já existia.)'
            else { setFormError('Erro: ' + errSemDb.message); return }
          } else extraSuccess = ' + Sem investidura salvo!'
        }
      }

      // membership_count — grava em weekly_ward_membership (semana a semana).
      // O trigger no banco sincroniza wards.membership_count automaticamente.
      if (isMembrosParticipantes && membershipCount) {
        const numMembership = Number(membershipCount)
        if (numMembership > 0 && numMembership <= 10000) {
          const { error: upErr } = await supabase
            .from('weekly_ward_membership')
            .upsert({
              ward_id: wardId,
              week_start: weekStart,
              membership_count: numMembership,
              created_by: userId,
            }, { onConflict: 'ward_id,week_start' })
          if (upErr) {
            setFormError('Erro ao salvar total de membros: ' + upErr.message)
            return
          }
          extraSuccess += ' Total de membros registrado para esta semana!'
          // Reflete localmente: a ala passa a ter o último lançamento = este
          setWards(prev => prev.map(w => w.id === wardId ? { ...w, membership_count: numMembership } : w))
          setLatestMembership({ count: numMembership, week: weekStart })
        } else {
          setFormError('Total de membros deve estar entre 1 e 10000.')
          return
        }
      }

      setToast({ type: 'success', text: 'Lançamento registrado!' + extraSuccess })
      setValue('')
      setValueRecomSem('')
      setMembershipCount('')
      await fetchRecentEntries()
      await loadWeeklyStatus()

    } catch (err: any) {
      setFormError('Erro inesperado: ' + (err.message || 'Tente novamente.'))
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Botão "Sem novidade" no formulário ───
  async function handleMarkReviewedFromForm() {
    if (!wardId || !indicatorId || !weekStart) {
      setFormError('Selecione ala, indicador e data para marcar como revisado.')
      return
    }
    setSubmitting(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      await supabase.from('weekly_reviews').upsert({
        ward_id: wardId, indicator_id: indicatorId, week_start: weekStart,
        reviewed_by: session.session?.user?.id,
      }, { onConflict: 'ward_id,indicator_id,week_start' })
      setToast({ type: 'success', text: 'Marcado como revisado (sem novidade).' })
      await loadWeeklyStatus()
    } catch {
      setFormError('Erro ao marcar como revisado.')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Loading ───
  if (loadingData) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: THEME.bg }}>
        <Loader2 className="h-10 w-10 animate-spin" style={{ color: THEME.primary }} />
      </div>
    )
  }

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════

  const visibleIndicators = indicators.filter(i => i.slug !== 'recomendacao_templo_sem_investidura')

  // Dados do painel de controle
  const statusWards = [...new Map(weeklyStatus.map(r => [r.ward_id, r.ward_name])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))

  const statusIndicators = [...new Map(weeklyStatus.map(r => [r.indicator_id, { name: r.indicator_name, slug: r.indicator_slug, order: r.order_index }])).entries()]
    .map(([id, info]) => ({ id, ...info })).sort((a, b) => a.order - b.order)

  // Normalizar tipos (RPC pode retornar strings em vez de boolean/number)
  const statusMap = new Map(weeklyStatus.map(r => [
    `${r.ward_id}-${r.indicator_id}`,
    { ...r, launched: String(r.launched) === 'true', reviewed: String(r.reviewed) === 'true', value: Number(r.value) }
  ]))

  const totalCells = statusWards.length * statusIndicators.length
  const doneCells = [...statusMap.values()].filter(r => r.launched || r.reviewed).length
  // Contar células de conferência (skip) como "feitas"
  const skippedCells = statusWards.length * statusIndicators.filter(ind => isSkipWeek(controlSunday, ind.slug)).length
  const effectiveDone = doneCells + skippedCells
  const effectiveTotal = totalCells
  const completionPct = effectiveTotal > 0 ? Math.min(100, Math.round((effectiveDone / effectiveTotal) * 100)) : 0
  const wardsComplete = statusWards.filter(w =>
    statusIndicators.every(ind => {
      const cell = statusMap.get(`${w.id}-${ind.id}`)
      return cell?.launched || cell?.reviewed || isSkipWeek(controlSunday, ind.slug)
    })
  ).length

  return (
    <main className="min-h-screen p-4 md:p-12 font-sans transition-all" style={{ backgroundColor: THEME.bg }}>
      <ToastMessage toast={toast} onClose={() => setToast(null)} />

      <div className="mx-auto max-w-5xl">

        {/* HEADER */}
        <div className="mb-8 md:mb-10 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2" style={{ color: THEME.textTitle }}>
            Lançamento de Dados
          </h1>
          <p className="text-slate-500 font-semibold uppercase text-[10px] md:text-xs tracking-widest">
            Registre os indicadores semanais da Estaca
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:gap-8">

          {/* ═══════════════════════════════════════ */}
          {/* PAINEL DE CONTROLE SEMANAL             */}
          {/* ═══════════════════════════════════════ */}
          <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
            <div className="p-5 md:p-8 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between bg-slate-50/50 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 rounded-xl">
                  <ClipboardCheck size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-black text-slate-800 text-base md:text-lg">Controle Semanal</h2>
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {wardsComplete} de {statusWards.length} alas completas — {completionPct}%
                  </p>
                </div>
              </div>
              <select value={controlSunday} onChange={e => setControlSunday(e.target.value)}
                className="bg-white border-2 border-slate-100 text-slate-700 text-sm rounded-xl focus:ring-sky-500 focus:border-sky-500 p-2.5 font-bold">
                {availableSundays.map(s => {
                  const skip = getSkipReason(s)
                  return (
                    <option key={s} value={s}>
                      {new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
                      {s === availableSundays[0] ? ' (mais recente)' : ''}
                      {skip ? ` ⚠ ${skip.reason === 'conferencia_geral' ? 'Conf. Geral' : skip.reason === 'conferencia_estaca' ? 'Conf. Estaca' : 'Sem reunião'}` : ''}
                    </option>
                  )
                })}
              </select>

              {/* Botão conferência */}
              <div className="relative">
                <button onClick={() => setShowConfPopover(!showConfPopover)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold rounded-xl border-2 transition-all ${
                    controlSkip
                      ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                      : 'bg-white border-slate-100 text-slate-500 hover:border-amber-200 hover:text-amber-600'
                  }`}>
                  <CalendarX2 size={14} />
                  <span className="hidden sm:inline">{controlSkip ? 'Conferência' : 'Marcar Conf.'}</span>
                </button>

                {showConfPopover && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 animate-in slide-in-from-top-2">
                    <p className="text-xs font-black text-slate-700 mb-3">
                      {new Date(controlSunday + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>

                    {controlSkip ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                          <p className="text-[10px] font-bold text-amber-700 uppercase">Marcado como</p>
                          <p className="text-sm font-black text-amber-800 mt-0.5">{controlSkip.description}</p>
                        </div>
                        <button onClick={handleRemoveConference} disabled={savingConf}
                          className="w-full py-2.5 text-rose-600 bg-rose-50 border border-rose-100 font-bold text-xs rounded-xl hover:bg-rose-100 transition-all disabled:opacity-50">
                          {savingConf ? 'Removendo...' : 'Remover marcação'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-medium mb-2">Marcar este domingo como:</p>
                        <button onClick={() => handleSetConference('conferencia_geral')} disabled={savingConf}
                          className="w-full py-2.5 bg-amber-50 border border-amber-200 text-amber-800 font-bold text-xs rounded-xl hover:bg-amber-100 transition-all disabled:opacity-50 text-left px-3">
                          🌍 Conferência Geral
                        </button>
                        <button onClick={() => handleSetConference('conferencia_estaca')} disabled={savingConf}
                          className="w-full py-2.5 bg-sky-50 border border-sky-200 text-sky-800 font-bold text-xs rounded-xl hover:bg-sky-100 transition-all disabled:opacity-50 text-left px-3">
                          🏛️ Conferência de Estaca
                        </button>
                      </div>
                    )}

                    <button onClick={() => setShowConfPopover(false)}
                      className="w-full mt-3 py-2 text-slate-400 text-[10px] font-bold uppercase hover:text-slate-600 transition-colors">
                      Fechar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Barra de progresso */}
            <div className="px-5 md:px-8 pt-4">
              <div className="w-full bg-slate-100 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full transition-all duration-500 ${completionPct === 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                  style={{ width: `${completionPct}%` }} />
              </div>
            </div>

            {/* Legenda */}
            <div className="px-5 md:px-8 pt-3 flex flex-wrap gap-4 text-[9px] font-bold text-slate-400 uppercase">
              <div className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" /> Lançado</div>
              <div className="flex items-center gap-1.5"><Eye size={12} className="text-sky-500" /> Revisado</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full border-2 border-slate-200" /> Pendente</div>
              <div className="flex items-center gap-1.5"><CalendarX2 size={12} className="text-amber-500" /> Conferência</div>
            </div>

            {/* Aviso conferência no controle */}
            {controlSkip && (
              <div className="mx-5 md:mx-8 mt-3 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <CalendarX2 size={16} className="text-amber-600 shrink-0" />
                <p className="text-xs font-bold text-amber-700">
                  {controlSkip.description || 'Domingo sem reunião sacramental'} — Frequência não precisa ser lançada
                </p>
              </div>
            )}

            {/* Tabela */}
            <div className="p-3 md:p-6 overflow-x-auto">
              {loadingStatus ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
              ) : statusWards.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm font-medium">Nenhum dado encontrado.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left p-2 md:p-3 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-wider sticky left-0 bg-white z-10 min-w-[100px]">Unidade</th>
                      {statusIndicators.map(ind => (
                        <th key={ind.id} className="text-center p-1 md:p-2 text-[8px] md:text-[9px] font-black text-slate-400 uppercase w-[60px] md:w-[80px]">
                          <span className="block leading-tight">{ind.name.replace('Recomendações para o Templo - Membros ', 'Rec. ').replace('Frequência da Reunião Sacramental', 'Freq. Sacr.').replace('Membros Retornando à Igreja', 'Retorn.').replace('Membros Participantes', 'Particip.').replace('Membros Jejuando', 'Jejum').replace('Batismos de Conversos', 'Batismos').replace('Missionários Servindo do Brasil', 'Mission.')}</span>
                        </th>
                      ))}
                      <th className="text-center p-2 text-[9px] font-black text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {statusWards.map(ward => {
                      const wardCells = statusIndicators.map(ind => statusMap.get(`${ward.id}-${ind.id}`))
                      const wardDone = wardCells.every(r => r?.launched || r?.reviewed)
                      const wardCount = wardCells.filter(r => r?.launched || r?.reviewed).length
                      return (
                        <tr key={ward.id} className={wardDone ? 'bg-emerald-50/30' : 'hover:bg-slate-50/50'}>
                          <td className="p-2 md:p-3 sticky left-0 bg-white z-10">
                            <span className="font-bold text-slate-700 text-xs md:text-sm">{ward.name}</span>
                          </td>
                          {statusIndicators.map(ind => {
                            const cell = statusMap.get(`${ward.id}-${ind.id}`)
                            const cellKey = `${ward.id}-${ind.id}`
                            const isReviewing = reviewingCell === cellKey
                            const isCellSkipped = isSkipWeek(controlSunday, ind.slug)
                            return (
                              <td key={ind.id} className="text-center p-1 md:p-2">
                                {isReviewing ? (
                                  <Loader2 size={14} className="animate-spin text-slate-300 mx-auto" />
                                ) : isCellSkipped && !cell?.launched ? (
                                  <div className="flex flex-col items-center" title="Domingo de conferência — sem reunião">
                                    <CalendarX2 size={14} className="text-amber-400" />
                                    <span className="text-[7px] font-bold text-amber-400 mt-0.5">conf.</span>
                                  </div>
                                ) : cell?.launched ? (
                                  <div className="flex flex-col items-center">
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                    <span className="text-[9px] font-bold text-emerald-600 mt-0.5">{cell.value}</span>
                                  </div>
                                ) : cell?.reviewed ? (
                                  <div className="flex flex-col items-center" title="Revisado — sem novidade">
                                    <Eye size={16} className="text-sky-500" />
                                    <span className="text-[8px] font-bold text-sky-400 mt-0.5">ok</span>
                                  </div>
                                ) : (
                                  <button onClick={() => handleMarkReviewed(ward.id, ind.id)}
                                    className="w-4 h-4 mx-auto rounded-full border-2 border-slate-200 hover:border-sky-400 hover:bg-sky-50 transition-all cursor-pointer"
                                    title="Marcar como revisado" />
                                )}
                              </td>
                            )
                          })}
                          <td className="text-center p-2">
                            {wardDone ? (
                              <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-black rounded-full uppercase">Completo</span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400">{wardCount}/{statusIndicators.length}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ═══════════════════════════════════════ */}
          {/* FORMULÁRIO                              */}
          {/* ═══════════════════════════════════════ */}
          <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden relative">
            <div className="h-2 w-full absolute top-0 left-0" style={{ backgroundColor: THEME.primary }}></div>

            <div className="p-5 md:p-10">
              <form onSubmit={handleSubmit} className="space-y-6 md:space-y-8">

                {/* Ala + Indicador */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  <div className="space-y-2 md:space-y-3">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <Building2 size={16} className="text-slate-400" /> Ala / Ramo
                    </label>
                    <div className="relative">
                      <select value={wardId} onChange={e => setWardId(e.target.value)} required
                        className="w-full appearance-none rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 md:py-4 text-slate-800 font-bold outline-none focus:border-[#0069a8] focus:bg-white transition-all text-sm md:text-base">
                        <option value="">Selecione...</option>
                        {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                        <div className="w-2 h-2 border-r-2 border-b-2 border-slate-400 rotate-45 mb-1"></div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 md:space-y-3">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <Target size={16} className="text-slate-400" /> Indicador
                    </label>
                    <div className="relative">
                      <select value={indicatorId} onChange={e => setIndicatorId(e.target.value)} required
                        className="w-full appearance-none rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 md:py-4 text-slate-800 font-bold outline-none focus:border-[#0069a8] focus:bg-white transition-all text-sm md:text-base">
                        <option value="">Selecione...</option>
                        {visibleIndicators.map(i => (
                          <option key={i.id} value={i.id}>
                            {i.display_name}
                            {i.slug === 'recomendacao_templo_com_investidura' ? ' (com + sem)' : ''}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                        <div className="w-2 h-2 border-r-2 border-b-2 border-slate-400 rotate-45 mb-1"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Link — janela lateral do site da Igreja
                    O site da Igreja bloqueia embed via CSP (frame-ancestors 'self'),
                    então abrimos um popup posicionado à direita da tela. */}
                {quickLink && (
                  <div className="bg-sky-50 border border-sky-100 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-wrap items-center gap-2 p-3">
                      <BookOpen size={18} className="text-sky-600 shrink-0" />
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-xs font-bold text-sky-800">Site da Igreja</p>
                        <p className="text-[10px] text-sky-600 truncate">{quickLink}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!quickLink) return
                          const w = 520
                          const h = Math.max(700, window.screen.availHeight - 80)
                          const left = Math.max(0, window.screen.availWidth - w - 20)
                          const top = 40
                          window.open(
                            quickLink,
                            'igreja_painel',
                            `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener`
                          )
                        }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-bold rounded-lg hover:bg-sky-700 transition-all"
                        title="Abre uma janela menor à direita da tela para você consultar enquanto lança"
                      >
                        <ExternalLink size={14} /> Abrir lateral
                      </button>
                      <button
                        type="button"
                        onClick={() => window.open(quickLink, '_blank', 'noopener')}
                        className="shrink-0 px-2.5 py-1.5 bg-white border border-sky-200 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-100 transition-all"
                      >
                        Nova aba
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(quickLink); setToast({ type: 'success', text: 'Link copiado!' }) }
                          catch { setToast({ type: 'error', text: 'Não foi possível copiar.' }) }
                        }}
                        className="shrink-0 px-2.5 py-1.5 bg-white border border-sky-200 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-100 transition-all"
                      >
                        Copiar
                      </button>
                    </div>
                    <p className="text-[10px] text-sky-700 bg-sky-100/60 border-t border-sky-100 px-3 py-2 leading-relaxed">
                      💡 Use <strong>Abrir lateral</strong> para uma mini-janela ao lado dos lançamentos. (O site da Igreja bloqueia incorporação direta na página, por política de segurança deles.)
                    </p>
                  </div>
                )}

                {/* ─── AVISO: Domingo de Conferência ─── */}
                {isFormDateSkipped && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl animate-in fade-in slide-in-from-top-2">
                    <CalendarX2 size={20} className="text-amber-600 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-amber-800">
                        {getSkipReason(weekStart)?.description || 'Domingo sem reunião sacramental'}
                      </p>
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        A frequência sacramental não precisa ser lançada neste domingo. Este dia será excluído do cálculo de média.
                      </p>
                    </div>
                  </div>
                )}

                {/* Data (não aparece para missionários) */}
                {!isMissionario && (
                  <div className={`grid grid-cols-1 ${isNominal ? '' : 'md:grid-cols-2'} gap-5 md:gap-6 pt-2`}>
                    <div className="space-y-2 md:space-y-3">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Calendar size={16} className="text-slate-400" /> Domingo de Referência
                      </label>
                      <input type="date" value={weekStart} onChange={e => { setWeekStart(e.target.value); setFormError(null) }} required
                        className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-slate-800 font-bold outline-none focus:border-[#0069a8] focus:bg-white transition-all text-sm md:text-base" />
                    </div>
                    {/* Valor numérico (só para não-nominal) */}
                    {!isNominal && (
                      <div className="space-y-2 md:space-y-3">
                        <label className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <Hash size={16} className="text-slate-400" />
                          {isRecomendacao ? 'COM Investidura' : 'Valor Realizado'}
                        </label>
                        <input type="number" value={value} onChange={e => { setValue(e.target.value); setFormError(null) }} required min={0} max={10000}
                          className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-xl md:text-2xl font-black text-[#0069a8] outline-none focus:border-[#0069a8] focus:bg-white transition-all placeholder:text-slate-300"
                          placeholder="0" />
                      </div>
                    )}
                  </div>
                )}

                {/* ─── NOMINAL: Batismo / Retornando ─── */}
                {(isBatismo || isRetornando) && (
                  <div className={`animate-in fade-in slide-in-from-top-2 space-y-4 p-5 border rounded-2xl ${
                    isBatismo ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'
                  }`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${
                        isBatismo ? 'text-emerald-700' : 'text-orange-700'
                      }`}>
                        <UserPlus size={16} className={isBatismo ? 'text-emerald-500' : 'text-orange-500'} />
                        {isBatismo ? 'Nomes dos Batizados' : 'Membros Retornando'}
                      </label>
                      <div className="flex items-center gap-2">
                        {nominalLoadedFromDb && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                            isBatismo ? 'text-emerald-700 bg-emerald-200/60' : 'text-orange-700 bg-orange-200/60'
                          }`}>
                            <Pencil size={10} /> Editando registro existente
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isBatismo ? 'text-emerald-600 bg-emerald-100' : 'text-orange-600 bg-orange-100'
                        }`}>
                          {nominalPersons.filter(p => p.name.trim().length >= 2).length} pessoa(s)
                        </span>
                      </div>
                    </div>
                    {nominalLoadedFromDb && (
                      <p className={`text-[11px] -mt-2 ${isBatismo ? 'text-emerald-700' : 'text-orange-700'}`}>
                        Lista completa da ala (todas as semanas). Edite ou remova linhas existentes; novas linhas usam o domingo de referência selecionado.
                      </p>
                    )}

                    <div className="space-y-3">
                      {nominalPersons.map((person, index) => {
                        const isExisting = !!person.id
                        const rowWeek = person.week_start_record || (isExisting ? '' : weekStart)
                        const rowWeekLabel = rowWeek
                          ? new Date(rowWeek + 'T12:00:00').toLocaleDateString('pt-BR')
                          : 'sem domingo'
                        return (
                        <div key={person.id || `new-${index}`} className={`p-3 rounded-xl border bg-white ${isBatismo ? 'border-emerald-200' : 'border-orange-200'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-black w-5 text-center shrink-0 ${isBatismo ? 'text-emerald-400' : 'text-orange-400'}`}>{index + 1}</span>
                            <input type="text" value={person.name} onChange={e => updateNominalPerson(index, 'name', e.target.value)}
                              placeholder="Nome completo"
                              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold outline-none transition-all ${
                                isBatismo ? 'border-emerald-200 text-emerald-800 focus:border-emerald-400 placeholder:text-emerald-300'
                                  : 'border-orange-200 text-orange-800 focus:border-orange-400 placeholder:text-orange-300'
                              }`} />
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-md whitespace-nowrap ${
                              isExisting
                                ? (isBatismo ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700')
                                : 'bg-amber-100 text-amber-700'
                            }`} title={isExisting ? 'Lançamento existente — esta data não é alterada' : 'Será lançado no domingo selecionado acima'}>
                              {isExisting ? `Dom ${rowWeekLabel}` : `Novo (${rowWeekLabel})`}
                            </span>
                            <button type="button" onClick={() => removeNominalPerson(index)}
                              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all shrink-0">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className={`grid ${isBatismo ? 'grid-cols-3' : 'grid-cols-2'} gap-2 ml-7`}>
                            {isBatismo && (
                              <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-emerald-600 uppercase mb-0.5 tracking-wider">Data do batismo</span>
                                <input type="date" value={person.baptism_date} onChange={e => updateNominalPerson(index, 'baptism_date', e.target.value)}
                                  className="rounded-lg border border-emerald-200 px-2 py-1.5 text-[11px] font-medium text-emerald-700 outline-none focus:border-emerald-400"
                                  title="Data do batismo" />
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold text-slate-500 uppercase mb-0.5 tracking-wider">Nascimento</span>
                              <input type="date" value={person.birth_date} onChange={e => updateNominalPerson(index, 'birth_date', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-sky-400"
                                title="Data de nascimento" />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold text-slate-500 uppercase mb-0.5 tracking-wider">Gênero</span>
                              <select value={person.gender} onChange={e => updateNominalPerson(index, 'gender', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-sky-400">
                                <option value="">—</option>
                                <option value="M">Masculino</option>
                                <option value="F">Feminino</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        )
                      })}
                    </div>

                    <button type="button" onClick={addNominalPerson}
                      disabled={!weekStart}
                      title={!weekStart ? 'Selecione o domingo de referência primeiro' : ''}
                      className={`flex items-center gap-2 font-bold text-xs transition-colors px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isBatismo ? 'text-emerald-600 hover:text-emerald-800' : 'text-orange-600 hover:text-orange-800'
                      }`}>
                      <Plus size={16} /> Adicionar pessoa {weekStart ? `(domingo ${new Date(weekStart + 'T12:00:00').toLocaleDateString('pt-BR')})` : ''}
                    </button>
                  </div>
                )}

                {/* ─── NOMINAL: Missionários ─── */}
                {isMissionario && (
                  <div className="animate-in fade-in slide-in-from-top-2 space-y-4 p-5 bg-indigo-50 border border-indigo-100 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-indigo-700 uppercase tracking-wider flex items-center gap-2">
                        <BookOpen size={16} className="text-indigo-500" /> Missionários da Ala
                      </label>
                      <div className="flex items-center gap-2">
                        {loadingMissionaries && <Loader2 size={14} className="animate-spin text-indigo-400" />}
                        {missionariesLoadedFromDb && (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-200/60 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <Pencil size={10} /> Editando registros
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
                          {missionaries.filter(m => !m.mission_end_date || m.mission_end_date >= new Date().toISOString().split('T')[0]).length} ativo(s)
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-indigo-600 -mt-2">
                      {missionariesLoadedFromDb
                        ? 'Missionários da ala carregados — edite, adicione ou remova; salve para sobrescrever.'
                        : 'Missionários com data de término passada ficam inativos e não contam.'}
                    </p>

                    <div className="space-y-3">
                      {missionaries.map((m, index) => {
                        const isInactive = m.mission_end_date && m.mission_end_date < new Date().toISOString().split('T')[0]
                        return (
                          <div key={index} className={`p-3 rounded-xl border bg-white ${isInactive ? 'border-slate-200 opacity-50' : 'border-indigo-200'}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-black text-indigo-400 w-5 text-center shrink-0">{index + 1}</span>
                              <input type="text" value={m.name} onChange={e => updateMissionary(index, 'name', e.target.value)}
                                placeholder="Nome completo"
                                className="flex-1 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-bold text-indigo-800 outline-none focus:border-indigo-400 placeholder:text-indigo-300" />
                              <select value={m.gender} onChange={e => updateMissionary(index, 'gender', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-medium text-slate-600 outline-none w-24">
                                <option value="">Gênero</option>
                                <option value="M">Masc.</option>
                                <option value="F">Fem.</option>
                              </select>
                              <button type="button" onClick={() => removeMissionary(index)}
                                className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all shrink-0">
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 ml-7">
                              <div>
                                <label className="text-[9px] font-bold text-slate-400 uppercase">Início missão</label>
                                <input type="date" value={m.mission_start_date} onChange={e => updateMissionary(index, 'mission_start_date', e.target.value)}
                                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-sky-400" />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold text-slate-400 uppercase">Término missão</label>
                                <input type="date" value={m.mission_end_date} onChange={e => updateMissionary(index, 'mission_end_date', e.target.value)}
                                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-sky-400" />
                              </div>
                            </div>
                            {isInactive && (
                              <p className="text-[9px] text-rose-500 font-bold mt-1.5 ml-7">Missão encerrada — não conta na contagem ativa</p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <button type="button" onClick={addMissionary}
                      className="flex items-center gap-2 text-indigo-600 font-bold text-xs hover:text-indigo-800 transition-colors px-2 py-1.5">
                      <Plus size={16} /> Adicionar missionário
                    </button>
                  </div>
                )}

                {/* Recomendações SEM investidura */}
                {isRecomendacao && (
                  <div className="animate-in fade-in slide-in-from-top-2 space-y-2 md:space-y-3 p-5 bg-amber-50 border border-amber-100 rounded-2xl">
                    <label className="text-xs font-black text-amber-700 uppercase tracking-wider flex items-center gap-2">
                      <Hash size={16} className="text-amber-500" /> SEM Investidura
                    </label>
                    <p className="text-[10px] text-amber-600 -mt-1">Mesmo link do site da Igreja, campo separado aqui.</p>
                    <input type="number" value={valueRecomSem} onChange={e => { setValueRecomSem(e.target.value); setFormError(null) }} min={0} max={10000}
                      className="w-full rounded-xl border-2 border-amber-200 bg-white px-4 py-3.5 text-xl md:text-2xl font-black text-amber-700 outline-none focus:border-amber-400 transition-all placeholder:text-amber-300"
                      placeholder="0" />
                  </div>
                )}

                {/* Membros Participantes → total de membros (semana a semana) */}
                {isMembrosParticipantes && (
                  <div className="animate-in fade-in slide-in-from-top-2 space-y-3 p-5 bg-violet-50 border border-violet-100 rounded-2xl">
                    <label className="text-xs font-black text-violet-700 uppercase tracking-wider flex items-center gap-2">
                      <Users size={16} className="text-violet-500" /> Total de Membros da Ala
                    </label>

                    {/* Último lançamento (read-only) */}
                    <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-xl border border-violet-100">
                      <div>
                        <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider">Último lançado</p>
                        <p className="text-2xl font-black text-violet-700 mt-0.5">
                          {latestMembership ? latestMembership.count : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-violet-400 uppercase">Semana</p>
                        <p className="text-xs font-bold text-violet-600 mt-0.5">
                          {latestMembership?.week
                            ? new Date(latestMembership.week + 'T12:00:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Novo lançamento para a semana selecionada */}
                    <div>
                      <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1.5">
                        Novo total de membros (para o domingo {weekStart ? new Date(weekStart + 'T12:00:00').toLocaleDateString('pt-BR') : 'selecionado'})
                      </p>
                      <input type="number" value={membershipCount} onChange={e => setMembershipCount(e.target.value)} min={1} max={10000}
                        className="w-full rounded-xl border-2 border-violet-200 bg-white px-4 py-3.5 text-xl md:text-2xl font-black text-violet-700 outline-none focus:border-violet-400 transition-all placeholder:text-violet-300"
                        placeholder={latestMembership ? String(latestMembership.count) : '0'} />
                      <p className="text-[10px] text-violet-500 mt-1.5">
                        Cada lançamento gera uma linha histórica (ala + semana). Não sobrescreve os anteriores.
                      </p>
                    </div>
                  </div>
                )}

                {/* Erro inline */}
                {formError && (
                  <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={20} className="text-rose-500 shrink-0 mt-0.5" />
                    <span className="font-bold text-sm text-rose-700">{formError}</span>
                  </div>
                )}

                {/* Botões */}
                <div className="flex flex-col gap-3">
                  <button disabled={submitting} type="submit"
                    className="w-full flex items-center justify-center gap-2 text-white font-bold py-4 md:py-5 rounded-xl hover:shadow-xl hover:scale-[1.01] active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100 transition-all text-base md:text-lg shadow-lg shadow-blue-900/10"
                    style={{ backgroundColor: THEME.primary }}>
                    {submitting ? <Loader2 className="h-6 w-6 animate-spin" /> : (
                      <>
                        <Save size={20} />
                        {isBatismo ? `Salvar ${nominalPersons.filter(p => p.name.trim().length >= 2).length} Batismo(s)` :
                         isRetornando ? `Salvar ${nominalPersons.filter(p => p.name.trim().length >= 2).length} Retornando(s)` :
                         isMissionario ? `Salvar ${missionaries.filter(m => m.name.trim().length >= 2).length} Missionário(s)` :
                         isRecomendacao ? 'Salvar Ambos Indicadores' : 'Salvar Lançamento'}
                      </>
                    )}
                  </button>

                  {/* Botão "Sem novidade" */}
                  {(() => {
                    const cellStatus = statusMap.get(`${wardId}-${indicatorId}`)
                    const cellDone = cellStatus?.launched || cellStatus?.reviewed
                    return selectedSlug && wardId && weekStart && !cellDone && (
                      <button type="button" onClick={handleMarkReviewedFromForm} disabled={submitting}
                        className="w-full flex items-center justify-center gap-2 py-3 text-sky-600 bg-sky-50 border border-sky-100 font-bold text-sm rounded-xl hover:bg-sky-100 transition-all disabled:opacity-50">
                        <Eye size={16} /> Sem novidade — marcar como revisado
                      </button>
                    )
                  })()}
                </div>
              </form>
            </div>
          </div>

          {/* ═══ HISTÓRICO RECENTE ═══ */}
          <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-lg border border-slate-200 overflow-hidden">
            <div className="p-6 md:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-100 rounded-xl">
                  <History size={20} className="text-slate-500" />
                </div>
                <div>
                  <h2 className="font-black text-slate-800 text-base md:text-lg">Histórico Recente</h2>
                  <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-tighter">Últimos 5 registros</p>
                </div>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {recentEntries.length === 0 ? (
                <div className="p-10 text-center flex flex-col items-center gap-2">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                    <History size={24} className="text-slate-300" />
                  </div>
                  <p className="text-slate-400 font-medium">Nenhum lançamento recente.</p>
                </div>
              ) : (
                recentEntries.map((entry) => (
                  <div key={entry.id} className="p-4 md:p-6 hover:bg-slate-50 transition-colors flex justify-between items-center group gap-3">
                    <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                      <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0069a8] font-bold">
                        <Hash size={18} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-slate-700 group-hover:text-[#0069a8] transition-colors truncate text-sm md:text-base">
                          {entry.indicators?.display_name}
                        </span>
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1 mt-0.5 truncate">
                          <Building2 size={12} className="shrink-0" /> {entry.wards?.name}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">{entry.value}</div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1 justify-end bg-slate-100 px-2 py-0.5 rounded-full mt-1">
                        <Clock size={10} />
                        {new Date(entry.week_start + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        <p className="text-center text-[10px] text-slate-300 font-bold mt-8 uppercase tracking-widest">
          Chamados a Servir — v1.6.0
        </p>
      </div>
    </main>
  )
}