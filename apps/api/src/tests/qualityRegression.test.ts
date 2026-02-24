import test from "node:test";
import assert from "node:assert/strict";
import type { TranscriptSegment } from "@authority/shared";
import { parseSrt } from "../services/srtParser.js";
import {
  buildLinkedin,
  buildNarrativeAnalysis,
  buildNewsletter,
  buildReels,
  buildXPosts
} from "../services/generationService.js";

interface RegressionFixtureSeed {
  topic: string;
  audience: string;
  metricA: string;
  metricB: string;
  pain: string;
  action: string;
}

const REGRESSION_SEEDS: RegressionFixtureSeed[] = [
  {
    topic: "prospeccao outbound para consultoria B2B",
    audience: "fundadores em fase de validacao",
    metricA: "taxa de resposta de 15%",
    metricB: "3 contratos de R$ 8 mil em 30 dias",
    pain: "mensagens frias sem contexto que nao geram reuniao",
    action: "mapear ICP e testar 3 ofertas em ciclos de 7 dias"
  },
  {
    topic: "retencao de clientes em agencia de servicos",
    audience: "donos de agencia com equipe enxuta",
    metricA: "churn caiu de 9% para 3%",
    metricB: "NPS subiu de 34 para 62",
    pain: "onboarding lento e promessa desalinhada",
    action: "definir playbook de onboarding em 5 etapas"
  },
  {
    topic: "precificacao de produto digital premium",
    audience: "criadores com audiencia inicial",
    metricA: "ticket medio de R$ 1.200",
    metricB: "margem bruta acima de 70%",
    pain: "desconto constante por inseguranca de oferta",
    action: "ancorar preco com prova e caso de uso"
  },
  {
    topic: "reposicionamento de marca pessoal no LinkedIn",
    audience: "especialistas tecnicos que vendem servico",
    metricA: "impressao organica 2.3x maior",
    metricB: "comentarios qualificados em 4 semanas",
    pain: "conteudo generico sem tese clara",
    action: "escrever tese contrarian com evidencia semanal"
  },
  {
    topic: "operacao comercial com SDR freelancer",
    audience: "times sem lider de vendas dedicado",
    metricA: "CAC em R$ 480",
    metricB: "payback em 2 meses",
    pain: "delegar vendas sem controle de metricas",
    action: "auditar funil toda sexta com 5 indicadores"
  },
  {
    topic: "produto defensavel em mercado comoditizado",
    audience: "agencias de performance",
    metricA: "setup caiu de 14 para 4 dias",
    metricB: "indicacao organica de 27%",
    pain: "servico facil de copiar em 30 dias",
    action: "criar biblioteca proprietaria com 40 templates"
  },
  {
    topic: "conteudo em funil de leads consultivos",
    audience: "consultores B2B com ciclo longo",
    metricA: "taxa de reuniao em 18%",
    metricB: "lead qualificado subiu 42%",
    pain: "CTA vago sem proximo passo claro",
    action: "usar CTA com pergunta diagnostica e prazo"
  },
  {
    topic: "escala de newsletter para autoridade",
    audience: "criadores especialistas",
    metricA: "taxa de abertura em 44%",
    metricB: "resposta direta em 8%",
    pain: "texto longo sem mecanismo causal",
    action: "organizar em tese, prova, framework e checklist"
  },
  {
    topic: "framework de oferta para SaaS early-stage",
    audience: "fundadores tecnicos",
    metricA: "MRR inicial de R$ 30 mil",
    metricB: "ciclo de venda de 42 dias",
    pain: "produto pronto sem canal validado",
    action: "validar canal manual antes de escalar produto"
  },
  {
    topic: "estrategia de reels para ganho de seguidores",
    audience: "educadores digitais",
    metricA: "retencao media acima de 38 segundos",
    metricB: "crescimento de 12% ao mes",
    pain: "cortes com introducao fraca e sem conflito",
    action: "escolher trechos com dor, regra e prova pratica"
  },
  {
    topic: "vendas complexas para software enterprise",
    audience: "executivos comerciais",
    metricA: "ticket de R$ 65 mil",
    metricB: "win rate em 21%",
    pain: "pitch tecnico sem narrativa de impacto",
    action: "vincular proposta a risco financeiro do cliente"
  },
  {
    topic: "sistema de referrals em produto recorrente",
    audience: "equipes de growth",
    metricA: "25% das novas contas por indicacao",
    metricB: "LTV/CAC acima de 4",
    pain: "dependencia total de midia paga",
    action: "incentivar prova social apos resultado concreto"
  },
  {
    topic: "diagnostico de copy para pagina de vendas",
    audience: "infoprodutores",
    metricA: "conversao foi de 1.8% para 3.4%",
    metricB: "CPL caiu 31%",
    pain: "promessa abstrata sem especificidade",
    action: "mostrar mecanismo, etapa e exemplo numerico"
  },
  {
    topic: "go to market para servico high-ticket",
    audience: "consultorias especializadas",
    metricA: "4 fechamentos em 45 dias",
    metricB: "ticket medio de R$ 22 mil",
    pain: "abordagem igual para lead frio e quente",
    action: "separar narrativa por nivel de consciencia"
  },
  {
    topic: "estrutura de carrossel para autoridade",
    audience: "criadores B2B",
    metricA: "salvamentos 2x maiores",
    metricB: "tempo de leitura em 75 segundos",
    pain: "slides sem progressao argumentativa",
    action: "usar ordem: tese, prova, framework, acao"
  },
  {
    topic: "otimizacao de onboarding em SaaS",
    audience: "PMs de produto",
    metricA: "ativacao em 7 dias subiu para 61%",
    metricB: "suporte caiu 28%",
    pain: "usuario nao entende primeiro valor",
    action: "reduzir setup inicial para um unico objetivo"
  },
  {
    topic: "storytelling com dados para posts",
    audience: "CMOs e heads de marketing",
    metricA: "CTR de 3.1%",
    metricB: "engajamento de 6.4%",
    pain: "opiniao sem demonstracao pratica",
    action: "combinar caso real, numero e proximo passo"
  },
  {
    topic: "expansao de canais sem perder consistencia",
    audience: "equipes de conteudo pequenas",
    metricA: "volume semanal de 5 para 14 ativos",
    metricB: "mesma taxa de qualidade acima de 8",
    pain: "cada canal reescreve do zero sem sistema",
    action: "usar nucleus de tese com adaptacoes por canal"
  },
  {
    topic: "cadencia comercial para consultoria de dados",
    audience: "fundadores com base tecnica",
    metricA: "reunioes subiram 63%",
    metricB: "propostas aceitas em 29%",
    pain: "follow-up aleatorio e sem criterio",
    action: "definir cadencia de 6 toques em 14 dias"
  },
  {
    topic: "arquitetura editorial para autoridade premium",
    audience: "especialistas independentes",
    metricA: "alcance qualificado 2.8x",
    metricB: "entradas de lead em 19 por semana",
    pain: "conteudo disperso sem tese dominante",
    action: "escolher 3 pilares e repetir com angulos novos"
  }
];

