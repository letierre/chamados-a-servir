import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const INDICATORS_PROMPT = `Extraia os dados de indicadores deste Relatório Trimestral da Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Retorne SOMENTE um objeto JSON MINIFICADO (sem espaços, sem quebras de linha). Nenhum texto antes ou depois.

MAPEAMENTO DE COLUNAS:
Cach=Cachoeira do Sul, Camp=Santa Cruz do Sul Campus, Estr=Estrela, Laj=Lajeado, Mar=Marina, RioP=Rio Pardo, SCS=Santa Cruz do Sul, VAir=Venâncio Aires

REGRAS:
- Números: inteiros sem formatação de milhar
- Células "---" ou em branco: null

SCHEMA:
{"stake_name":"nome da estaca","stake_id":"código numérico","year":2026,"quarter":1,"indicators":[{"number":1,"name":"nome completo do indicador","wards":{"Cachoeira do Sul":45,"Santa Cruz do Sul Campus":67,"Estrela":43,"Lajeado":111,"Marina":64,"Rio Pardo":35,"Santa Cruz do Sul":46,"Venâncio Aires":57},"stake_real":468,"stake_potential":854}]}

Extraia TODOS os 26 indicadores.`

const CONVERTS_PROMPT = `Extraia a lista de conversos (membros batizados recentemente) deste Relatório Trimestral da Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Retorne SOMENTE um objeto JSON MINIFICADO (sem espaços, sem quebras de linha). Nenhum texto antes ou depois.

REGRAS:
- "Sim" → true | "Não" → false | "---" → null
- Sacerdócio "---": null
- Gênero: "M" ou "F"

SCHEMA:
{"converts":[{"ward_name":"Cachoeira do Sul Ward","members":[{"name":"Sobrenome, Nome","gender":"M","age":43,"priesthood":"Não Ordenado","attended_sacrament":false,"has_calling":false}]}]}

Extraia TODOS os conversos de TODAS as unidades.`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchWardId(wardName: string, wards: Array<{ id: string; name: string }>): string | null {
  const clean = wardName.toLowerCase().replace(/\b(ward|branch|ala|ramo)\b/g, '').trim()
  const found = wards.find(w => {
    const wc = w.name.toLowerCase().replace(/\b(ala|ramo)\b/g, '').trim()
    return wc.includes(clean) || clean.includes(wc)
  })
  return found?.id ?? null
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

function quarterDateRange(year: number, quarter: number): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = quarter * 3
  const endDay = [6, 9].includes(endMonth) ? 30 : 31
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end:   `${year}-${String(endMonth).padStart(2, '0')}-${endDay}`,
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('IA não retornou JSON válido.')
  return JSON.parse(match[0])
}

