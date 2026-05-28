import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

// ─── Ward matching ────────────────────────────────────────────────────────────

function matchWardId(
  wardName: string,
  wards: Array<{ id: string; name: string }>,
): string | null {
  const clean = wardName.toLowerCase().replace(/\b(ward|branch|ala|ramo)\b/g, '').trim()
  const found = wards.find(w => {
    const wc = w.name.toLowerCase().replace(/\b(ala|ramo)\b/g, '').trim()
    return wc.includes(clean) || clean.includes(wc)
  })
  return found?.id ?? null
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 })

    const formData = await request.formData()
    const file = formData.get('pdf') as File | null
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'O arquivo deve ser um PDF.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > 20_000_000) {
      return NextResponse.json({ error: 'PDF muito grande (máximo 20 MB).' }, { status: 400 })
    }
    const base64 = buffer.toString('base64')

    // ── Chamar Claude para extração ──
    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } as any,
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    })

    const rawText = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    // Extrair JSON da resposta
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('IA não retornou JSON válido. Tente novamente.')
    const data = JSON.parse(jsonMatch[0])

    if (!data.year || !data.quarter || !Array.isArray(data.indicators)) {
      throw new Error('Dados extraídos incompletos. Verifique se o PDF é um Relatório Trimestral válido.')
    }

    // ── Salvar no banco ──
    const supabase = createAdminClient()

    // Buscar alas para matching
    const { data: wards } = await supabase.from('wards').select('id, name').eq('active', true)

    // Remover relatório existente do mesmo trimestre (reimportação)
    await supabase
      .from('quarterly_reports')
      .delete()
      .eq('year', data.year)
      .eq('quarter', data.quarter)

    // Inserir cabeçalho
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

    // Inserir indicadores (linhas por ala + linha __stake__)
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

    // Inserir conversos
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
        })
      }
    }
    if (convertRows.length > 0) {
      const { error: cErr } = await supabase.from('quarterly_report_converts').insert(convertRows)
      if (cErr) throw new Error(`Erro ao salvar conversos: ${cErr.message}`)
    }

    return NextResponse.json({
      reportId: report.id,
      year: data.year,
      quarter: data.quarter,
      indicatorsCount: indRows.filter(r => r.ward_name !== '__stake__').length,
      convertsCount: convertRows.length,
    })
  } catch (error: any) {
    console.error('Erro extração relatório trimestral:', error)
    return NextResponse.json({ error: error?.message || 'Erro ao processar PDF.' }, { status: 500 })
  }
}
