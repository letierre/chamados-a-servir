import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `Você é um conselheiro analítico que auxilia líderes de estaca e bispos de A Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Você recebe dados de indicadores de uma unidade (ala ou ramo) e produz uma análise curta, direta e útil para tomada de decisão.

TOM:
- Direto e sereno. Nada de linguagem piegas ou "evangélica".
- Terceira pessoa: fale SOBRE a unidade, não PARA a unidade.
- Seja específico: mencione números, tendências, nomes de indicadores.

ESTRUTURA (use markdown limpo, sem emojis pesados):

**Pontos de atenção**
- Indicador com maior gap ou tendência de queda — mencione o valor e a meta.
- Segundo ponto se relevante.

**O que está funcionando**
- Indicador com melhor progresso ou tendência de alta — mencione dados.

**Sugestões**
- 1-2 ações práticas e específicas para o Conselho de Ala considerar.

REGRAS:
- Máximo 150 palavras.
- Vá direto ao ponto. Sem introduções como "Aqui está a análise...".
- Se os dados forem insuficientes, diga isso com clareza.`

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 })
    }

    const body = await request.json()

    const userMessage = `Unidade: ${body.unidade || 'Não informada'}
Período: ${body.periodo_selecionado || 'Não informado'}
Data: ${body.data_analise || 'Não informada'}

Métricas atuais:
${JSON.stringify(body.metricas_atuais || [], null, 2)}

Histórico 90 dias:
${JSON.stringify(body.historico_90_dias || [], null, 2)}`

    const anthropic = new Anthropic({ apiKey })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { signal: controller.signal })

    clearTimeout(timeout)

    const text = msg.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')

    return NextResponse.json({ analise: text })
  } catch (error: any) {
    console.error('Erro análise IA:', error)
    return NextResponse.json(
      { error: error?.message || 'Erro ao gerar análise.' },
      { status: 500 },
    )
  }
}
