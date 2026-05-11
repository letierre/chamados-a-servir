import type { SupabaseClient } from '@supabase/supabase-js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ReportConfig, ReportPeriod, NominalSource } from './build-message'

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  current_month: 'Mês Atual',
  last_month: 'Mês Passado',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
  current_year: 'Ano Atual',
}

const NOMINAL_TITLES: Record<NominalSource, string> = {
  baptism: 'Batismos realizados',
  returning: 'Membros retornando',
  missionary: 'Missionários servindo',
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

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function calcAge(birthDate: string | null, refDate: Date): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate + 'T12:00:00')
  let age = refDate.getFullYear() - b.getFullYear()
  const m = refDate.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && refDate.getDate() < b.getDate())) age--
  return age
}

type RpcRow = {
  ward_id: string; ward_name: string; ward_membership: number | null
  indicator_id: string; display_name: string; slug: string
  indicator_type: string; aggregation_method: string
  responsibility: string; order_index: number; computed_value: number
}

// ═══════════════════════════════════════
// HEADER + FOOTER em todas as páginas
// ═══════════════════════════════════════

function drawHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  // faixa colorida
  doc.setFillColor(30, 106, 141) // #1e6a8d
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Chamados a Servir', 14, 10)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(subtitle, 14, 16)
  doc.setTextColor(0, 0, 0)
  // título do relatório
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 32)
}

