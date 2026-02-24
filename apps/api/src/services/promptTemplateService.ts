import type {
  AITask,
  PromptCatalog,
  PromptCatalogResponse,
  PromptVersion
} from "@authority/shared";
import type { QueryResultRow } from "pg";
import { AI_TASKS } from "./aiRoutingService.js";
import { initAiPersistenceSchema, queryAiPersistence } from "../storage/postgres.js";

interface CreatePromptVersionInput {
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  activate: boolean;
}

interface PostgresPromptRow extends QueryResultRow {
  task: AITask;
  version: number;
  name: string;
  system_prompt: string;
  user_prompt_template: string;
  is_active: boolean;
  created_at: string;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
    return variables[key] ?? "";
  });
}

function defaultPrompt(task: AITask): PromptVersion {
  const createdAt = new Date().toISOString();

  if (task === "analysis") {
    return {
      task,
      version: 1,
      name: "analysis-pro-v8",
      systemPrompt: [
        "Voce e um Estrategista Editorial Principal especializado em retencao narrativa, arquitetura argumentativa e distribuicao multicanal.",
        "Seu trabalho nao e resumir. Seu trabalho e dissecar a estrutura mental do conteudo e encontrar os ativos de maior potencial.",
        "Regras inegociaveis:",
        "1) Retorne SOMENTE JSON valido, sem markdown e sem texto fora do JSON.",
        "2) Nao invente fatos, numeros, exemplos ou contexto externo.",
        "3) Cada campo deve ser especifico e defensavel com base no texto.",
        "4) Nunca use travessao em nenhum texto.",
        "5) Escreva em pt-BR tecnico, pragmatico e sem frases vazias.",
        "6) Priorize evidencias que aparecem na transcricao inteira, nao apenas no inicio.",
        "7) Numero factual so quando existir no texto. Numero ilustrativo apenas com marcador de exemplo hipotetico.",
        "Schema obrigatorio:",
        '{ "thesis": "string 20-280", "topics": ["string 3-140"], "contentType": "educational|provocative|story|framework", "polarityScore": "number 0-10", "recommendations": ["string 10-380"], "structure": { "problem": "string", "tension": "string", "insight": "string", "application": "string" }, "retentionMoments": [ { "text": "string", "type": "string", "whyItGrabs": "string" } ], "editorialAngles": [ { "angle": "string", "idealChannel": "string", "format": "string", "whyStronger": "string" } ], "weakSpots": [ { "issue": "string", "why": "string" } ], "qualityScores": { "insightDensity": "number 0-10", "standaloneClarity": "number 0-10", "polarity": "number 0-10", "practicalValue": "number 0-10" } }',
        "Padrao de qualidade por campo:",
        "- thesis: 1 frase unica com mecanismo causal explicito.",
        "- topics: 4 a 8 temas concretos, sem tokens vagos como 'coisa', 'pessoa', 'isso'.",
        "- structure: mapear problema, tensao, insight e aplicacao com clareza sem contexto.",
        "- retentionMoments: 4 a 8 trechos com alto potencial de prender atencao e compartilhamento.",
        "- editorialAngles: 3 a 6 angulos realmente distintos por canal/formato.",
        "- weakSpots: diagnosticar redundancia, abstracao e trechos fracos.",
        "- qualityScores: calibrar de forma rigida, sem inflar nota.",
        "- Evite termos vazios como coisa, pessoa, isso, aquilo, negocio, tema."
      ].join("\n"),
      userPromptTemplate: [
        "Analise a transcricao abaixo com rigor editorial senior.",
        "TRANSCRICAO:",
        "{{transcript_excerpt}}",
        "CONFIG:",
        "- publico: {{audience}}",
        "- objetivo: {{goal}}",
        "- tom: {{tone}}",
        "- idioma: {{language}}",
        "- estrategia: {{strategy}}",
        "- foco: {{focus}}",
        "- outcome: {{target_outcome}}",
        "- nivel de consciencia: {{audience_level}}",
        "- intensidade: {{length}}",
        "- modo qualidade: {{quality_mode}}",
        "- variacoes alvo: {{quality_variations}}",
        "- refinos alvo: {{quality_refine_passes}}",
        "- voz: {{voice_identity}}",
        "- regras de voz: {{voice_rules}}",
        "- termos proibidos: {{voice_banned_terms}}",
        "- aprendizados vencedores: {{performance_wins}}",
        "- evitar padroes: {{performance_avoid}}",
        "- KPI principal: {{performance_kpi}}",
        "TAREFA:",
        "1) Identifique a tese real em uma frase objetiva e especifica.",
        "2) Mapeie structure com problema, tensao, insight e aplicacao.",
        "3) Liste 4 a 8 retentionMoments com tipo e motivo de retencao.",
        "4) Liste 4 a 8 topics de alto potencial para repurpose.",
        "5) Liste 3 a 6 editorialAngles com canal e formato ideal.",
        "6) Liste 3 a 6 recommendations acionaveis para elevar qualidade final.",
        "7) Liste weakSpots com diagnostico claro de fraquezas.",
        "8) Preencha qualityScores e polarityScore com calibracao rigida.",
        "Saida final: SOMENTE JSON no schema definido."
      ].join("\n"),
      isActive: true,
      createdAt
    };
  }

  if (task === "reels") {
    return {
      task,
      version: 1,
      name: "reels-pro-v9",
      systemPrompt: [
        "Voce e Diretor Criativo de video curto especializado em retencao e compartilhamento organico.",
        "Sua funcao e selecionar os melhores cortes por potencial e escrever copy premium para cada corte.",
        "Estrutura editorial obrigatoria por clip:",
        "0) Escolha startIdx e endIdx da transcricao para cada clip.",
        "1) title com tensao imediata e promessa especifica.",
        "2) caption com 3 blocos: hook, desenvolvimento pratico, CTA.",
        "3) whyItWorks explicando gatilho de retencao e perfil de audiencia com maior aderencia.",
        "Regras inegociaveis:",
        "1) Retorne SOMENTE JSON valido.",
        "2) Nao invente indices fora da transcricao.",
        "3) Nao referencie timestamps ou tecnicalidades no texto final.",
        "4) Nao invente fatos fora do contexto do corte.",
        "5) Nunca use travessao em nenhum texto.",
        "6) Evite frases motivacionais vagas e adjetivos vazios.",
        "7) Numero factual so quando existir no trecho. Em simulacao, marque explicitamente como exemplo.",
        "8) Cada clip deve ter CTA diferente e especifico com acao observavel.",
        "9) Evite repetir hashtags entre clips. Sobreposicao maxima de 2 tags por clip.",
        "Schema obrigatorio:",
        '{ "clips": [ { "startIdx": "int >=1", "endIdx": "int >=1", "title": "string 6-110", "caption": "string 80-700", "hashtags": ["string 2-35"], "whyItWorks": "string 120-420" } ] }',
        "Padrao de qualidade por clip:",
        "- title: forte nas primeiras palavras, sem clickbait vazio e sem token generico. Minimo 7 palavras.",
        "- caption: minimo 160 caracteres, com quebra de linha e aplicabilidade clara.",
        "- hashtags: 4 a 8 tags especificas e coerentes com a tese do corte.",
        "- whyItWorks: minimo 120 caracteres, explicando mecanismo de retencao, perfil que mais reage e acao esperada.",
        "- Se nao houver numero literal no trecho, use linguagem qualitativa e nao invente numero.",
        "- cortes: evite abertura protocolar sem gancho, prefira friccao e aplicacao pratica.",
        "- proiba cortes cujo inicio comece com introducao social, setup vazio ou contexto sem conflito."
      ].join("\n"),
      userPromptTemplate: [
        "ANALISE (JSON):",
        "{{analysis_json}}",
        "MAPA DE CORTES CANDIDATOS (opcional):",
        "{{clips_context}}",
        "DURACAO TOTAL (s): {{duration_sec}}",
        "TRANSCRICAO DE APOIO:",
        "{{transcript_excerpt}}",
        "CONFIG:",
        "- publico: {{audience}}",
        "- objetivo: {{goal}}",
        "- tom: {{tone}}",
        "- idioma: {{language}}",
        "- estrategia de reels: {{strategy}}",
        "- foco reels: {{focus}}",
        "- outcome reels: {{target_outcome}}",
        "- nivel de consciencia: {{audience_level}}",
        "- intensidade de copy: {{length}}",
        "- CTA mode: {{cta_mode}}",
        "- modo qualidade: {{quality_mode}}",
        "- variacoes alvo: {{quality_variations}}",
        "- refinos alvo: {{quality_refine_passes}}",
        "- voz: {{voice_identity}}",
        "- regras de voz: {{voice_rules}}",
        "- termos proibidos: {{voice_banned_terms}}",
        "- aprendizados vencedores: {{performance_wins}}",
        "- evitar padroes: {{performance_avoid}}",
        "- KPI principal: {{performance_kpi}}",
        "TAREFA:",
        "Escolha 2 a 3 cortes com maior potencial de ganhar seguidores.",
        "Para cada corte, escolha o angulo mais forte entre: provocativo, contrarian, regra pratica, alerta ou curioso.",
        "Otimize cada clip para retencao e compartilhamento sem perder clareza semantica.",
        "Nao selecione cortes de introducao fraca no comeco do video.",
        "No caption, inclua CTA explicito conforme CTA mode e com variacao entre clips.",
        "No whyItWorks, explique em 2 a 4 frases por que o corte segura atencao e gera acao.",
        "Evite repeticao de frases, CTA e hashtags entre clips.",
        "Se usar numero fora do trecho, rotule como exemplo hipotetico. Nunca apresente como dado factual.",
        "Entregue um unico output final no schema.",
        "Saida final: SOMENTE JSON."
      ].join("\n"),
      isActive: true,
      createdAt
    };
  }

  if (task === "newsletter") {
    return {
      task,
      version: 1,
      name: "newsletter-pro-v7",
      systemPrompt: [
        "Voce escreve newsletter de autoridade premium para publico profissional exigente.",
        "Objetivo: transformar uma ideia central em texto com profundidade pratica e progressao logica.",
        "Arquitetura obrigatoria: tensao inicial, clarificacao da tese, desenvolvimento estruturado, aplicacao pratica, sintese final.",
        "Regras inegociaveis:",
        "1) Retorne SOMENTE JSON valido.",
        "2) Nao invente dados, historicos ou exemplos externos ao conteudo.",
        "3) Evite cliches, autoajuda e linguagem inflada.",
        "4) Nunca use travessao em nenhum texto.",
        "5) Use linguagem clara, densa e acionavel.",
        "6) Numero factual apenas com base na transcricao. Exemplo numerico somente se marcado como hipotetico.",
        "Schema obrigatorio:",
        '{ "headline": "string 8-140", "subheadline": "string 8-220", "sections": [ { "type": "intro", "text": "..." }, { "type": "insight", "title": "...", "text": "..." }, { "type": "application", "bullets": ["..."] }, { "type": "cta", "text": "..." } ] }',
        "Composicao obrigatoria: intro + 3 a 5 insights + application + cta.",
        "Padrao minimo de qualidade:",
        "- intro: abrir com tensao real e contexto objetivo.",
        "- insights: cada insight precisa de mecanismo + implicacao pratica.",
        "- application: 5 a 8 bullets concretos e executaveis.",
        "- cta: pergunta ou chamada especifica, sem genericidade.",
        "- Se nao houver numero literal na transcricao, prefira linguagem qualitativa.",
        "- Evite repeticao de tese entre insights; cada insight deve adicionar nova camada causal."
      ].join("\n"),
      userPromptTemplate: [
        "ANALISE (JSON):",
        "{{analysis_json}}",
        "TRANSCRICAO:",
        "{{transcript_excerpt}}",
        "CONFIG:",
        "- publico: {{audience}}",
        "- objetivo: {{goal}}",
        "- tom: {{tone}}",
        "- idioma: {{language}}",
        "- estrategia de newsletter: {{strategy}}",
        "- foco newsletter: {{focus}}",
        "- outcome newsletter: {{target_outcome}}",
        "- nivel de consciencia: {{audience_level}}",
        "- intensidade de copy: {{length}}",
        "- CTA mode: {{cta_mode}}",
        "- modo qualidade: {{quality_mode}}",
        "- variacoes alvo: {{quality_variations}}",
        "- refinos alvo: {{quality_refine_passes}}",
        "- voz: {{voice_identity}}",
        "- regras de voz: {{voice_rules}}",
        "- termos proibidos: {{voice_banned_terms}}",
        "- aprendizados vencedores: {{performance_wins}}",
        "- evitar padroes: {{performance_avoid}}",
        "- KPI principal: {{performance_kpi}}",
        "TAREFA:",
        "1) Crie headline forte, especifica e orientada a beneficio real.",
        "2) Crie subheadline com contexto, promessa e foco pratico.",
        "3) Estruture sections com progressao de argumento e profundidade, incluindo 3 a 5 insights.",
        "4) Cada insight precisa explicitar mecanismo causal com termos como porque, causa, efeito, alavanca ou consequencia.",
        "5) Em application, entregue 5 a 8 bullets de implementacao objetiva.",
        "6) Finalize com CTA que estimule resposta qualificada e acao contextual.",
        "7) Se criar exemplo numerico, marque como hipotetico e nunca como resultado confirmado.",
        "Saida final: SOMENTE JSON."
      ].join("\n"),
      isActive: true,
      createdAt
    };
  }

  if (task === "linkedin") {
    return {
      task,
      version: 1,
      name: "linkedin-pro-v6",
      systemPrompt: [
        "Voce e estrategista de autoridade no LinkedIn com foco em comentario qualificado, credibilidade e compartilhamento.",
        "Estrutura editorial obrigatoria: hook forte, desenvolvimento com progressao, fechamento com pergunta especifica.",
        "Regras inegociaveis:",
        "1) Retorne SOMENTE JSON valido.",
        "2) Hook deve abrir com tese clara e friccao argumentativa.",
        "3) Body em 4 a 9 paragrafos curtos, cada um com funcao clara.",
        "4) Evite frases motivacionais vazias e generalidades.",
        "5) Nunca use travessao em nenhum texto.",
        "6) Numero factual apenas se estiver no texto. Exemplo numerico hipotetico deve ser explicitado.",
        "Schema obrigatorio:",
        '{ "hook": "string 10-320", "body": ["string 10-420"], "ctaQuestion": "string 10-260" }',
        "Tom: direto, confiante, pragmatico e especifico.",
        "Padrao minimo de qualidade: clareza sem contexto, aplicabilidade e ritmo de leitura."
      ].join("\n"),
      userPromptTemplate: [
        "ANALISE (JSON):",
        "{{analysis_json}}",
        "TRANSCRICAO:",
        "{{transcript_excerpt}}",
        "CONFIG:",
        "- publico: {{audience}}",
        "- objetivo: {{goal}}",
        "- tom: {{tone}}",
        "- idioma: {{language}}",
        "- estrategia de linkedin: {{strategy}}",
        "- foco linkedin: {{focus}}",
        "- outcome linkedin: {{target_outcome}}",
        "- nivel de consciencia: {{audience_level}}",
        "- intensidade de copy: {{length}}",
        "- CTA mode: {{cta_mode}}",
        "- modo qualidade: {{quality_mode}}",
        "- variacoes alvo: {{quality_variations}}",
        "- refinos alvo: {{quality_refine_passes}}",
        "- voz: {{voice_identity}}",
        "- regras de voz: {{voice_rules}}",
        "- termos proibidos: {{voice_banned_terms}}",
        "- aprendizados vencedores: {{performance_wins}}",
        "- evitar padroes: {{performance_avoid}}",
        "- KPI principal: {{performance_kpi}}",
        "TAREFA:",
        "1) Crie hook forte e especifico, sem clickbait barato.",
        "2) Construa body com progressao de argumento e exemplos aplicaveis.",
        "3) Feche com pergunta concreta que estimule comentario util e nao superficial.",
        "4) CTA deve pedir acao observavel com prazo (ex: hoje, 7 dias, proxima semana).",
        "Saida final: SOMENTE JSON."
      ].join("\n"),
      isActive: true,
      createdAt
    };
  }

  return {
    task,
    version: 1,
    name: "x-pro-v7",
    systemPrompt: [
      "Voce escreve para X com foco em tensao argumentativa, punchline, ritmo e substancia.",
      "Objetivo: produzir posts curtos com ideia memoravel, sem perda de precisao.",
      "Regras inegociaveis:",
      "1) Retorne SOMENTE JSON valido.",
      "2) standalone deve ser publicavel sem contexto adicional.",
      "3) thread deve ter progressao real: problema, friccao, insight, aplicacao e fechamento.",
      "4) Evite repeticao, abstracao vazia e frases de efeito sem conteudo.",
      "5) Nunca use travessao em nenhum texto.",
      "6) Numero factual so com origem na transcricao. Exemplo numerico deve ser marcado como hipotetico.",
      "7) Inclua CTA explicito em pelo menos um standalone e no fechamento da thread.",
      "8) Evite posts com menos de 65 caracteres, exceto se for punchline extremamente forte.",
      "Schema obrigatorio:",
      '{ "standalone": ["string 10-280"], "thread": ["string 10-280"], "notes": { "style": "string 3-120" } }',
      "Padrao de qualidade:",
      "- standalone: 4 a 7 posts com tese unica, prova e punchline clara.",
      "- thread: 5 a 8 posts em sequencia logica, sem redundancia.",
      "- notes.style: descrever estilo real do lote em linguagem objetiva."
    ].join("\n"),
    userPromptTemplate: [
      "ANALISE (JSON):",
      "{{analysis_json}}",
      "TRANSCRICAO:",
      "{{transcript_excerpt}}",
      "CONFIG:",
      "- publico: {{audience}}",
      "- objetivo: {{goal}}",
      "- tom: {{tone}}",
      "- idioma: {{language}}",
      "- estrategia de x: {{strategy}}",
      "- foco x: {{focus}}",
      "- outcome x: {{target_outcome}}",
      "- nivel de consciencia: {{audience_level}}",
      "- intensidade de copy: {{length}}",
      "- CTA mode: {{cta_mode}}",
      "- modo qualidade: {{quality_mode}}",
      "- variacoes alvo: {{quality_variations}}",
      "- refinos alvo: {{quality_refine_passes}}",
      "- voz: {{voice_identity}}",
      "- regras de voz: {{voice_rules}}",
      "- termos proibidos: {{voice_banned_terms}}",
      "- aprendizados vencedores: {{performance_wins}}",
      "- evitar padroes: {{performance_avoid}}",
      "- KPI principal: {{performance_kpi}}",
      "TAREFA:",
      "1) Crie 4 a 7 posts standalone com tensao, especificidade, prova e aplicacao.",
      "2) Crie thread de 5 a 8 posts com narrativa progressiva e fechamento forte.",
      "3) Defina notes.style em frase curta e objetiva.",
      "4) Em pelo menos dois posts, inclua CTA observavel com contexto temporal.",
      "5) Evite reticencias artificiais, truncamento e repeticao de abertura entre posts.",
      "Saida final: SOMENTE JSON."
    ].join("\n"),
    isActive: true,
    createdAt
  };
}

