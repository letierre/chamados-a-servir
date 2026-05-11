import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportPeriod =
  | 'current_month' | 'last_month' | '90d' | '12m' | 'current_year'

export type ReportType = 'summary' | 'nominal' | 'sumo_briefing'
export type NominalSource = 'baptism' | 'returning' | 'missionary'
export type GenderFilter = 'all' | 'M' | 'F'

export type ReportConfig = {
  id: string
  name: string
  recipient_whatsapp: string
  frequency: 'daily' | 'weekly' | 'monthly'
  send_time: string
  send_day: number | null
  indicators: string[]
  ward_ids: string[]
  period: ReportPeriod
  include_targets: boolean
  include_ranking: boolean
  is_active: boolean
  // nominal
  report_type?: ReportType
  nominal_source?: NominalSource | null
  age_min?: number | null
  age_max?: number | null
  gender_filter?: GenderFilter
}

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  current_month: 'Mês Atual',
  last_month: 'Mês Passado',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
  current_year: 'Ano Atual',
}

const RECOMENDACAO_SLUGS = [
  'recomendacao_templo_com_investidura',
  'recomendacao_templo_sem_investidura',
]

function getDateRange(period: ReportPeriod): { start: string; end: string } {
  const now = new Date()
  let start: Date, end: Date
  switch (period) {
    case 'current_month': start = new Date(now.getFullYear(), now.getMonth(), 1); end = now; break
    case 'last_month':    start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); break
    case '90d':           start = new Date(now); start.setDate(start.getDate() - 90); end = now; break
    case '12m':           start = new Date(now); start.setFullYear(start.getFullYear() - 1); end = now; break
    case 'current_year':  start = new Date(now.getFullYear(), 0, 1); end = now; break
  }
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

