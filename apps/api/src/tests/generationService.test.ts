import test from "node:test";
import assert from "node:assert/strict";
import type { TranscriptSegment } from "@authority/shared";
import {
  buildLinkedin,
  buildNarrativeAnalysis,
  buildNewsletter,
  buildReels,
  buildXPosts,
  generateReels
} from "../services/generationService.js";

const segments: TranscriptSegment[] = [
  {
    id: "seg-1",
    srtAssetId: "srt-1",
    idx: 1,
    startMs: 1000,
    endMs: 9000,
    text: "Hoje eu mostro um metodo simples para distribuir conteudo em multiplos canais!",
    tokensEst: 12
  },
  {
    id: "seg-2",
    srtAssetId: "srt-1",
    idx: 2,
    startMs: 10000,
    endMs: 18000,
    text: "O primeiro passo e escolher um hook forte e objetivo.",
    tokensEst: 10
  },
  {
    id: "seg-3",
    srtAssetId: "srt-1",
    idx: 3,
    startMs: 19000,
    endMs: 28000,
    text: "Depois transforme esse insight em reels, post linkedin e thread no X.",
    tokensEst: 13
  }
];

test("buildNarrativeAnalysis returns normalized structure", () => {
  const analysis = buildNarrativeAnalysis(segments);

  assert.ok(analysis.thesis.length > 0);
  assert.ok(Array.isArray(analysis.topics));
  assert.equal(typeof analysis.polarityScore, "number");
  assert.ok(analysis.polarityScore >= 0 && analysis.polarityScore <= 10);
});

test("text generators return expected minimum payload", () => {
  const analysis = buildNarrativeAnalysis(segments);

  const reels = buildReels(segments, analysis, 240);
  const newsletter = buildNewsletter(segments, analysis);
  const linkedin = buildLinkedin(segments, analysis);
  const xPosts = buildXPosts(segments, analysis);

  assert.ok(reels.clips.length >= 2);
  assert.ok(newsletter.sections.length >= 4);
  assert.ok(linkedin.body.length >= 3);
  assert.ok(xPosts.standalone.length >= 3);
  assert.ok(xPosts.thread.length >= 4);
});

test("buildXPosts keeps posts within platform limits", () => {
  const longSegments: TranscriptSegment[] = [
    ...segments,
    {
      id: "seg-4",
      srtAssetId: "srt-1",
      idx: 4,
      startMs: 29000,
      endMs: 43000,
      text: "Este trecho adiciona contexto bem longo com aplicacao pratica, exemplos operacionais e varios detalhes para garantir que o texto gerado tenha risco real de ultrapassar limite de plataforma e precise ser compactado sem quebrar sentenca no meio.",
      tokensEst: 38
    }
  ];

  const analysis = buildNarrativeAnalysis(longSegments);
  const xPosts = buildXPosts(longSegments, analysis);

  for (const post of [...xPosts.standalone, ...xPosts.thread]) {
    assert.ok(post.length <= 280);
    assert.equal(/\.\.\.|…/.test(post), false);
  }
});

function msToSrtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1_000)
    .toString()
    .padStart(2, "0");
  const millis = Math.floor(ms % 1_000)
    .toString()
    .padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${millis}`;
}

function srtTimestampToMs(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    return 0;
  }
  const [, hh, mm, ss, ms] = match;
  return (
    Number(hh) * 3_600_000 +
    Number(mm) * 60_000 +
    Number(ss) * 1_000 +
    Number(ms)
  );
}

test("generateReels returns SRT-anchored timestamps", async () => {
  const longSegments: TranscriptSegment[] = [
    {
      id: "seg-0",
      srtAssetId: "srt-2",
      idx: 1,
      startMs: 0,
      endMs: 10000,
      text: "Fala galera, hoje eu vou te contar uma historia.",
      tokensEst: 10
    },
    ...segments.map((segment, index) => ({
      ...segment,
      id: `anchor-${index + 1}`,
      srtAssetId: "srt-2",
      idx: index + 2,
      startMs: segment.startMs + 10000,
      endMs: segment.endMs + 10000
    })),
    {
      id: "seg-5",
      srtAssetId: "srt-2",
      idx: 6,
      startMs: 38000,
      endMs: 52000,
      text: "Se voce calibrar pitch por maturidade do cliente, sua taxa de fechamento sobe sem mudar produto.",
      tokensEst: 18
    },
    {
      id: "seg-6",
      srtAssetId: "srt-2",
      idx: 7,
      startMs: 52000,
      endMs: 68000,
      text: "Mostre somente o proximo passo operacional, nao o stack inteiro de funcionalidades.",
      tokensEst: 14
    }
  ];

  const analysis = buildNarrativeAnalysis(longSegments);
  const reels = await generateReels(longSegments, analysis, 190);
  const startSet = new Set(longSegments.map((segment) => msToSrtTimestamp(segment.startMs)));
  const endSet = new Set(longSegments.map((segment) => msToSrtTimestamp(segment.endMs)));

  assert.ok(reels.clips.length >= 1);
  for (const clip of reels.clips) {
    assert.equal(startSet.has(clip.start), true);
    assert.equal(endSet.has(clip.end), true);
  }
});

test("buildReels creates editorial captions instead of transcript dump", () => {
  const analysis = buildNarrativeAnalysis(segments);
  const reels = buildReels(segments, analysis, 240);

  for (const clip of reels.clips) {
    const startMs = srtTimestampToMs(clip.start);
    const endMs = srtTimestampToMs(clip.end);
    const sourceText = segments
      .filter((segment) => segment.startMs >= startMs && segment.endMs <= endMs)
      .map((segment) => segment.text)
      .join(" ");

    assert.equal(sourceText.length > 0, true);
    assert.equal(clip.caption.includes(sourceText), false);
    assert.equal(clip.caption.length >= 120, true);
    assert.equal(
      /(aplicacao imediata|comente|compartilhe|me chama|template|material)/i.test(clip.caption),
      true
    );
  }
});
