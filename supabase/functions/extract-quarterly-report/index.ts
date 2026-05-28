import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Extraia todos os dados deste Relatório Trimestral da Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Retorne SOMENTE um objeto JSON válido. Nenhum texto antes ou depois. Nenhum markdown.

MAPEAMENTO DE COLUNAS (abreviações da tabela → nomes completos):
Cach = Cachoeira do Sul
Camp = Santa Cruz do Sul Campus
Estr = Estrela
Laj  = Lajeado
Mar  = Marina
RioP = Rio Pardo
SCS  = Santa Cruz do Sul
VAir = Venâncio Aires

REGRAS:
- Números: inteiros sem formatação de milhar (ex: 1581, não 1,581)
- Células "---" ou em branco: null
- "Sim" → true | "Não" → false | "---" → null
- Sacerdócio "---": null

SCHEMA OBRIGATÓRIO:
{
  "stake_name": "nome completo da estaca",
  "stake_id": "código numérico no cabeçalho entre parênteses",
  "year": 2026,
  "quarter": 1,
  "indicators": [
    {
      "number": 1,
      "name": "nome completo do indicador conforme aparece no documento",
      "wards": {
        "Cachoeira do Sul": 45,
        "Santa Cruz do Sul Campus": 67,
        "Estrela": 43,
        "Lajeado": 111,
        "Marina": 64,
        "Rio Pardo": 35,
        "Santa Cruz do Sul": 46,
        "Venâncio Aires": 57
      },
      "stake_real": 468,
      "stake_potential": 854
    }
  ],
  "converts": [
    {
      "ward_name": "Cachoeira do Sul Ward",
      "members": [
        {
          "name": "Sobrenome, Nome",
          "gender": "M",
          "age": 43,
          "priesthood": "Não Ordenado",
          "attended_sacrament": false,
          "has_calling": false
        }
      ]
    }
  ]
}

Extraia TODOS os 26 indicadores e TODOS os conversos de TODAS as unidades.`

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

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada.')

    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    if (!file) throw new Error('Nenhum arquivo enviado.')
    if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('O arquivo deve ser um PDF.')

    const buffer = await file.arrayBuffer()
    if (buffer.byteLength > 20_000_000) throw new Error('PDF muito grande (máximo 20 MB).')

    const base64 = toBase64(buffer)

    // ── Claude ──
    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as any,
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    })

    const rawText = (msg.content as any[])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('IA não retornou JSON válido. Tente novamente.')
    const data = JSON.parse(jsonMatch[0])

    if (!data.year || !data.quarter || !Array.isArray(data.indicators)) {
      throw new Error('Dados extraídos incompletos. Verifique se o PDF é um Relatório Trimestral válido.')
    }

    // ── Supabase ──
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: wards } = await supabase.from('wards').select('id, name').eq('active', true)

    await supabase.from('quarterly_reports').delete().eq('year', data.year).eq('quarter', data.quarter)

    const { data: report, error: rErr } = await supabase
      .from('quarterly_reports')
      .insert({
        year: data.year,
        quarter: data.quarter,
        stake_name: data.stake_name ?? '',
        stake_id: String(data.stake_id ?? ''),
        status: 'extracted',
      })
      .select()
      .single()
    if (rErr) throw new Error(`Erro ao criar relatório: ${rErr.message}`)

    // ── Indicadores ──
    const indRows: any[] = []
    for (const ind of data.indicators) {
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
    if (indErr) throw new Error(`Erro ao salvar indicadores: ${indErr.message}`)

    // ── Conversos ──
    const convertRows: any[] = []
    for (const ward of data.converts ?? []) {
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
      if (cErr) throw new Error(`Erro ao salvar conversos: ${cErr.message}`)

      // Cruzar com baptism_records
      const { start, end } = quarterDateRange(data.year, data.quarter)
      const { data: baptisms } = await supabase
        .from('baptism_records')
        .select('id, person_name')
        .gte('baptism_date', start)
        .lte('baptism_date', end)

      if (baptisms && baptisms.length > 0) {
        const baptismMap = new Map<string, string>(
          baptisms.map((b: any) => [normalizeName(b.person_name), b.id])
        )
        const { data: savedConverts } = await supabase
          .from('quarterly_report_converts')
          .select('id, name')
          .eq('report_id', report.id)

        if (savedConverts) {
          const updates = (savedConverts as any[])
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

    return new Response(JSON.stringify({
      reportId: report.id,
      year: data.year,
      quarter: data.quarter,
      indicatorsCount: indRows.filter(r => r.ward_name !== '__stake__').length,
      convertsCount: convertRows.length,
      linkedConvertsCount: linkedCount,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })

  } catch (err: any) {
    console.error('Erro extração relatório trimestral:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Erro ao processar PDF.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})
