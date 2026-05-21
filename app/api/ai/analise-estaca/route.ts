import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── helpers ────────────────────────────────────────────────────────
function lastSundays(n: number): string[] {
  const sundays: string[] = []
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  for (let i = 0; i < n; i++) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    sundays.push(`${yyyy}-${mm}-${dd}`)
    d.setDate(d.getDate() - 7)
  }
  return sundays
}

function trend(values: number[]): { label: string; pct: number } {
  const filled = values.filter(v => v != null)
  if (filled.length < 2) return { label: '→ sem histórico suficiente', pct: 0 }
  const first = filled[filled.length - 1]
  const last = filled[0]
  if (first === 0) return { label: '↑ início de histórico', pct: 100 }
  const pct = Math.round(((last - first) / first) * 100)
  if (pct > 5)  return { label: `↑ +${pct}%`, pct }
  if (pct < -5) return { label: `↓ ${pct}%`, pct }
  return { label: `→ estável (${pct > 0 ? '+' : ''}${pct}%)`, pct }
}

// ─── system prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um consultor estratégico especializado em acompanhamento de indicadores de A Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Você recebe dados estruturados da estaca: cada indicador com os valores das últimas 4 semanas por ala, tendências calculadas e rankings comparativos. Sua análise é lida pela presidência da estaca.

VOCABULÁRIO OBRIGATÓRIO:
- "amigos da Igreja" (NUNCA "investigadores", "pesquisadores" ou "pipeline")
- "membros retornando à atividade" (NUNCA "inativos")
- "frequência sacramental" (não "frequência semanal")
- Respeite Ramo vs Ala. Use o nome exato de cada unidade.
- Sem jargão corporativo ou de vendas.

TOM:
- Direto, sereno, pastoral. Fale SOBRE as unidades, não PARA elas.
- Seja cirúrgico: cite nome da ala, indicador e números exatos.
- NÃO resuma o que já está nos dados. Aponte o que é ANÔMALO.
- Proporcionalidade: se estamos em maio (~42% do ano), 42%+ da meta anual = no caminho certo.

ESTRUTURA (markdown limpo, sem emojis):

**Destaques positivos**
- Máximo 2. Cite ala, indicador e o dado que justifica o destaque.
- Só inclua se for genuinamente relevante, não por obrigação.

**Alertas**
- Máximo 3. Priorize anomalias: queda isolada de uma ala, tendência contrária ao restante, indicador crítico abaixo do proporcional.
- Cite a ala pelo nome, o indicador, os números das últimas semanas e o que torna isso preocupante.

**Ações sugeridas para o conselho da estaca**
- 1 ação por alerta. Concreta, pastoral, acionável.
- Exemplo: "Verificar com o bispo da Ala Marina o que ocorreu nas últimas 3 semanas para a queda na frequência sacramental."

REGRAS ABSOLUTAS:
- Máximo 250 palavras no total.
- Sem introduções ("Aqui está...", "Com base nos dados...").
- Se dados de uma ala estiverem ausentes, ignore-a — não especule.
- Se todos os indicadores estiverem no caminho certo, diga isso claramente e sugira temas de fortalecimento.`

// ─── build prompt ────────────────────────────────────────────────────
function buildPrompt(
  sundays: string[],
  rows: Array<{ ward_name: string; indicator_name: string; indicator_slug: string; order_index: number; week_start: string; value: number }>,
  targets: Array<{ indicator_id: string; target_value: number }>,
  indicators: Array<{ id: string; display_name: string; slug: string; order_index: number }>,
  wards: Array<{ id: string; name: string }>,
): string {
  const now = new Date()
  const mesNome = now.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' })
  const mesNum = now.getMonth() + 1
  const propAno = Math.round((mesNum / 12) * 100)
  const weekAnalyzed = sundays[0]

  // Index data: indicator_slug → ward_name → [week0, week1, week2, week3] (mais recente primeiro)
  const dataIndex: Record<string, Record<string, (number | null)[]>> = {}
  for (const ind of indicators) {
    dataIndex[ind.slug] = {}
    for (const w of wards) {
      dataIndex[ind.slug][w.name] = [null, null, null, null]
    }
  }
  for (const r of rows) {
    const weekIdx = sundays.indexOf(r.week_start)
    if (weekIdx === -1 || weekIdx >= 4) continue
    if (!dataIndex[r.indicator_slug]) continue
    if (!dataIndex[r.indicator_slug][r.ward_name]) {
      dataIndex[r.indicator_slug][r.ward_name] = [null, null, null, null]
    }
    dataIndex[r.indicator_slug][r.ward_name][weekIdx] = r.value
  }

  const sortedIndicators = [...indicators].sort((a, b) => a.order_index - b.order_index)

  let prompt = `ESTACA — ANÁLISE SEMANAL
Semana: ${weekAnalyzed}
Mês: ${mesNome} (${mesNum}/12 — ~${propAno}% do ano)
Progresso proporcional esperado para metas anuais: ${propAno}%