function msToSrt(ms: number): string {
  const totalMs = Math.max(0, ms);
  const hours = Math.floor(totalMs / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor((totalMs % 60_000) / 1_000)
    .toString()
    .padStart(2, "0");
  const millis = Math.floor(totalMs % 1_000)
    .toString()
    .padStart(3, "0");
  return `${hours}:${minutes}:${seconds},${millis}`;
}

function buildFixtureSrt(seed: RegressionFixtureSeed): string {
  const lines = [
    `Se voce trabalha com ${seed.topic}, o erro mais caro e ignorar ${seed.pain}.`,
    `No ultimo trimestre, vimos ${seed.metricA} quando a equipe executou uma cadencia simples.`,
    `Quando o time ignora contexto, a conversa trava e o cliente nao percebe valor.`,
    `A virada veio ao focar em um passo por vez: ${seed.action}.`,
    `Com esse ajuste, o resultado foi ${seed.metricB} sem aumentar custo fixo.`,
    `Primeiro, defina uma tese unica para ${seed.audience}.`,
    "Segundo, transforme a tese em prova objetiva com numero, caso e prazo.",
    "Terceiro, converta a prova em framework operacional com etapas e checklist.",
    "Quarto, finalize com CTA especifico pedindo diagnostico do cenario atual.",
    "Nao existe crescimento premium com copy generica e sem mecanismo causal.",
    "Se o canal nao estiver validado, o produto vira aposta e consome caixa rapido.",
    "Publicar o suprassumo exige repeticao inteligente com angulos diferentes."
  ];

  const rows: string[] = [];
  let cursorMs = 0;
  lines.forEach((text, index) => {
    const duration = 7000 + (index % 3) * 1200;
    rows.push(String(index + 1));
    rows.push(`${msToSrt(cursorMs)} --> ${msToSrt(cursorMs + duration)}`);
    rows.push(text);
    rows.push("");
    cursorMs += duration + 400;
  });

  return rows.join("\n");
}

function parsedToSegments(rawSrt: string, srtAssetId: string): TranscriptSegment[] {
  const parsed = parseSrt(rawSrt, "pt-BR");
  return parsed.segments.map((segment) => ({
    id: `${srtAssetId}-${segment.idx}`,
    srtAssetId,
    idx: segment.idx,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    tokensEst: segment.tokensEst
  }));
}

function assertNoArtificialTruncation(values: string[]): void {
  for (const value of values) {
    assert.equal(/\.\.\.|…/.test(value), false);
  }
}

test("quality regression suite with 20 real-like SRT fixtures", () => {
  assert.equal(REGRESSION_SEEDS.length, 20);

  REGRESSION_SEEDS.forEach((seed, index) => {
    const srtAssetId = `reg-${index + 1}`;
    const rawSrt = buildFixtureSrt(seed);
    const segments = parsedToSegments(rawSrt, srtAssetId);
    assert.ok(segments.length >= 10);

    const analysis = buildNarrativeAnalysis(segments);
    const durationSec = Math.ceil((segments[segments.length - 1]?.endMs ?? 0) / 1000);
    const reels = buildReels(segments, analysis, durationSec);
    const newsletter = buildNewsletter(segments, analysis);
    const linkedin = buildLinkedin(segments, analysis);
    const xPosts = buildXPosts(segments, analysis);

    assert.ok(analysis.thesis.length >= 40);
    assert.ok(analysis.topics.length >= 3);
    assert.ok(analysis.recommendations.length >= 3);
    assert.ok(analysis.structure !== undefined);

    assert.ok(reels.clips.length >= 1);
    reels.clips.forEach((clip) => {
      const start = clip.start;
      const end = clip.end;
      assert.ok(start.length > 0 && end.length > 0);
      assert.ok(clip.caption.length >= 120);
      assert.ok(clip.hashtags.length >= 3);
      assert.ok(clip.whyItWorks.length >= 60);
    });
    assertNoArtificialTruncation(
      reels.clips.flatMap((clip) => [clip.title, clip.caption, clip.whyItWorks])
    );

    const insightCount = newsletter.sections.filter((section) => section.type === "insight").length;
    const application = newsletter.sections.find((section) => section.type === "application");
    const cta = newsletter.sections.find((section) => section.type === "cta");
    assert.ok(newsletter.headline.length >= 20);
    assert.ok(newsletter.subheadline.length >= 40);
    assert.ok(insightCount >= 2);
    assert.ok(application?.type === "application" && application.bullets.length >= 3);
    assert.ok(cta?.type === "cta" && cta.text.length >= 30);
    assertNoArtificialTruncation(
      newsletter.sections.flatMap((section) =>
        section.type === "application" ? section.bullets : [section.text]
      )
    );

    assert.ok(linkedin.hook.length >= 25);
    assert.ok(linkedin.body.length >= 4);
    assert.ok(/\?$/.test(linkedin.ctaQuestion.trim()));
    assertNoArtificialTruncation([linkedin.hook, ...linkedin.body, linkedin.ctaQuestion]);

    assert.ok(xPosts.standalone.length >= 3);
    assert.ok(xPosts.thread.length >= 4);
    [...xPosts.standalone, ...xPosts.thread].forEach((post) => {
      assert.ok(post.length <= 280);
      assert.ok(post.length >= 40);
    });
    assertNoArtificialTruncation([...xPosts.standalone, ...xPosts.thread]);
  });
});