function shortName(name: string): string {
  return name
    .replace('Recomendações para o Templo - Membros ', 'Rec. ')
    .replace('Frequência da Reunião ', 'Freq. ')
    .replace('Missionários Servindo do Brasil', 'Missionários')
    .replace('Membros Retornando à Igreja', 'Retornando')
    .replace('Membros Participantes', 'Participantes')
    .replace('Membros Jejuando', 'Jejuando')
    .replace('Batismos de Conversos', 'Batismos')
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

type RpcRow = {
  ward_id: string; ward_name: string; ward_membership: number | null
  indicator_id: string; display_name: string; slug: string
  indicator_type: string; aggregation_method: string
  responsibility: string; order_index: number; computed_value: number
}

// ═══════════════════════════════════════
// DISPATCHER
// ═══════════════════════════════════════

export async function buildReportMessage(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<string> {
  if (config.report_type === 'nominal') {
    return buildNominalMessage(supabase, config)
  }
  if (config.report_type === 'sumo_briefing') {
    return buildSumoBriefingMessage(supabase, config)
  }
  return buildSummaryMessage(supabase, config)
}

// ═══════════════════════════════════════
// RESUMO DE INDICADORES (padrão)
// ═══════════════════════════════════════

async function buildSummaryMessage(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<string> {
  const { start, end } = getDateRange(config.period)
  const isLongPeriod = ['90d', '12m', 'current_year'].includes(config.period)

  // 1) Dados do RPC + contagem nominal de batismos (mesma lógica do dashboard)
  const [rpcRes, baptismByWardRes] = await Promise.all([
    supabase.rpc('get_dashboard_data_v2', { p_start: start, p_end: end }),
    supabase.from('baptism_records').select('ward_id').gte('baptism_date', start).lte('baptism_date', end),
  ])

  if (rpcRes.error) throw new Error(`RPC get_dashboard_data_v2: ${rpcRes.error.message}`)
  let rows: RpcRow[] = rpcRes.data || []

  // Override batismo nominal por ala
  if (baptismByWardRes.data) {
    const countByWard = new Map<string, number>()
    for (const b of baptismByWardRes.data as { ward_id: string }[]) {
      countByWard.set(b.ward_id, (countByWard.get(b.ward_id) || 0) + 1)
    }
    rows = rows.map(r =>
      r.slug === 'batismo_converso'
        ? { ...r, computed_value: countByWard.get(r.ward_id) || 0 }
        : r,
    )
  }

  // 2) Filtrar por alas selecionadas (vazio = estaca inteira)
  const filterByWards = config.ward_ids.length > 0
  const selectedWardSet = new Set(config.ward_ids)
  const filteredRows = filterByWards
    ? rows.filter(r => selectedWardSet.has(r.ward_id))
    : rows

  // Quais alas aparecem no relatório
  const wardMap = new Map<string, { id: string; name: string; membership: number | null }>()
  for (const r of filteredRows) {
    if (!wardMap.has(r.ward_id)) {
      wardMap.set(r.ward_id, { id: r.ward_id, name: r.ward_name, membership: r.ward_membership })
    }
  }
  const wards = Array.from(wardMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  // 3) Alvos (targets) — só se include_targets
  const targetMatrix: Record<string, Record<string, number>> = {}
  if (config.include_targets) {
    const { data: targetsData } = await supabase
      .from('indicator_targets')
      .select('indicator_id, ward_id, target_value')
    if (targetsData) {
      for (const t of targetsData as { indicator_id: string; ward_id: string; target_value: number }[]) {
        if (!targetMatrix[t.indicator_id]) targetMatrix[t.indicator_id] = {}
        targetMatrix[t.indicator_id][t.ward_id] = Number(t.target_value) || 0
      }
    }
  }

  // 4) Agrupar por indicador selecionado
  const byIndicator = new Map<string, RpcRow[]>()
  for (const row of filteredRows) {
    if (!config.indicators.includes(row.slug)) continue
    const arr = byIndicator.get(row.indicator_id) || []
    arr.push(row)
    byIndicator.set(row.indicator_id, arr)
  }

  // Ordenar indicadores pela order_index
  const indicatorOrder = Array.from(byIndicator.values())
    .map(rs => ({ id: rs[0].indicator_id, order: rs[0].order_index }))
    .sort((a, b) => a.order - b.order)

  // 5) Montar mensagem
  const lines: string[] = []
  lines.push(`📊 *${config.name}*`)
  lines.push(`📅 Período: ${PERIOD_LABELS[config.period]}`)
  lines.push(
    filterByWards
      ? `🏛️ Alas: ${wards.map(w => w.name).join(', ')}`
      : `🏛️ Estaca (${wards.length} alas)`,
  )
  lines.push('')
  lines.push('━━━━━━━━━━━━━━━')

  if (indicatorOrder.length === 0) {
    lines.push('')
    lines.push('⚠️ Nenhum indicador selecionado.')
  }

  for (const { id: indicatorId } of indicatorOrder) {
    const wardRows = byIndicator.get(indicatorId)!
    const first = wardRows[0]
    const slug = first.slug
    const isRecomendacao = RECOMENDACAO_SLUGS.includes(slug)
    const isAvg = first.aggregation_method === 'avg' || (isRecomendacao && isLongPeriod)

    const values = wardRows.map(r => r.computed_value)
    const total = values.reduce((s, v) => s + v, 0)
    const mainValue = isAvg ? total / values.length : total
    const valueLabel = isAvg ? 'Média' : 'Total'

    lines.push('')
    lines.push(`📈 *${shortName(first.display_name)}*`)
    lines.push(`   ${valueLabel}: ${fmt(mainValue)}`)

    // Targets: soma dos targets das alas selecionadas
    if (config.include_targets && targetMatrix[indicatorId]) {
      const selectedTargets = wardRows
        .map(r => targetMatrix[indicatorId][r.ward_id] || 0)
        .filter(t => t > 0)
      if (selectedTargets.length > 0) {
        const targetTotal = selectedTargets.reduce((s, v) => s + v, 0)
        const targetRef = isAvg ? targetTotal / selectedTargets.length : targetTotal
        const progress = targetRef > 0 ? (mainValue / targetRef) * 100 : 0
        lines.push(`   Meta: ${fmt(targetRef)}`)
        lines.push(`   Progresso: ${fmt(progress)}%`)
      }
    }

    // Ranking por ala
    if (config.include_ranking && wardRows.length > 1) {
      const ranked = [...wardRows].sort((a, b) => b.computed_value - a.computed_value)
      const best = ranked[0]
      const worst = ranked[ranked.length - 1]
      lines.push(`   🏆 Melhor: ${best.ward_name} (${fmt(best.computed_value)})`)
      lines.push(`   ⚠️ Atenção: ${worst.ward_name} (${fmt(worst.computed_value)})`)
    }
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━')
  lines.push('')
  const nowLabel = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  lines.push(`_Gerado em ${nowLabel}_`)
  lines.push('_Chamados a Servir_')

  return lines.join('\n')
}

// ═══════════════════════════════════════
// LISTA NOMINAL (batismos / retornando / missionários)
// ═══════════════════════════════════════

const NOMINAL_LABELS: Record<NominalSource, { title: string; emoji: string; dateLabel: string }> = {
  baptism:    { title: 'Batismos realizados',         emoji: '✝️',  dateLabel: 'Semana' },
  returning:  { title: 'Membros retornando',          emoji: '🙏',  dateLabel: 'Semana' },
  missionary: { title: 'Missionários servindo',       emoji: '📖',  dateLabel: 'Missão' },
}

function calcAge(birthDate: string | null, refDate: Date): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate + 'T12:00:00')
  let age = refDate.getFullYear() - b.getFullYear()
  const m = refDate.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && refDate.getDate() < b.getDate())) age--
  return age
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

type NominalPerson = {
  person_name: string
  birth_date: string | null
  gender: string | null
  ward_id: string
  date_ref: string | null
}

async function buildNominalMessage(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<string> {
  const source = config.nominal_source
  if (!source) throw new Error('Configuração nominal sem fonte (nominal_source).')

  const { start, end } = getDateRange(config.period)
  const ageRef = new Date()

  // 1) Buscar registros + alas (para nomes)
  const [wardsRes, recordsRes] = await Promise.all([
    supabase.from('wards').select('id, name'),
    fetchNominalRecords(supabase, source, start, end),
  ])
  if (recordsRes.error) throw new Error(`Fonte ${source}: ${recordsRes.error.message}`)

  const wardMap = new Map<string, string>()
  for (const w of (wardsRes.data as { id: string; name: string }[] || [])) wardMap.set(w.id, w.name)

  // 2) Filtrar por alas (vazio = todas)
  const filterByWards = config.ward_ids.length > 0
  const wardSet = new Set(config.ward_ids)

  const gender = config.gender_filter || 'all'
  const ageMin = config.age_min ?? null
  const ageMax = config.age_max ?? null

  const people: Array<NominalPerson & { age: number | null; wardName: string }> = []
  for (const r of (recordsRes.data || [])) {
    if (filterByWards && !wardSet.has(r.ward_id)) continue
    if (gender !== 'all' && r.gender !== gender) continue
    const age = calcAge(r.birth_date, ageRef)
    if (ageMin !== null && (age === null || age < ageMin)) continue
    if (ageMax !== null && (age === null || age > ageMax)) continue
    people.push({ ...r, age, wardName: wardMap.get(r.ward_id) || '—' })
  }

  // 3) Ordenar por ala e depois por data
  people.sort((a, b) => {
    const w = a.wardName.localeCompare(b.wardName)
    if (w !== 0) return w
    return (b.date_ref || '').localeCompare(a.date_ref || '')
  })

  // 4) Montar mensagem
  const meta = NOMINAL_LABELS[source]
  const lines: string[] = []
  lines.push(`${meta.emoji} *${config.name}*`)
  lines.push(`📋 ${meta.title}`)
  lines.push(`📅 Período: ${PERIOD_LABELS[config.period]}`)

  const filterBits: string[] = []
  if (ageMin !== null && ageMax !== null) filterBits.push(`${ageMin}–${ageMax} anos`)
  else if (ageMin !== null) filterBits.push(`a partir de ${ageMin} anos`)
  else if (ageMax !== null) filterBits.push(`até ${ageMax} anos`)
  if (gender === 'M') filterBits.push('Masculino')
  else if (gender === 'F') filterBits.push('Feminino')
  if (filterBits.length > 0) lines.push(`👥 Filtros: ${filterBits.join(' · ')}`)

  if (filterByWards) {
    const names = Array.from(new Set(config.ward_ids.map(id => wardMap.get(id)).filter(Boolean))) as string[]
    lines.push(`🏛️ Alas: ${names.join(', ')}`)
  } else {
    lines.push(`🏛️ Estaca (todas as alas)`)
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━')

  if (people.length === 0) {
    lines.push('')
    lines.push('_Nenhum registro encontrado para os filtros selecionados._')
  } else {
    let currentWard = ''
    for (const p of people) {
      if (p.wardName !== currentWard) {
        currentWard = p.wardName
        lines.push('')
        lines.push(`*${currentWard}*`)
      }
      const ageStr = p.age !== null ? `${p.age}a` : ''
      const genderStr = p.gender === 'M' ? 'M' : p.gender === 'F' ? 'F' : ''
      const meta = [ageStr, genderStr].filter(Boolean).join(' · ')
      const dateStr = p.date_ref ? ` — ${formatShortDate(p.date_ref)}` : ''
      lines.push(`• ${p.person_name}${meta ? ` (${meta})` : ''}${dateStr}`)
    }
    lines.push('')
    lines.push(`📊 *Total: ${people.length} pessoa${people.length === 1 ? '' : 's'}*`)
  }

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━')
  lines.push('')
  const nowLabel = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  lines.push(`_Gerado em ${nowLabel}_`)
  lines.push('_Chamados a Servir_')

  return lines.join('\n')
}

async function fetchNominalRecords(
  supabase: SupabaseClient,
  source: NominalSource,
  start: string,
  end: string,
): Promise<{ data: NominalPerson[] | null; error: { message: string } | null }> {
  if (source === 'baptism') {
    const res = await supabase
      .from('baptism_records')
      .select('person_name, birth_date, gender, ward_id, baptism_date')
      .gte('baptism_date', start).lte('baptism_date', end)
    return {
      error: res.error,
      data: (res.data as Array<{ person_name: string; birth_date: string | null; gender: string | null; ward_id: string; baptism_date: string }> | null)
        ?.map(r => ({ ...r, date_ref: r.baptism_date })) ?? null,
    }
  }
  if (source === 'returning') {
    const res = await supabase
      .from('returning_member_records')
      .select('person_name, birth_date, gender, ward_id, week_start')
      .gte('week_start', start).lte('week_start', end)
    return {
      error: res.error,
      data: (res.data as Array<{ person_name: string; birth_date: string | null; gender: string | null; ward_id: string; week_start: string }> | null)
        ?.map(r => ({ ...r, date_ref: r.week_start })) ?? null,
    }
  }
  // missionary: sem birth_date, sem filtro por período padrão — usamos mission_start_date
  const res = await supabase
    .from('missionary_records')
    .select('person_name, gender, ward_id, mission_start_date, mission_end_date')
    .gte('mission_start_date', start).lte('mission_start_date', end)
  return {
    error: res.error,
    data: (res.data as Array<{ person_name: string; gender: string | null; ward_id: string; mission_start_date: string | null; mission_end_date: string | null }> | null)
      ?.map(r => ({
        person_name: r.person_name,
        birth_date: null,
        gender: r.gender,
        ward_id: r.ward_id,
        date_ref: r.mission_start_date,
      })) ?? null,
  }
}

// ═══════════════════════════════════════
// BRIEFING SUMO CONSELHEIRO (WhatsApp)
// ═══════════════════════════════════════

async function buildSumoBriefingMessage(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<string> {
  const { start, end } = getDateRange(config.period)
  const { data: wardsData } = await supabase.from('wards').select('id, name')
  const wardMap = new Map<string, string>()
  for (const w of (wardsData as { id: string; name: string }[] || [])) wardMap.set(w.id, w.name)

  const filterByWards = config.ward_ids.length > 0
  const selectedWardSet = new Set(config.ward_ids)

  const { data: rpcData } = await supabase.rpc('get_dashboard_data_v2', { p_start: start, p_end: end })
  const rows = (rpcData || []) as any[]

  const targetMatrix: Record<string, Record<string, number>> = {}
  const { data: targetsData } = await supabase
    .from('targets')
    .select('indicator_id, ward_id, target_value')
    .eq('year', new Date().getFullYear())
  if (targetsData) {
    for (const t of targetsData as { indicator_id: string; ward_id: string; target_value: number }[]) {
      if (!targetMatrix[t.indicator_id]) targetMatrix[t.indicator_id] = {}
      targetMatrix[t.indicator_id][t.ward_id] = Number(t.target_value) || 0
    }
  }

  const filteredRows = filterByWards
    ? rows.filter((r: any) => selectedWardSet.has(r.ward_id))
    : rows

  const wards = Array.from(new Set(filteredRows.map((r: any) => r.ward_id)))
    .map(id => ({ id, name: wardMap.get(id) || '—' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  let message = `📋 *Briefing para Sumo Conselheiro*\n`
  message += `Período: ${PERIOD_LABELS[config.period]}\n\n`

  for (const ward of wards) {
    const wardRows = filteredRows.filter((r: any) => r.ward_id === ward.id)
    const grouped = new Map<string, any[]>()
    for (const r of wardRows) {
      const arr = grouped.get(r.indicator_id) || []
      arr.push(r)
      grouped.set(r.indicator_id, arr)
    }

    message += `🏠 *${ward.name}*\n`
    for (const [, group] of grouped) {
      const first = group[0]
      const total = group.reduce((s: number, r: any) => s + r.computed_value, 0)
      const target = targetMatrix[first.indicator_id]?.[ward.id] || 0
      const progress = target > 0 ? Math.round((total / target) * 100) : 0
      const icon = progress >= 80 ? '✅' : progress >= 40 ? '⚠️' : '🔴'
      message += `${icon} ${first.display_name}: ${total}${target > 0 ? ' / ' + target + ' (' + progress + '%)' : ''}\n`
    }
    message += '\n'
  }

  message += `💡 *Sugestão:* Gere o PDF completo no módulo de Relatórios para levar ao conselho da ala.`

  return message
}