async function callClaude(apiKey: string, base64: string, prompt: string, label: string): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic error (${label}): ${res.status} ${body}`)
  }

  const data = await res.json()
  const text = (data.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('')
  console.log(`${label}: ${text.length} chars, stop_reason: ${data.stop_reason}`)

  if (data.stop_reason === 'max_tokens') {
    throw new Error(`Resposta da IA truncada na chamada de ${label}. O relatório pode ter dados além do esperado.`)
  }

  return extractJson(text)
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY não configurada.' }, 500)

    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    if (!file) return json({ error: 'Nenhum arquivo enviado.' }, 400)
    if (!file.name.toLowerCase().endsWith('.pdf')) return json({ error: 'O arquivo deve ser um PDF.' }, 400)

    const buffer = await file.arrayBuffer()
    if (buffer.byteLength > 20_000_000) return json({ error: 'PDF muito grande (máximo 20 MB).' }, 400)

    const base64 = toBase64(buffer)
    console.log(`PDF: ${(buffer.byteLength / 1024).toFixed(0)} KB`)

    // ── Duas chamadas paralelas ao Sonnet ──
    const [indicatorsData, convertsData] = await Promise.all([
      callClaude(apiKey, base64, INDICATORS_PROMPT, 'indicadores'),
      callClaude(apiKey, base64, CONVERTS_PROMPT,   'conversos'),
    ])

    if (!indicatorsData.year || !indicatorsData.quarter || !Array.isArray(indicatorsData.indicators)) {
      return json({ error: 'Dados de indicadores incompletos. Verifique se o PDF é um Relatório Trimestral válido.' }, 500)
    }

    // ── Supabase ──
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: wards } = await supabase.from('wards').select('id, name').eq('active', true)

    await supabase
      .from('quarterly_reports')
      .delete()
      .eq('year', indicatorsData.year)
      .eq('quarter', indicatorsData.quarter)

    const { data: report, error: rErr } = await supabase
      .from('quarterly_reports')
      .insert({
        year: indicatorsData.year,
        quarter: indicatorsData.quarter,
        stake_name: indicatorsData.stake_name ?? '',
        stake_id: String(indicatorsData.stake_id ?? ''),
        status: 'extracted',
      })
      .select()
      .single()
    if (rErr) return json({ error: `Erro ao criar relatório: ${rErr.message}` }, 500)

    // ── Indicadores ──
    const indRows: any[] = []
    for (const ind of indicatorsData.indicators) {
      for (const [wardName, value] of Object.entries(ind.wards ?? {})) {
        indRows.push({
          report_id: report.id,
          ward_id: matchWardId(wardName, wards ?? []),
          ward_name: wardName,
          indicator_number: ind.number,
          indicator_name: ind.name,
          value: value === null ? null : Number(value),
          stake_real: null,
          stake_potential: null,
        })
      }
      indRows.push({
        report_id: report.id,
        ward_id: null,
        ward_name: '__stake__',
        indicator_number: ind.number,
        indicator_name: ind.name,
        value: null,
        stake_real: ind.stake_real === null ? null : Number(ind.stake_real),
        stake_potential: ind.stake_potential === null ? null : Number(ind.stake_potential),
      })
    }
    const { error: indErr } = await supabase.from('quarterly_report_indicators').insert(indRows)
    if (indErr) return json({ error: `Erro ao salvar indicadores: ${indErr.message}` }, 500)

    // ── Conversos ──
    const convertRows: any[] = []
    for (const ward of convertsData.converts ?? []) {
      const wardId = matchWardId(ward.ward_name, wards ?? [])
      for (const m of ward.members ?? []) {
        convertRows.push({
          report_id: report.id,
          ward_id: wardId,
          ward_name: ward.ward_name,
          name: m.name,
          gender: m.gender ?? null,
          age: m.age ?? null,
          priesthood: m.priesthood ?? null,
          attended_sacrament: m.attended_sacrament ?? null,
          has_calling: m.has_calling ?? null,
          baptism_record_id: null,
        })
      }
    }

    let linkedCount = 0
    if (convertRows.length > 0) {
      const { error: cErr } = await supabase.from('quarterly_report_converts').insert(convertRows)
      if (cErr) return json({ error: `Erro ao salvar conversos: ${cErr.message}` }, 500)

      const { start, end } = quarterDateRange(indicatorsData.year, indicatorsData.quarter)
      const { data: baptisms } = await supabase
        .from('baptism_records')
        .select('id, person_name')
        .gte('baptism_date', start)
        .lte('baptism_date', end)

      if (baptisms?.length) {
        const baptismMap = new Map<string, string>(
          (baptisms as any[]).map(b => [normalizeName(b.person_name), b.id])
        )
        const { data: saved } = await supabase
          .from('quarterly_report_converts')
          .select('id, name')
          .eq('report_id', report.id)

        if (saved) {
          const updates = (saved as any[])
            .map(c => ({ id: c.id, baptism_record_id: baptismMap.get(normalizeName(c.name)) ?? null }))
            .filter(u => u.baptism_record_id !== null)
          linkedCount = updates.length
          await Promise.all(
            updates.map(u =>
              supabase.from('quarterly_report_converts')
                .update({ baptism_record_id: u.baptism_record_id })
                .eq('id', u.id)
            )
          )
        }
      }
    }

    console.log(`OK: ${indRows.filter(r => r.ward_name !== '__stake__').length} indicadores, ${convertRows.length} conversos, ${linkedCount} vinculados`)

    return json({
      reportId: report.id,
      year: indicatorsData.year,
      quarter: indicatorsData.quarter,
      indicatorsCount: indRows.filter(r => r.ward_name !== '__stake__').length,
      convertsCount: convertRows.length,
      linkedConvertsCount: linkedCount,
    })

  } catch (err: any) {
    console.error('Erro:', err?.message ?? err)
    return json({ error: err?.message || 'Erro ao processar PDF.' }, 500)
  }
})
