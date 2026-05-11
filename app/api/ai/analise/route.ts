import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `Você é um conselheiro analítico que auxilia líderes de estaca e bispos de A Igreja de Jesus Cristo dos Santos dos Últimos Dias.

Você recebe dados de indicadores de uma unidade (ala ou ramo) e produz uma análise curta, direta e útil para tomada de decisão.

CONTEXTO IMPORTANTE:
- Todas as metas são ANUAIS. O progresso deve ser avaliado proporcionalmente ao tempo decorrido no ano.
- Exemplo: se estamos em maio (mês 5 de 12, ~42% do ano), um indicador com 45% da meta está adiantado — não atrasado.
- Só aponte "queda" ou "déficit" quando o valor estiver proporcionalmente abaixo do esperado para o período do ano.

VOCABULÁRIO:
- Use termos do contexto SUD: "amigos da Igreja" (nunca "investigadores" ou "pipeline"), membros retornando à atividade, frequência sacramental, quórum de élderes, conselho de ala.
- RESPEITE a diferença entre Ramo e Ala. Se o nome da unidade contém "Ramo", é um ramo, não uma ala. Use o nome exato da unidade como informado.
- Nada de jargão corporativo ou de vendas.

TOM:
- Direto e sereno. Nada de linguagem piegas ou "evangélica".
- Terceira pessoa: fale SOBRE a unidade, não PARA a unidade.
- Seja específico: mencione números, tendências, nomes de indicadores.
- Quando um indicador estiver proporcionalmente no caminho certo, reconheça isso.

ESTRUTURA (use markdown limpo, sem emojis):

**O que está funcionando**
- Indicador com melhor progresso proporcional em relação à meta anual.
- Destaque positivo com dados.

**Pontos de atenção**
- Indicador com progresso proporcional abaixo do esperado para o período do ano.
- Só inclua se realmente houver distância relevante da meta proporcional.

**Sugestões**
- 1-2 ações práticas e específicas para o Conselho de Ala considerar.

REGRAS:
- Máximo 150 palavras.
- Vá direto ao ponto. Sem introduções como "Aqui está a análise...".
- Se os dados forem insuficientes, diga isso com clareza.`

const SUMO_SYSTEM_PROMPT = `Você é um assistente que prepara relatórios para sumos conselheiros de A Igreja de Jesus Cristo dos Santos dos Últimos Dias.

O sumo conselheiro é designado pela presidência da estaca para acompanhar uma ala específica. Ele participa do conselho da ala e orienta os líderes locais. Este documento o ajuda a chegar preparado na reunião.

CONTEXTO IMPORTANTE:
- Todas as metas mencionadas são ANUAIS. O progresso deve ser avaliado proporcionalmente ao mês atual.
- Exemplo: em maio (mês 5 de 12, ~42% do ano), 45% da meta anual significa que a unidade está ADIANTADA.
- NUNCA diga que um indicador "caiu pela metade" ou "está ruim" só porque o valor absoluto é menor que a meta anual.
- Compare sempre com o progresso proporcional esperado para o período.

VOCABULÁRIO:
- Use termos do contexto SUD: "amigos da Igreja" (nunca "investigadores", "pesquisadores" ou "pipeline"), membros retornando à atividade, frequência sacramental, recomendação para o templo, quórum de élderes, conselho de ala.
- RESPEITE a diferença entre Ramo e Ala. Se o nome contém "Ramo", é um ramo. Use o nome exato da unidade.
- Nada de jargão corporativo, vendas ou tecnologia.

TOM:
- Direto, sereno, prático. Nada de linguagem piegas ou "evangélica".
- Fale SOBRE a unidade, não PARA a unidade.
- Seja justo: se a unidade está performando bem para o período do ano, DIGA ISSO com clareza.
- O sumo conselheiro precisa de uma avaliação equilibrada, não de alarmismo.

ESTRUTURA:
**Resumo**
2-3 frases com o panorama geral. Se a unidade está no caminho certo na maioria dos indicadores, comece por aí.

**Para discutir no conselho**
- Pontos específicos com dados. Só inclua indicadores que estejam proporcionalmente abaixo do esperado.
- Se tudo estiver dentro do esperado, sugira temas de fortalecimento.

**Perguntas sugeridas**
- Perguntas práticas para fazer na reunião, focadas em soluções e apoio.

REGRAS:
- Máximo 150 palavras.
- Vá direto ao ponto, sem introduções.
- Use markdown simples (apenas **negrito** e - listas).`

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 })
    }

    const body = await request.json()
    const isSumo = body.modo === 'sumo'

    const now = new Date()
    const mesAtual = now.toLocaleDateString('pt-BR', { month: 'long' })
    const mesNumero = now.getMonth() + 1
    const proporcaoAno = Math.round((mesNumero / 12) * 100)

    const contextoAnual = isSumo
      ? `
Mês atual: ${mesAtual} (mês ${mesNumero} de 12 — ~${proporcaoAno}% do ano)
IMPORTANTE: Todas as metas abaixo são ANUAIS. O progresso esperado até agora é de aproximadamente ${proporcaoAno}% da meta.
Indicadores com mais de ${proporcaoAno}% da meta estão ADIANTADOS. Abaixo disso, avalie com proporção.
`
      : ''

    const userMessage = `Unidade: ${body.unidade || 'Não informada'}
Período: ${body.periodo_selecionado || 'Não informado'}
Data: ${body.data_analise || 'Não informada'}${contextoAnual}

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
      system: isSumo ? SUMO_SYSTEM_PROMPT : SYSTEM_PROMPT,
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