function drawFooter(doc: jsPDF) {
  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const generated = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.text(`Gerado em ${generated}`, 14, pageHeight - 8)
    doc.text(`${i} / ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
    doc.setTextColor(0, 0, 0)
  }
}

// ═══════════════════════════════════════
// DISPATCHER
// ═══════════════════════════════════════

export async function buildReportPdf(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<jsPDF> {
  if (config.report_type === 'nominal') {
    return buildNominalPdf(supabase, config)
  }
  if (config.report_type === 'sumo_briefing') {
    return buildSumoBriefingPdf(supabase, config)
  }
  return buildSummaryPdf(supabase, config)
}

// ═══════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════

async function buildSummaryPdf(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<jsPDF> {
  const { start, end } = getDateRange(config.period)
  const isLongPeriod = ['90d', '12m', 'current_year'].includes(config.period)

  const yearStart = `${new Date(end).getFullYear()}-01-01`

  const [rpcRes, baptismByWardRes, returningByWardRes, missionaryByWardRes] = await Promise.all([
    supabase.rpc('get_dashboard_data_v2', { p_start: start, p_end: end }),
    supabase.from('baptism_records').select('ward_id').gte('baptism_date', yearStart).lte('baptism_date', end),
    supabase.from('returning_member_records').select('ward_id').gte('week_start', yearStart).lte('week_start', end),
    supabase.from('missionary_records').select('ward_id').gte('mission_start_date', yearStart).lte('mission_start_date', end),
  ])
  if (rpcRes.error) throw new Error(`RPC get_dashboard_data_v2: ${rpcRes.error.message}`)

  if (baptismByWardRes.error) console.error('Erro query batismos:', baptismByWardRes.error.message)
  if (returningByWardRes.error) console.error('Erro query retornando:', returningByWardRes.error.message)
  if (missionaryByWardRes.error) console.error('Erro query missionários:', missionaryByWardRes.error.message)

  let rows: RpcRow[] = rpcRes.data || []

  // Override nominal indicators with cumulative year-to-date counts
  const nominalOverrides: Record<string, Map<string, number>> = {}
  for (const [slug, data] of [
    ['batismo_converso', baptismByWardRes.data],
    ['membros_retornando_a_igreja', returningByWardRes.data],
    ['missionario_servindo_missao_do_brasil', missionaryByWardRes.data],
  ] as const) {
    if (!data) { console.debug(`buildSummaryPdf: sem dados para ${slug}`); continue }
    const map = new Map<string, number>()
    for (const r of data as { ward_id: string }[]) {
      map.set(r.ward_id, (map.get(r.ward_id) || 0) + 1)
    }
    nominalOverrides[slug] = map
    console.debug(`buildSummaryPdf: ${slug} ->`, Object.fromEntries(map))
  }
  rows = rows.map(r => {
    const override = nominalOverrides[r.slug]
    if (override) {
      const newVal = override.get(r.ward_id) || 0
      console.debug(`buildSummaryPdf: override ${r.slug} ${r.ward_name}: ${r.computed_value} -> ${newVal}`)
      return { ...r, computed_value: newVal }
    }
    return r
  })

  const filterByWards = config.ward_ids.length > 0
  const selectedWardSet = new Set(config.ward_ids)
  const filteredRows = filterByWards ? rows.filter(r => selectedWardSet.has(r.ward_id)) : rows

  const wardMap = new Map<string, string>()
  for (const r of filteredRows) if (!wardMap.has(r.ward_id)) wardMap.set(r.ward_id, r.ward_name)
  const wards = Array.from(wardMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const targetMatrix: Record<string, Record<string, number>> = {}
  if (config.include_targets) {
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
  }

  const byIndicator = new Map<string, RpcRow[]>()
  for (const row of filteredRows) {
    if (!config.indicators.includes(row.slug)) continue
    const arr = byIndicator.get(row.indicator_id) || []
    arr.push(row)
    byIndicator.set(row.indicator_id, arr)
  }
  const indicatorOrder = Array.from(byIndicator.values())
    .map(rs => ({ id: rs[0].indicator_id, order: rs[0].order_index }))
    .sort((a, b) => a.order - b.order)

  // ── Renderiza PDF ──
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const subtitle = `${PERIOD_LABELS[config.period]} · ${filterByWards ? `${wards.length} ala(s)` : 'Estaca (todas as alas)'}`
  drawHeader(doc, config.name, subtitle)

  let y = 40
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  const pageWidthMm = doc.internal.pageSize.getWidth()
  const usableWidth = pageWidthMm - 28
  const summaryHeader = filterByWards ? `Alas: ${wards.map(w => w.name).join(', ')}` : 'Escopo: estaca completa'
  const summaryLines = doc.splitTextToSize(summaryHeader, usableWidth)
  doc.text(summaryLines, 14, y)
  y += summaryLines.length * 4.5 + 3
  doc.setTextColor(0, 0, 0)

  if (indicatorOrder.length === 0) {
    doc.setFontSize(10)
    doc.text('Nenhum indicador selecionado.', 14, y)
    drawFooter(doc)
    return doc
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

    let targetLine = ''
    if (config.include_targets && targetMatrix[indicatorId]) {
      const selectedTargets = wardRows
        .map(r => targetMatrix[indicatorId][r.ward_id] || 0)
        .filter(t => t > 0)
      if (selectedTargets.length > 0) {
        const targetTotal = selectedTargets.reduce((s, v) => s + v, 0)
        const targetRef = isAvg ? targetTotal / selectedTargets.length : targetTotal
        const progress = targetRef > 0 ? (mainValue / targetRef) * 100 : 0
        targetLine = `Meta: ${fmt(targetRef)} · Progresso: ${fmt(progress)}%`
      }
    }

    autoTable(doc, {
      startY: y,
      head: [[first.display_name, `${valueLabel}: ${fmt(mainValue)}`]],
      body: targetLine ? [[{ content: targetLine, colSpan: 2, styles: { fontStyle: 'italic', textColor: [80, 80, 80] } }]] : [],
      headStyles: { fillColor: [30, 106, 141], textColor: 255, fontStyle: 'bold', fontSize: 10, overflow: 'linebreak', cellPadding: 2 },
      bodyStyles: { fontSize: 9, overflow: 'linebreak', cellPadding: 2 },
      theme: 'grid',
      margin: { left: 14, right: 14 },
      tableWidth: 'auto',
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 50, halign: 'right' },
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2

    // Tabela por ala
    const ranked = config.include_ranking
      ? [...wardRows].sort((a, b) => b.computed_value - a.computed_value)
      : [...wardRows].sort((a, b) => a.ward_name.localeCompare(b.ward_name))

    autoTable(doc, {
      startY: y,
      head: [['Ala', 'Valor', ...(config.include_targets ? ['Meta'] : [])]],
      body: ranked.map(r => {
        const cells = [r.ward_name, fmt(r.computed_value)]
        if (config.include_targets) {
          const t = targetMatrix[indicatorId]?.[r.ward_id] || 0
          cells.push(t > 0 ? fmt(t) : '—')
        }
        return cells
      }),
      headStyles: { fillColor: [240, 245, 250], textColor: [30, 106, 141], fontStyle: 'bold', fontSize: 9, overflow: 'linebreak', cellPadding: 2 },
      bodyStyles: { fontSize: 9, overflow: 'linebreak', cellPadding: 2 },
      theme: 'striped',
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 28, halign: 'right' },
        ...(config.include_targets ? { 2: { cellWidth: 28, halign: 'right' } } : {}),
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    // quebra de página se necessário
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage()
      drawHeader(doc, config.name, subtitle)
      y = 40
    }
  }

  drawFooter(doc)
  return doc
}

// ═══════════════════════════════════════
// NOMINAL
// ═══════════════════════════════════════

type NominalRow = {
  person_name: string
  birth_date: string | null
  gender: string | null
  ward_id: string
  date_ref: string | null
}

async function fetchNominalRecords(
  supabase: SupabaseClient,
  source: NominalSource,
  start: string,
  end: string,
): Promise<{ data: NominalRow[] | null; error: { message: string } | null }> {
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
  const res = await supabase
    .from('missionary_records')
    .select('person_name, gender, ward_id, mission_start_date, mission_end_date')
    .gte('mission_start_date', start).lte('mission_start_date', end)
  return {
    error: res.error,
    data: (res.data as Array<{ person_name: string; gender: string | null; ward_id: string; mission_start_date: string | null; mission_end_date: string | null }> | null)
      ?.map(r => ({ person_name: r.person_name, birth_date: null, gender: r.gender, ward_id: r.ward_id, date_ref: r.mission_start_date })) ?? null,
  }
}

async function buildNominalPdf(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<jsPDF> {
  const source = config.nominal_source
  if (!source) throw new Error('Configuração nominal sem fonte (nominal_source).')

  const { start, end } = getDateRange(config.period)
  const ageRef = new Date()

  const [wardsRes, recordsRes] = await Promise.all([
    supabase.from('wards').select('id, name'),
    fetchNominalRecords(supabase, source, start, end),
  ])
  if (recordsRes.error) throw new Error(`Fonte ${source}: ${recordsRes.error.message}`)

  const wardMap = new Map<string, string>()
  for (const w of (wardsRes.data as { id: string; name: string }[] || [])) wardMap.set(w.id, w.name)

  const filterByWards = config.ward_ids.length > 0
  const wardSet = new Set(config.ward_ids)
  const gender = config.gender_filter || 'all'
  const ageMin = config.age_min ?? null
  const ageMax = config.age_max ?? null

  const people: Array<NominalRow & { age: number | null; wardName: string }> = []
  for (const r of (recordsRes.data || [])) {
    if (filterByWards && !wardSet.has(r.ward_id)) continue
    if (gender !== 'all' && r.gender !== gender) continue
    const age = calcAge(r.birth_date, ageRef)
    if (ageMin !== null && (age === null || age < ageMin)) continue
    if (ageMax !== null && (age === null || age > ageMax)) continue
    people.push({ ...r, age, wardName: wardMap.get(r.ward_id) || '—' })
  }
  people.sort((a, b) => {
    const w = a.wardName.localeCompare(b.wardName)
    if (w !== 0) return w
    return (b.date_ref || '').localeCompare(a.date_ref || '')
  })

  // ── Render ──
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const subtitle = `${NOMINAL_TITLES[source]} · ${PERIOD_LABELS[config.period]}`
  drawHeader(doc, config.name, subtitle)

  let y = 40
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)

  const pageWidthMm = doc.internal.pageSize.getWidth()
  const usableWidth = pageWidthMm - 28 // 14mm de margem cada lado
  const writeWrapped = (text: string) => {
    const lines = doc.splitTextToSize(text, usableWidth)
    doc.text(lines, 14, y)
    y += lines.length * 4.5
  }

  const filterBits: string[] = []
  if (ageMin !== null && ageMax !== null) filterBits.push(`Idade ${ageMin}–${ageMax}`)
  else if (ageMin !== null) filterBits.push(`Idade ≥ ${ageMin}`)
  else if (ageMax !== null) filterBits.push(`Idade ≤ ${ageMax}`)
  if (gender === 'M') filterBits.push('Masculino')
  else if (gender === 'F') filterBits.push('Feminino')
  if (filterBits.length > 0) writeWrapped(`Filtros: ${filterBits.join(' · ')}`)

  if (filterByWards) {
    const names = Array.from(new Set(config.ward_ids.map(id => wardMap.get(id)).filter(Boolean))) as string[]
    writeWrapped(`Alas: ${names.join(', ')}`)
  } else {
    writeWrapped('Escopo: estaca (todas as alas)')
  }
  writeWrapped(`Total encontrado: ${people.length} pessoa(s)`)
  doc.setTextColor(0, 0, 0)

  if (people.length === 0) {
    y += 6
    doc.setFontSize(10)
    doc.text('Nenhum registro encontrado para os filtros selecionados.', 14, y)
    drawFooter(doc)
    return doc
  }

  // Agrupa por ala
  const byWard = new Map<string, typeof people>()
  for (const p of people) {
    const arr = byWard.get(p.wardName) || []
    arr.push(p)
    byWard.set(p.wardName, arr)
  }

  for (const [wardName, list] of byWard) {
    autoTable(doc, {
      startY: y + 2,
      head: [[{ content: `${wardName}  (${list.length})`, colSpan: 4, styles: { fillColor: [30, 106, 141], textColor: 255, fontStyle: 'bold', overflow: 'linebreak', cellPadding: 2 } }]],
      body: [],
      theme: 'grid',
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

    autoTable(doc, {
      startY: y,
      head: [['Nome', 'Idade', 'Gênero', source === 'missionary' ? 'Início' : 'Data']],
      body: list.map(p => [
        p.person_name,
        p.age !== null ? `${p.age}` : '—',
        p.gender === 'M' ? 'Masculino' : p.gender === 'F' ? 'Feminino' : '—',
        formatShortDate(p.date_ref),
      ]),
      headStyles: { fillColor: [240, 245, 250], textColor: [30, 106, 141], fontStyle: 'bold', fontSize: 9, overflow: 'linebreak', cellPadding: 2 },
      bodyStyles: { fontSize: 9, overflow: 'linebreak', cellPadding: 2 },
      theme: 'striped',
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 16, halign: 'center' },
        2: { cellWidth: 24, halign: 'center' },
        3: { cellWidth: 24, halign: 'center' },
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage()
      drawHeader(doc, config.name, subtitle)
      y = 40
    }
  }

  drawFooter(doc)
  return doc
}

// ═══════════════════════════════════════
// BRIEFING SUMO CONSELHEIRO
// ═══════════════════════════════════════

async function buildSumoBriefingPdf(
  supabase: SupabaseClient,
  config: ReportConfig,
): Promise<jsPDF> {
  const { start, end } = getDateRange(config.period)

  const yearStart = `${new Date(end).getFullYear()}-01-01`

  const [rpcRes, baptismByWardRes, returningByWardRes, missionaryByWardRes, wardsRes] = await Promise.all([
    supabase.rpc('get_dashboard_data_v2', { p_start: start, p_end: end }),
    supabase.from('baptism_records').select('ward_id').gte('baptism_date', yearStart).lte('baptism_date', end),
    supabase.from('returning_member_records').select('ward_id').gte('week_start', yearStart).lte('week_start', end),
    supabase.from('missionary_records').select('ward_id').gte('mission_start_date', yearStart).lte('mission_start_date', end),
    supabase.from('wards').select('id, name, membership_count'),
  ])
  if (rpcRes.error) throw new Error(`RPC get_dashboard_data_v2: ${rpcRes.error.message}`)

  // Log errors nas queries nominais (não devem falhar silenciosamente)
  if (baptismByWardRes.error) console.error('Erro query batismos:', baptismByWardRes.error.message)
  if (returningByWardRes.error) console.error('Erro query retornando:', returningByWardRes.error.message)
  if (missionaryByWardRes.error) console.error('Erro query missionários:', missionaryByWardRes.error.message)

  let rows = (rpcRes.data || []) as RpcRow[]

  // Override nominal indicators with cumulative year-to-date counts
  const nominalOverrides: Record<string, Map<string, number>> = {}
  for (const [slug, data] of [
    ['batismo_converso', baptismByWardRes.data],
    ['membros_retornando_a_igreja', returningByWardRes.data],
    ['missionario_servindo_missao_do_brasil', missionaryByWardRes.data],
  ] as const) {
    if (!data) { console.debug(`buildSumoBriefing: sem dados para ${slug}`); continue }
    const map = new Map<string, number>()
    for (const r of data as { ward_id: string }[]) {
      map.set(r.ward_id, (map.get(r.ward_id) || 0) + 1)
    }
    nominalOverrides[slug] = map
    console.debug(`buildSumoBriefing: ${slug} ->`, Object.fromEntries(map))
  }
  rows = rows.map(r => {
    const override = nominalOverrides[r.slug]
    if (override) {
      const newVal = override.get(r.ward_id) || 0
      if (r.computed_value !== newVal) {
        console.debug(`buildSumoBriefing: override ${r.slug} ${r.ward_name}: ${r.computed_value} -> ${newVal}`)
      }
      return { ...r, computed_value: newVal }
    }
    return r
  })

  const filterByWards = config.ward_ids.length > 0
  const selectedWardSet = new Set(config.ward_ids)
  const filteredRows = filterByWards ? rows.filter(r => selectedWardSet.has(r.ward_id)) : rows

  const wardMap = new Map<string, { name: string; membership: number }>()
  for (const w of (wardsRes.data as { id: string; name: string; membership_count: number }[] || [])) {
    wardMap.set(w.id, { name: w.name, membership: w.membership_count || 0 })
  }

  const wards = Array.from(new Set(filteredRows.map(r => r.ward_id)))
    .map(id => ({ id, ...(wardMap.get(id) || { name: '—', membership: 0 }) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const targetMatrix: Record<string, Record<string, number>> = {}
  const { data: targetsData, error: targetsError } = await supabase
    .from('targets')
    .select('indicator_id, ward_id, target_value')
    .eq('year', new Date().getFullYear())
  if (targetsError) console.error('Erro ao carregar metas:', targetsError.message)
  if (targetsData) {
    for (const t of targetsData as { indicator_id: string; ward_id: string; target_value: number }[]) {
      if (!targetMatrix[t.indicator_id]) targetMatrix[t.indicator_id] = {}
      targetMatrix[t.indicator_id][t.ward_id] = Number(t.target_value) || 0
    }
  }

  const byIndicator = new Map<string, RpcRow[]>()
  for (const row of filteredRows) {
    const arr = byIndicator.get(row.indicator_id) || []
    arr.push(row)
    byIndicator.set(row.indicator_id, arr)
  }
  const indicatorOrder = Array.from(byIndicator.values())
    .map(rs => ({ id: rs[0].indicator_id, display_name: rs[0].display_name, slug: rs[0].slug, order: rs[0].order_index }))
    .filter(i => i.slug !== 'membros_participantes')
    .sort((a, b) => a.order - b.order)

  const isLongPeriod = ['90d', '12m', 'current_year'].includes(config.period)
  const REC = ['recomendacao_templo_com_investidura', 'recomendacao_templo_sem_investidura']

  type WardIndicator = { display_name: string; slug: string; value: number; target: number; progress: number }
  const wardIndicators = new Map<string, WardIndicator[]>()
  for (const ward of wards) {
    const entries: WardIndicator[] = []
    for (const { id, display_name, slug } of indicatorOrder) {
      const wardRows = (byIndicator.get(id) || []).filter(r => r.ward_id === ward.id)
      if (wardRows.length === 0) continue
      const isAvg = wardRows[0].aggregation_method === 'avg' || (REC.includes(slug) && isLongPeriod)
      const values = wardRows.map(r => r.computed_value)
      const total = values.reduce((s, v) => s + v, 0)
      const value = isAvg ? total / values.length : total
      const target = targetMatrix[id]?.[ward.id] || 0
      const progress = target > 0 ? Math.round((value / target) * 100) : 0
      entries.push({ display_name, slug, value: Math.round(value * 10) / 10, target, progress })
    }
    entries.sort((a, b) => a.progress - b.progress)
    wardIndicators.set(ward.id, entries)
  }

  // ── AI Analysis ──
  let aiAnalysis = ''
  try {
    // Agrega métricas por indicador (deduplicado, com progresso calculado)
    const metricsForAI: { indicador: string; valor_atual: number; meta: number; progresso: number }[] = []
    const seenMetrics = new Set<string>()
    for (const ward of wards) {
      for (const entry of (wardIndicators.get(ward.id) || [])) {
        const key = `${ward.id}:${entry.slug}`
        if (seenMetrics.has(key)) continue
        seenMetrics.add(key)
        metricsForAI.push({
          indicador: entry.display_name,
          valor_atual: entry.value,
          meta: entry.target || 0,
          progresso: entry.progress,
        })
      }
    }
    const aiPayload = {
      unidade: wards.map(w => w.name).join(', '),
      data_analise: new Date().toLocaleDateString('pt-BR'),
      periodo_selecionado: PERIOD_LABELS[config.period],
      metricas_atuais: metricsForAI,
      historico_90_dias: [] as any[],
      modo: 'sumo',
    }
    const res = await fetch('/api/ai/analise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiPayload),
    })
    if (res.ok) {
      const json = await res.json()
      aiAnalysis = json.analise || ''
    }
  } catch { /* AI indisponível */ }

  // ── Render PDF ──
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const wardNames = wards.map(w => w.name).join(', ')
  const subtitle = `${PERIOD_LABELS[config.period]} · ${filterByWards ? wardNames : 'Estaca (todas as alas)'}`
  const title = `Relatório do Sumo Conselheiro`

  drawHeader(doc, title, subtitle)

  let y = 40
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Seção 1 — Visão Geral
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 106, 141)
  doc.text('Visão Geral da Unidade', 14, y)
  y += 8

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  for (const ward of wards) {
    doc.text(`${ward.name}: ${ward.membership} membros registrados`, 14, y)
    y += 5
  }
  y += 3

  // Seção 2 — Indicadores em Destaque
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 106, 141)
  doc.text('Indicadores em Destaque', 14, y)
  y += 8

  for (const ward of wards) {
    const entries = wardIndicators.get(ward.id) || []
    if (wards.length > 1) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(80, 80, 80)
      doc.text(ward.name, 14, y)
      y += 6
    }

    if (entries.length === 0) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text('Nenhum dado disponível para o período.', 14, y)
      y += 5
      continue
    }

    autoTable(doc, {
      startY: y,
      head: [['Indicador', 'Valor', 'Meta', 'Progresso']],
      body: entries.map(e => [
        e.display_name,
        fmt(e.value),
        e.target > 0 ? fmt(e.target) : '—',
        e.target > 0 ? `${e.progress}%` : '—',
      ]),
      headStyles: { fillColor: [30, 106, 141], textColor: 255, fontStyle: 'bold', fontSize: 8, overflow: 'linebreak', cellPadding: 2 },
      bodyStyles: { fontSize: 8, overflow: 'linebreak', cellPadding: 2 },
      theme: 'striped',
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 18, halign: 'right' },
        2: { cellWidth: 18, halign: 'right' },
        3: { cellWidth: 42, halign: 'center' },
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 3 && data.cell.raw) {
          const raw = data.cell.raw as string
          const pct = parseInt(raw)
          if (!isNaN(pct)) {
            const barX = data.cell.x + 2
            const barY = data.cell.y + data.cell.height * 0.25
            const barW = data.cell.width - 4
            const barH = data.cell.height * 0.5
            const fillW = Math.min(barW, Math.max(0, (pct / 100) * barW))
            // Background
            doc.setFillColor(229, 231, 235)
            doc.rect(barX, barY, barW, barH, 'F')
            // Fill color (capped at 100% — exceeding target uses a distinct blue)
            let color: [number, number, number]
            if (pct > 100) color = [30, 106, 141]
            else if (pct >= 80) color = [34, 197, 94]
            else if (pct >= 50) color = [234, 179, 8]
            else if (pct >= 30) color = [249, 115, 22]
            else color = [239, 68, 68]
            doc.setFillColor(...color)
            doc.rect(barX, barY, fillW, barH, 'F')
            // Text over bar
            doc.setTextColor(60, 60, 60)
            doc.setFontSize(7)
            doc.setFont('helvetica', 'bold')
            doc.text(`${pct}%`, data.cell.x + data.cell.width / 2, barY + barH / 2 + 0.5, { align: 'center', baseline: 'middle' })
            // Reset text color for subsequent cells
            doc.setTextColor(0, 0, 0)
          }
        }
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

    if (y > pageHeight - 40 && ward !== wards[wards.length - 1]) {
      doc.addPage()
      drawHeader(doc, title, subtitle)
      y = 40
    }
  }
  y += 4

  // Seção 3 — Análise para o Conselho de Ala
  if (aiAnalysis) {
    if (y > pageHeight - 50) { doc.addPage(); drawHeader(doc, title, subtitle); y = 40 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 106, 141)
    doc.text('Análise para o Conselho de Ala', 14, y)
    y += 8

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(cleanMarkdown(aiAnalysis), pageWidth - 28)
    doc.text(lines, 14, y)
    y += lines.length * 4.5 + 4
  }

  // Seção 4 — Nota final
  if (y > pageHeight - 30) { doc.addPage(); drawHeader(doc, title, subtitle); y = 40 }
  y += 3
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(120, 120, 120)
  doc.text('Documento gerado para uso do sumo conselheiro designado — levar ao conselho da ala.', 14, y)
  doc.text('Conteúdo confidencial — destina-se exclusivamente ao sumo conselheiro e à presidência da estaca.', 14, y + 4)

  drawFooter(doc)
  return doc
}

// ═══════════════════════════════════════
// HELPER: salvar com nome amigável
// ═══════════════════════════════════════

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')        // *italic* → plain
    .replace(/^#{1,4}\s+/gm, '')       // ## headers
    .replace(/^---+\s*$/gm, '')         // horizontal rules
    .replace(/\n{3,}/g, '\n\n')         // max 2 consecutive line breaks
    .trim()
}

export function safeFileName(name: string): string {
  const today = new Date().toISOString().split('T')[0]
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'documento'}-${today}.pdf`
}