`

  for (const ind of sortedIndicators) {
    const targetObj = targets.find(t => {
      const matchInd = indicators.find(i => i.id === t.indicator_id)
      return matchInd?.slug === ind.slug
    })
    const metaAnual = targetObj?.target_value ?? null
    const metaProporcional = metaAnual ? Math.round(metaAnual * propAno / 100) : null

    prompt += `=== ${ind.display_name.toUpperCase()} ===\n`
    if (metaAnual) {
      prompt += `Meta anual: ${metaAnual} | Acumulado proporcional esperado até agora: ~${metaProporcional}\n`
    }

    // Compute weekly stake averages
    const stakeAvgs = sundays.slice(0, 4).map((_, wIdx) => {
      const vals = wards
        .map(w => dataIndex[ind.slug][w.name]?.[wIdx])
        .filter((v): v is number => v !== null)
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    })

    // Build week-1 rankings
    const week1Values = wards
      .map(w => ({ name: w.name, val: dataIndex[ind.slug][w.name]?.[0] ?? null }))
      .filter(x => x.val !== null)
      .sort((a, b) => (b.val ?? 0) - (a.val ?? 0))
    const rankMap: Record<string, number> = {}
    week1Values.forEach((x, i) => { rankMap[x.name] = i + 1 })

    // Table rows
    const header = `| Ala${' '.repeat(26)} | Sem-1 | Sem-2 | Sem-3 | Sem-4 | Tendência              | Rank |\n`
    const sep = `|${'-'.repeat(30)}|-------|-------|-------|-------|------------------------|------|\n`
    let table = header + sep

    for (const w of [...wards].sort((a, b) => a.name.localeCompare(b.name))) {
      const vals = dataIndex[ind.slug][w.name]
      if (vals.every(v => v === null)) continue // ala sem dados para este indicador

      const cells = vals.map(v => v !== null ? String(v).padStart(5) : '    -')
      const t = trend(vals.filter((v): v is number => v !== null))
      const rank = rankMap[w.name] ? `${rankMap[w.name]}ª` : '-'
      const nameCol = w.name.slice(0, 28).padEnd(28)
      table += `| ${nameCol} |${cells[0]} |${cells[1]} |${cells[2]} |${cells[3]} | ${t.label.padEnd(22)} | ${rank.padEnd(4)} |\n`
    }

    const avgRow = stakeAvgs.map(v => v !== null ? String(v).padStart(5) : '    -')
    table += `| ${'Média da estaca'.padEnd(28)} |${avgRow[0]} |${avgRow[1]} |${avgRow[2]} |${avgRow[3]} |                        |      |\n`

    prompt += table + '\n'
  }

  return prompt
}

// ─── handler ─────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 })

    const body = await request.json().catch(() => ({}))
    const triggerType: string = body.trigger_type ?? 'manual'
    const saveResult: boolean = body.save !== false

    const supabase = createAdminClient()
    const sundays = lastSundays(5) // 5 Sundays → usamos 4 para tendência + 1 de buffer

    // ── 1. Fetch wards
    const { data: wardsData } = await supabase
      .from('wards').select('id, name').eq('active', true).order('name')
    const wards = wardsData ?? []

    // ── 2. Fetch indicators
    const { data: indsData } = await supabase
      .from('indicators').select('id, display_name, slug, order_index').eq('active', true).order('order_index')
    const indicators = indsData ?? []

    // ── 3. Fetch last 4 weeks of data
    const { data: rawRows } = await supabase
      .from('weekly_indicator_data')
      .select(`
        ward_id, indicator_id, week_start, value,
        wards!inner(name),
        indicators!inner(display_name, slug, order_index)
      `)
      .in('week_start', sundays.slice(0, 4))
      .order('week_start', { ascending: false })

    const rows = (rawRows ?? []).map((r: any) => ({
      ward_name: r.wards.name,
      indicator_name: r.indicators.display_name,
      indicator_slug: r.indicators.slug,
      order_index: r.indicators.order_index,
      week_start: r.week_start,
      value: Number(r.value),
    }))

    // ── 4. Fetch targets for current year
    const currentYear = new Date().getFullYear()
    const { data: targetsData } = await supabase
      .from('targets').select('indicator_id, target_value').eq('year', currentYear)
    const targets = targetsData ?? []

    // ── 5. Build structured prompt
    const userMessage = buildPrompt(sundays, rows, targets, indicators, wards)

    // ── 6. Call Claude Sonnet for precision
    const anthropic = new Anthropic({ apiKey })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { signal: controller.signal })

    clearTimeout(timeout)

    const analise = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    // ── 7. Save to ai_analyses
    if (saveResult) {
      await supabase.from('ai_analyses').insert({
        week_start: sundays[0],
        content: analise,
        trigger_type: triggerType,
      })
    }

    return NextResponse.json({ analise, week_start: sundays[0] })
  } catch (error: any) {
    console.error('Erro análise estaca IA:', error)
    return NextResponse.json({ error: error?.message || 'Erro ao gerar análise.' }, { status: 500 })
  }
}