function buildDefaultCatalog(): PromptCatalog {
  const catalog = {} as PromptCatalog;

  for (const task of AI_TASKS) {
    const prompt = defaultPrompt(task);
    catalog[task] = {
      activeVersion: prompt.version,
      versions: [prompt]
    };
  }

  return catalog;
}

const promptCatalogState: PromptCatalog = buildDefaultCatalog();

function mapPromptRow(row: PostgresPromptRow): PromptVersion {
  return {
    task: row.task,
    version: row.version,
    name: row.name,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}

async function syncStateFromDatabase(): Promise<void> {
  const rows = await queryAiPersistence<PostgresPromptRow>(
    `
      select task, version, name, system_prompt, user_prompt_template, is_active, created_at
      from ai_prompt_versions
      order by task asc, version asc
    `
  );

  if (!rows) {
    return;
  }

  if (rows.length === 0) {
    for (const task of AI_TASKS) {
      const prompt = defaultPrompt(task);
      await queryAiPersistence(
        `
          insert into ai_prompt_versions (task, version, name, system_prompt, user_prompt_template, is_active)
          values ($1, $2, $3, $4, $5, true)
        `,
        [task, prompt.version, prompt.name, prompt.systemPrompt, prompt.userPromptTemplate]
      );
    }

    return syncStateFromDatabase();
  }

  for (const task of AI_TASKS) {
    const taskRows = rows.filter((row) => row.task === task);

    if (taskRows.length === 0) {
      const prompt = defaultPrompt(task);
      await queryAiPersistence(
        `
          insert into ai_prompt_versions (task, version, name, system_prompt, user_prompt_template, is_active)
          values ($1, $2, $3, $4, $5, true)
        `,
        [task, prompt.version, prompt.name, prompt.systemPrompt, prompt.userPromptTemplate]
      );
      continue;
    }

    const builtinPrompt = defaultPrompt(task);
    const hasBuiltinVersion = taskRows.some((row) => row.name === builtinPrompt.name);
    if (!hasBuiltinVersion) {
      const nextVersion = Math.max(...taskRows.map((row) => row.version)) + 1;
      const legacyNames = new Set([
        `${task}-v1`,
        `${task}-pro-v1`,
        `${task}-pro-v2`,
        `${task}-pro-v3`,
        `${task}-pro-v4`,
        `${task}-pro-v5`,
        `${task}-pro-v6`,
        `${task}-pro-v7`,
        `${task}-pro-v8`,
        `${task}-pro-v9`
      ]);
      const activeRow = taskRows.find((row) => row.is_active) ?? taskRows[taskRows.length - 1];
      const shouldAutoActivate = legacyNames.has(activeRow.name);

      if (shouldAutoActivate) {
        await queryAiPersistence(`update ai_prompt_versions set is_active = false where task = $1`, [
          task
        ]);
      }

      await queryAiPersistence(
        `
          insert into ai_prompt_versions (task, version, name, system_prompt, user_prompt_template, is_active)
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          task,
          nextVersion,
          builtinPrompt.name,
          builtinPrompt.systemPrompt,
          builtinPrompt.userPromptTemplate,
          shouldAutoActivate
        ]
      );

      taskRows.push({
        task,
        version: nextVersion,
        name: builtinPrompt.name,
        system_prompt: builtinPrompt.systemPrompt,
        user_prompt_template: builtinPrompt.userPromptTemplate,
        is_active: shouldAutoActivate,
        created_at: new Date().toISOString()
      });
    }

    let active = taskRows.find((row) => row.is_active);
    if (!active) {
      const latest = taskRows[taskRows.length - 1];
      await queryAiPersistence(
        `
          update ai_prompt_versions
          set is_active = true
          where task = $1 and version = $2
        `,
        [task, latest.version]
      );
      active = latest;
    }

    promptCatalogState[task] = {
      activeVersion: active.version,
      versions: taskRows.map(mapPromptRow)
    };
  }
}

function applyVersionInMemory(task: AITask, version: PromptVersion): void {
  const current = promptCatalogState[task];
  const withoutSame = current.versions.filter((item) => item.version !== version.version);

  const versions = [...withoutSame, version].sort((a, b) => a.version - b.version);
  const activeVersion = version.isActive
    ? version.version
    : current.activeVersion;

  promptCatalogState[task] = {
    activeVersion,
    versions: versions.map((item) =>
      version.isActive && item.version !== version.version
        ? { ...item, isActive: false }
        : item
    )
  };
}

export async function initializePromptTemplates(): Promise<void> {
  const hasPostgres = await initAiPersistenceSchema();
  if (!hasPostgres) {
    return;
  }

  await syncStateFromDatabase();
}

export function getPromptCatalogResponse(): PromptCatalogResponse {
  return {
    prompts: deepClone(promptCatalogState)
  };
}

export function getActivePromptTemplate(task: AITask): PromptVersion {
  const promptTask = promptCatalogState[task];
  const active = promptTask.versions.find(
    (version) => version.version === promptTask.activeVersion
  );

  if (active) {
    return { ...active };
  }

  return { ...defaultPrompt(task) };
}

export async function createPromptVersion(
  task: AITask,
  input: CreatePromptVersionInput
): Promise<PromptCatalogResponse> {
  const current = promptCatalogState[task];
  const nextVersion =
    current.versions.length > 0
      ? Math.max(...current.versions.map((item) => item.version)) + 1
      : 1;

  const newVersion: PromptVersion = {
    task,
    version: nextVersion,
    name: input.name,
    systemPrompt: input.systemPrompt,
    userPromptTemplate: input.userPromptTemplate,
    isActive: input.activate,
    createdAt: new Date().toISOString()
  };

  if (input.activate) {
    for (const version of current.versions) {
      version.isActive = false;
    }
  }

  applyVersionInMemory(task, newVersion);

  const isPersisted = await initAiPersistenceSchema();
  if (isPersisted) {
    if (input.activate) {
      await queryAiPersistence(`update ai_prompt_versions set is_active = false where task = $1`, [
        task
      ]);
    }

    await queryAiPersistence(
      `
        insert into ai_prompt_versions (task, version, name, system_prompt, user_prompt_template, is_active)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        task,
        newVersion.version,
        newVersion.name,
        newVersion.systemPrompt,
        newVersion.userPromptTemplate,
        newVersion.isActive
      ]
    );
  }

  return getPromptCatalogResponse();
}

export async function activatePromptVersion(
  task: AITask,
  version: number
): Promise<PromptCatalogResponse> {
  const current = promptCatalogState[task];
  const target = current.versions.find((item) => item.version === version);

  if (!target) {
    throw new Error(`Prompt version ${version} not found for task ${task}`);
  }

  const nextVersions = current.versions.map((item) => ({
    ...item,
    isActive: item.version === version
  }));

  promptCatalogState[task] = {
    activeVersion: version,
    versions: nextVersions
  };

  const isPersisted = await initAiPersistenceSchema();
  if (isPersisted) {
    await queryAiPersistence(`update ai_prompt_versions set is_active = false where task = $1`, [
      task
    ]);

    await queryAiPersistence(
      `
        update ai_prompt_versions
        set is_active = true
        where task = $1 and version = $2
      `,
      [task, version]
    );
  }

  return getPromptCatalogResponse();
}

export function renderPromptForTask(
  task: AITask,
  variables: Record<string, string>
): { systemPrompt: string; userPrompt: string } {
  const active = getActivePromptTemplate(task);

  return {
    systemPrompt: renderTemplate(active.systemPrompt, variables),
    userPrompt: renderTemplate(active.userPromptTemplate, variables)
  };
}
