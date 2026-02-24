import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import PDFDocument from "pdfkit";
import type {
  AITask,
  AnalysisPayload,
  AssetRefineAction,
  GeneratedAssetPayload,
  GeneratedAssetType,
  LinkedinPayload,
  NewsletterPayload,
  ReelsPayload,
  RefineAssetBlockResponse,
  RefineAssetResponse,
  SaveAssetManualResponse,
  SelectAssetVariantResponse,
  SrtAsset,
  SrtAssetByTypeResponse,
  SrtAssetsResponse,
  SrtDiagnosticsResponse,
  SrtDetailResponse,
  SrtJobsResponse,
  UpdateSrtProfileResponse,
  UploadSrtResponse,
  XPostsPayload
} from "@authority/shared";
import { config } from "../config.js";
import { store } from "../storage/inMemoryStore.js";
import {
  enqueueAssetBlockRefinement,
  enqueueAssetRefinement,
  enqueueSrtProcessing
} from "../services/srtProcessingService.js";
import { mergeGenerationProfile, resolveGenerationProfile } from "../services/generationProfileService.js";
import type { StoredSrtAsset } from "../types/domain.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const uploader = multer({
  dest: config.uploadDir,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

export const srtsRouter = Router();
const ACCEPTED_TRANSCRIPT_EXTENSIONS = new Set([".srt", ".txt"]);
const SUPPORTED_ASSET_TYPES: GeneratedAssetType[] = [
  "analysis",
  "reels",
  "newsletter",
  "linkedin",
  "x",
  "carousel",
  "covers"
];

const updateProfileSchema = z
  .object({
    generationProfile: z.unknown(),
    rerun: z.boolean().optional().default(true)
  })
  .strict();

const refineAssetSchema = z
  .object({
    action: z.enum([
      "improve",
      "shorten",
      "deepen",
      "provocative"
    ] as [AssetRefineAction, ...AssetRefineAction[]]),
    instruction: z.string().max(600).optional()
  })
  .strict();

const refineAssetBlockSchema = z
  .object({
    blockPath: z.string().min(1).max(180),
    action: z.enum([
      "improve",
      "shorten",
      "deepen",
      "provocative"
    ] as [AssetRefineAction, ...AssetRefineAction[]]),
    instruction: z.string().max(600).optional(),
    evidenceOnly: z.boolean().optional().default(false)
  })
  .strict();

const selectVariantSchema = z
  .object({
    variant: z.number().int().min(1).max(12)
  })
  .strict();

const saveAssetManualSchema = z
  .object({
    payload: z.unknown()
  })
  .strict();

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function toPublicAsset(asset: StoredSrtAsset): SrtAsset {
  const { filePath: _filePath, ...publicAsset } = asset;
  return publicAsset;
}

function taskToAssetType(task: AITask): GeneratedAssetType {
  if (task === "analysis") {
    return "analysis";
  }
  if (task === "reels") {
    return "reels";
  }
  if (task === "newsletter") {
    return "newsletter";
  }
  if (task === "linkedin") {
    return "linkedin";
  }
  return "x";
}

function assetTypeToTask(type: GeneratedAssetType): AITask | null {
  if (type === "analysis") {
    return "analysis";
  }
  if (type === "reels") {
    return "reels";
  }
  if (type === "newsletter") {
    return "newsletter";
  }
  if (type === "linkedin") {
    return "linkedin";
  }
  if (type === "x") {
    return "x";
  }
  return null;
}

function resolveAssetStatusByDiagnostics(srtAssetId: string, task: AITask): "ready" | "pending" {
  const diagnostics = store
    .listGenerationDiagnostics(srtAssetId)
    .find((item) => item.task === task);
  if (!diagnostics) {
    return "ready";
  }

  const meetsQuality =
    typeof diagnostics.meetsQualityThreshold === "boolean"
      ? diagnostics.meetsQualityThreshold
      : diagnostics.qualityFinal >= diagnostics.qualityThreshold;
  const meetsPublishability =
    typeof diagnostics.meetsPublishabilityThreshold === "boolean"
      ? diagnostics.meetsPublishabilityThreshold
      : true;

  return meetsQuality && meetsPublishability ? "ready" : "pending";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function clonePayload(payload: GeneratedAssetPayload): GeneratedAssetPayload {
  return JSON.parse(JSON.stringify(payload)) as GeneratedAssetPayload;
}

function pickAttributionFromTaskDiagnostics(
  srtAssetId: string,
  task: AITask
): Record<string, unknown> | null {
  const diagnostics = store
    .listGenerationDiagnostics(srtAssetId)
    .find((item) => item.task === task);
  if (!diagnostics) {
    return null;
  }

  const selectedVariant =
    diagnostics.variants.find((variant) => variant.variant === diagnostics.selectedVariant) ??
    diagnostics.variants.find((variant) => variant.selected) ??
    diagnostics.variants.find((variant) => variant.normalizedOutput);
  if (!selectedVariant?.normalizedOutput) {
    return null;
  }

  const normalized = asRecord(selectedVariant.normalizedOutput);
  if (!normalized) {
    return null;
  }

  const attribution = asRecord(normalized._sourceAttribution);
  return attribution ?? null;
}

function stripVariantMetaFromPayload(
  payload: Record<string, unknown>
): GeneratedAssetPayload {
  const next = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete next._sourceAttribution;
  delete next._validation;
  return next as GeneratedAssetPayload;
}

function safePdfFilename(value: string): string {
  const normalized = value
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 80) : "authority-export";
}

type ExportMode = "publish" | "debug";

function isTruthyQueryFlag(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.some((item) => isTruthyQueryFlag(item));
  }
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveExportMode(raw: unknown): ExportMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim().toLowerCase() === "debug") {
    return "debug";
  }
  return "publish";
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, minHeight = 48): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight > bottom) {
    doc.addPage();
  }
}

function pdfSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensurePdfSpace(doc, 42);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(title);
  doc.moveDown(0.2);
}

function pdfText(doc: PDFKit.PDFDocument, value: string): void {
  ensurePdfSpace(doc, 24);
  doc.font("Helvetica").fontSize(10.5).fillColor("#111827").text(value, {
    lineGap: 2
  });
  doc.moveDown(0.25);
}

function pdfList(doc: PDFKit.PDFDocument, values: string[], numbered = true): void {
  values.forEach((item, idx) => {
    const prefix = numbered ? `${idx + 1}. ` : "- ";
    pdfText(doc, `${prefix}${item}`);
  });
}

function renderAnalysisPdf(doc: PDFKit.PDFDocument, payload: AnalysisPayload): void {
  pdfSectionTitle(doc, "Analise narrativa");
  pdfText(doc, `Tese: ${payload.thesis}`);
  if (payload.topics.length > 0) {
    pdfText(doc, "Topicos:");
    pdfList(doc, payload.topics, true);
  }
  pdfText(doc, `Tipo: ${payload.contentType} | Polaridade: ${payload.polarityScore}/10`);

  if (payload.structure) {
    pdfText(doc, `Problema: ${payload.structure.problem}`);
    pdfText(doc, `Tensao: ${payload.structure.tension}`);
    pdfText(doc, `Insight: ${payload.structure.insight}`);
    pdfText(doc, `Aplicacao: ${payload.structure.application}`);
  }

  if (payload.recommendations.length > 0) {
    pdfText(doc, "Recomendacoes:");
    pdfList(doc, payload.recommendations, true);
  }
}

function renderReelsPdf(doc: PDFKit.PDFDocument, payload: ReelsPayload): void {
  pdfSectionTitle(doc, "Reels");
  payload.clips.forEach((clip, idx) => {
    ensurePdfSpace(doc, 120);
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#111827").text(
      `Clip ${idx + 1}: ${clip.title}`
    );
    doc.moveDown(0.15);
    pdfText(doc, `Janela: ${clip.start} -> ${clip.end}`);
    pdfText(doc, `Legenda: ${clip.caption}`);
    if (clip.hashtags.length > 0) {
      pdfText(doc, `Hashtags: ${clip.hashtags.join(" ")}`);
    }
    pdfText(doc, `Porque funciona: ${clip.whyItWorks}`);
    pdfText(
      doc,
      `Scores: hook ${clip.scores.hook} | clareza ${clip.scores.clarity} | retencao ${clip.scores.retention} | share ${clip.scores.share}`
    );
  });
}

function renderNewsletterPdf(doc: PDFKit.PDFDocument, payload: NewsletterPayload): void {
  pdfSectionTitle(doc, "Newsletter");
  pdfText(doc, `Headline: ${payload.headline}`);
  pdfText(doc, `Subheadline: ${payload.subheadline}`);

  payload.sections.forEach((section, idx) => {
    ensurePdfSpace(doc, 64);
    if (section.type === "application") {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`Secao ${idx + 1}: Aplicacao`);
      doc.moveDown(0.15);
      pdfList(doc, section.bullets, true);
      return;
    }

    const label =
      section.type === "intro"
        ? "Intro"
        : section.type === "insight"
          ? `Insight: ${section.title}`
          : "CTA";
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`Secao ${idx + 1}: ${label}`);
    doc.moveDown(0.15);
    pdfText(doc, section.text);
  });
}

function renderLinkedinPdf(doc: PDFKit.PDFDocument, payload: LinkedinPayload): void {
  pdfSectionTitle(doc, "LinkedIn");
  pdfText(doc, `Hook: ${payload.hook}`);
  if (payload.body.length > 0) {
    pdfText(doc, "Corpo:");
    pdfList(doc, payload.body, true);
  }
  pdfText(doc, `CTA: ${payload.ctaQuestion}`);
}

function renderXPdf(doc: PDFKit.PDFDocument, payload: XPostsPayload): void {
  pdfSectionTitle(doc, "X");
  if (payload.standalone.length > 0) {
    pdfText(doc, "Posts avulsos:");
    pdfList(doc, payload.standalone, true);
  }
  if (payload.thread.length > 0) {
    pdfText(doc, "Thread:");
    pdfList(doc, payload.thread, true);
  }
  pdfText(doc, `Style note: ${payload.notes.style}`);
}

function renderPublishHeaderPdf(doc: PDFKit.PDFDocument, asset: SrtAsset): void {
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#0b1220")
    .text("Authority Posting Pack");
  doc.moveDown(0.18);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#334155")
    .text("Conteudo pronto para publicar em cada canal.");
  doc.moveDown(0.32);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#64748b")
    .text(`Arquivo: ${asset.filename}`);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#64748b")
    .text(`Gerado em: ${new Date().toISOString()}`);
  doc.moveDown(0.48);
}

function renderReelsPublishPdf(doc: PDFKit.PDFDocument, payload: ReelsPayload): void {
  pdfSectionTitle(doc, "Reels");
  payload.clips.forEach((clip, idx) => {
    ensurePdfSpace(doc, 130);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0f172a")
      .text(`Corte ${idx + 1} · ${clip.start} -> ${clip.end}`);
    doc.moveDown(0.12);
    pdfText(doc, `Titulo: ${clip.title}`);
    pdfText(doc, clip.caption);
    if (clip.hashtags.length > 0) {
      pdfText(doc, clip.hashtags.join(" "));
    }
    doc.moveDown(0.1);
  });
}

function renderNewsletterPublishPdf(doc: PDFKit.PDFDocument, payload: NewsletterPayload): void {
  pdfSectionTitle(doc, "Newsletter");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(payload.headline);
  doc.moveDown(0.1);
  doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(payload.subheadline);
  doc.moveDown(0.28);

  payload.sections.forEach((section, idx) => {
    ensurePdfSpace(doc, 64);
    const label =
      section.type === "intro"
        ? "Abertura"
        : section.type === "insight"
          ? section.title
          : section.type === "application"
            ? "Checklist pratico"
            : "CTA";
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#0f172a")
      .text(`${idx + 1}. ${label}`);
    doc.moveDown(0.12);
    if (section.type === "application") {
      pdfList(doc, section.bullets, true);
    } else {
      pdfText(doc, section.text);
    }
  });
}

function renderLinkedinPublishPdf(doc: PDFKit.PDFDocument, payload: LinkedinPayload): void {
  pdfSectionTitle(doc, "LinkedIn");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(payload.hook);
  doc.moveDown(0.18);
  payload.body.forEach((paragraph) => {
    pdfText(doc, paragraph);
  });
  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor("#0f172a")
    .text(payload.ctaQuestion);
  doc.moveDown(0.2);
}

function renderXPublishPdf(doc: PDFKit.PDFDocument, payload: XPostsPayload): void {
  pdfSectionTitle(doc, "X");
  if (payload.standalone.length > 0) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Posts avulsos");
    doc.moveDown(0.1);
    pdfList(doc, payload.standalone, true);
  }
  if (payload.thread.length > 0) {
    doc.moveDown(0.12);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Thread");
    doc.moveDown(0.1);
    pdfList(doc, payload.thread, true);
  }
}

function renderGenericJsonPdf(
  doc: PDFKit.PDFDocument,
  title: string,
  payload: GeneratedAssetPayload
): void {
  pdfSectionTitle(doc, title);
  const serialized = JSON.stringify(payload, null, 2) ?? "{}";
  const lines = serialized.split("\n");
  doc.font("Courier").fontSize(9).fillColor("#0f172a");
  lines.forEach((line) => {
    ensurePdfSpace(doc, 18);
    doc.text(line, { lineGap: 1.5 });
  });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10.5).fillColor("#111827");
}

function pushHeading(lines: string[], title: string): void {
  lines.push("");
  lines.push(`## ${title}`);
}

function pushParagraph(lines: string[], text: string): void {
  const normalized = text.trim();
  if (!normalized) {
    return;
  }
  lines.push(normalized);
}

function pushList(lines: string[], values: string[], numbered = true): void {
  values.forEach((item, index) => {
    const normalized = item.trim();
    if (!normalized) {
      return;
    }
    lines.push(numbered ? `${index + 1}. ${normalized}` : `- ${normalized}`);
  });
}

function renderAnalysisTxt(lines: string[], payload: AnalysisPayload): void {
  pushHeading(lines, "Analise narrativa");
  pushParagraph(lines, `Tese: ${payload.thesis}`);
  if (payload.topics.length > 0) {
    pushParagraph(lines, "Topicos:");
    pushList(lines, payload.topics, true);
  }
  pushParagraph(lines, `Tipo: ${payload.contentType} | Polaridade: ${payload.polarityScore}/10`);
  if (payload.structure) {
    pushParagraph(lines, `Problema: ${payload.structure.problem}`);
    pushParagraph(lines, `Tensao: ${payload.structure.tension}`);
    pushParagraph(lines, `Insight: ${payload.structure.insight}`);
    pushParagraph(lines, `Aplicacao: ${payload.structure.application}`);
  }
  if (payload.recommendations.length > 0) {
    pushParagraph(lines, "Recomendacoes:");
    pushList(lines, payload.recommendations, true);
  }
}

function renderReelsTxt(lines: string[], payload: ReelsPayload): void {
  pushHeading(lines, "Reels");
  payload.clips.forEach((clip, index) => {
    pushParagraph(lines, `Clip ${index + 1}: ${clip.title}`);
    pushParagraph(lines, `Janela: ${clip.start} -> ${clip.end}`);
    pushParagraph(lines, `Legenda: ${clip.caption}`);
    if (clip.hashtags.length > 0) {
      pushParagraph(lines, `Hashtags: ${clip.hashtags.join(" ")}`);
    }
    pushParagraph(lines, `Porque funciona: ${clip.whyItWorks}`);
    pushParagraph(
      lines,
      `Scores: hook ${clip.scores.hook} | clareza ${clip.scores.clarity} | retencao ${clip.scores.retention} | share ${clip.scores.share}`
    );
    lines.push("");
  });
}

function renderNewsletterTxt(lines: string[], payload: NewsletterPayload): void {
  pushHeading(lines, "Newsletter");
  pushParagraph(lines, `Headline: ${payload.headline}`);
  pushParagraph(lines, `Subheadline: ${payload.subheadline}`);
  payload.sections.forEach((section, index) => {
    if (section.type === "application") {
      pushParagraph(lines, `Secao ${index + 1}: Aplicacao`);
      pushList(lines, section.bullets, true);
      return;
    }

    const label =
      section.type === "intro"
        ? "Intro"
        : section.type === "insight"
          ? `Insight: ${section.title}`
          : "CTA";
    pushParagraph(lines, `Secao ${index + 1}: ${label}`);
    pushParagraph(lines, section.text);
  });
}

function renderLinkedinTxt(lines: string[], payload: LinkedinPayload): void {
  pushHeading(lines, "LinkedIn");
  pushParagraph(lines, `Hook: ${payload.hook}`);
  if (payload.body.length > 0) {
    pushParagraph(lines, "Corpo:");
    pushList(lines, payload.body, true);
  }
  pushParagraph(lines, `CTA: ${payload.ctaQuestion}`);
}

function renderXTxt(lines: string[], payload: XPostsPayload): void {
  pushHeading(lines, "X");
  if (payload.standalone.length > 0) {
    pushParagraph(lines, "Posts avulsos:");
    pushList(lines, payload.standalone, true);
  }
  if (payload.thread.length > 0) {
    pushParagraph(lines, "Thread:");
    pushList(lines, payload.thread, true);
  }
  pushParagraph(lines, `Style note: ${payload.notes.style}`);
}

function renderGenericJsonTxt(lines: string[], title: string, payload: GeneratedAssetPayload): void {
  pushHeading(lines, title);
  pushParagraph(lines, JSON.stringify(payload, null, 2));
}

interface SourceAttributionItem {
  idx: number;
  start: string;
  end: string;
  score: number;
  excerpt: string;
}

function parseSourceAttributionItem(value: unknown): SourceAttributionItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const idx = Number(record.idx);
  const score = Number(record.score);
  const start = typeof record.start === "string" ? record.start : "";
  const end = typeof record.end === "string" ? record.end : "";
  const excerpt = typeof record.excerpt === "string" ? record.excerpt : "";
  if (!Number.isFinite(idx) || !Number.isFinite(score) || !start || !end || !excerpt) {
    return null;
  }

  return {
    idx,
    start,
    end,
    score,
    excerpt
  };
}

function parseAttributionMap(
  attribution: Record<string, unknown> | null
): Array<{ path: string; sources: SourceAttributionItem[] }> {
  if (!attribution) {
    return [];
  }

  const result: Array<{ path: string; sources: SourceAttributionItem[] }> = [];
  for (const [pathKey, raw] of Object.entries(attribution)) {
    if (!Array.isArray(raw)) {
      continue;
    }

    const sources = raw
      .map((item) => parseSourceAttributionItem(item))
      .filter((item): item is SourceAttributionItem => Boolean(item))
      .slice(0, 3);
    if (sources.length > 0) {
      result.push({
        path: pathKey,
        sources
      });
    }
  }

  return result;
}

function renderSourceAttributionPdf(
  doc: PDFKit.PDFDocument,
  attribution: Record<string, unknown> | null
): void {
  const map = parseAttributionMap(attribution);
  if (map.length === 0) {
    return;
  }

  pdfSectionTitle(doc, "Fontes internas por bloco");
  for (const block of map) {
    pdfText(doc, `Bloco: ${block.path}`);
    for (const source of block.sources) {
      pdfText(
        doc,
        `- seg ${source.idx} (${source.start} -> ${source.end}) score ${source.score.toFixed(3)}: ${source.excerpt}`
      );
    }
  }
}

function renderSourceAttributionTxt(
  lines: string[],
  attribution: Record<string, unknown> | null
): void {
  const map = parseAttributionMap(attribution);
  if (map.length === 0) {
    return;
  }

  pushHeading(lines, "Fontes internas por bloco");
  for (const block of map) {
    lines.push(`- bloco: ${block.path}`);
    for (const source of block.sources) {
      lines.push(
        `  - seg ${source.idx} (${source.start} -> ${source.end}) score ${source.score.toFixed(3)}: ${source.excerpt}`
      );
    }
  }
}

function renderSourceAttributionMarkdown(
  lines: string[],
  attribution: Record<string, unknown> | null
): void {
  const map = parseAttributionMap(attribution);
  if (map.length === 0) {
    return;
  }

  lines.push("");
  lines.push("### Fontes internas por bloco");
  for (const block of map) {
    lines.push(`- \`${block.path}\``);
    for (const source of block.sources) {
      lines.push(
        `  - seg ${source.idx} (${source.start} -> ${source.end}) · score ${source.score.toFixed(3)} · ${source.excerpt}`
      );
    }
  }
}

function pushMarkdownHeader(lines: string[], title: string): void {
  lines.push("");
  lines.push(`## ${title}`);
}

function renderAnalysisMarkdown(lines: string[], payload: AnalysisPayload): void {
  pushMarkdownHeader(lines, "Analise narrativa");
  lines.push(`**Tese:** ${payload.thesis}`);
  if (payload.topics.length > 0) {
    lines.push("");
    lines.push("**Topicos**");
    payload.topics.forEach((topic) => lines.push(`- ${topic}`));
  }
  lines.push("");
  lines.push(`**Tipo:** ${payload.contentType} | **Polaridade:** ${payload.polarityScore}/10`);
  if (payload.structure) {
    lines.push("");
    lines.push(`- Problema: ${payload.structure.problem}`);
    lines.push(`- Tensao: ${payload.structure.tension}`);
    lines.push(`- Insight: ${payload.structure.insight}`);
    lines.push(`- Aplicacao: ${payload.structure.application}`);
  }
  if (payload.recommendations.length > 0) {
    lines.push("");
    lines.push("**Recomendacoes**");
    payload.recommendations.forEach((item) => lines.push(`1. ${item}`));
  }
}

function renderReelsMarkdown(lines: string[], payload: ReelsPayload): void {
  pushMarkdownHeader(lines, "Reels");
  payload.clips.forEach((clip, idx) => {
    lines.push("");
    lines.push(`### Clip ${idx + 1}`);
    lines.push(`- Titulo: ${clip.title}`);
    lines.push(`- Janela: ${clip.start} -> ${clip.end}`);
    lines.push(`- Legenda: ${clip.caption}`);
    lines.push(`- Hashtags: ${clip.hashtags.join(" ")}`);
    lines.push(`- Porque funciona: ${clip.whyItWorks}`);
    lines.push(
      `- Scores: hook ${clip.scores.hook} | clareza ${clip.scores.clarity} | retencao ${clip.scores.retention} | share ${clip.scores.share}`
    );
  });
}

function renderNewsletterMarkdown(lines: string[], payload: NewsletterPayload): void {
  pushMarkdownHeader(lines, "Newsletter");
  lines.push(`**Headline:** ${payload.headline}`);
  lines.push(`**Subheadline:** ${payload.subheadline}`);
  payload.sections.forEach((section, idx) => {
    lines.push("");
    lines.push(`### Secao ${idx + 1} (${section.type})`);
    if (section.type === "application") {
      section.bullets.forEach((item) => lines.push(`- ${item}`));
      return;
    }
    if ("title" in section) {
      lines.push(`**${section.title}**`);
    }
    lines.push(section.text);
  });
}

function renderLinkedinMarkdown(lines: string[], payload: LinkedinPayload): void {
  pushMarkdownHeader(lines, "LinkedIn");
  lines.push(`**Hook:** ${payload.hook}`);
  lines.push("");
  lines.push("**Corpo**");
  payload.body.forEach((paragraph) => lines.push(`- ${paragraph}`));
  lines.push("");
  lines.push(`**CTA:** ${payload.ctaQuestion}`);
}

function renderXMarkdown(lines: string[], payload: XPostsPayload): void {
  pushMarkdownHeader(lines, "X");
  lines.push("### Posts avulsos");
  payload.standalone.forEach((post) => lines.push(`- ${post}`));
  lines.push("");
  lines.push("### Thread");
  payload.thread.forEach((post) => lines.push(`- ${post}`));
  lines.push("");
  lines.push(`**Style note:** ${payload.notes.style}`);
}

srtsRouter.post(
  "/projects/:id/srts",
  uploader.single("file"),
  (req, res) => {
    const projectId = req.params.id;
    const project = store.getProject(projectId);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Missing SRT file. Send it with form field 'file'." });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ACCEPTED_TRANSCRIPT_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        error: "Only .srt or .txt files are supported (with SRT-formatted timestamps)"
      });
    }

    const asset = store.createSrtAsset({
      projectId,
      filename: req.file.originalname,
      filePath: req.file.path,
      generationProfile: resolveGenerationProfile(parseMaybeJson(req.body.generationProfile))
    });

    enqueueSrtProcessing(asset.id);

    const response: UploadSrtResponse = {
      srtAssetId: asset.id,
      status: asset.status
    };

    return res.status(202).json(response);
  }
);

srtsRouter.patch("/srts/:id/profile", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid generation profile payload",
      details: parsed.error.flatten()
    });
  }

  const nextProfile = mergeGenerationProfile(asset.generationProfile, parsed.data.generationProfile);
  const updated = store.updateSrtAssetGenerationProfile(asset.id, nextProfile);
  if (!updated) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  if (parsed.data.rerun) {
    enqueueSrtProcessing(asset.id);
  }

  const response: UpdateSrtProfileResponse = {
    asset: toPublicAsset(updated),
    rerunQueued: parsed.data.rerun
  };

  return res.json(response);
});

srtsRouter.get("/srts/:id", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const detail: SrtDetailResponse = {
    asset: toPublicAsset(asset),
    segmentCount: store.getSegments(asset.id).length,
    latestJob: store.getLatestJob(asset.id)
  };

  return res.json(detail);
});

srtsRouter.post("/srts/:id/run", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  enqueueSrtProcessing(asset.id);

  return res.status(202).json({
    srtAssetId: asset.id,
    status: store.getSrtAsset(asset.id)?.status ?? "uploaded"
  });
});

srtsRouter.get("/srts/:id/jobs", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const payload: SrtJobsResponse = {
    jobs: store.listJobs(asset.id)
  };

  return res.json(payload);
});

srtsRouter.get("/srts/:id/assets", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const payload: SrtAssetsResponse = {
    assets: store.listGeneratedAssets(asset.id)
  };

  return res.json(payload);
});

srtsRouter.get("/srts/:id/diagnostics", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const payload: SrtDiagnosticsResponse = {
    diagnostics: store.listGenerationDiagnostics(asset.id)
  };

  return res.json(payload);
});

srtsRouter.get("/srts/:id/assets/:type", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const type = req.params.type as GeneratedAssetType;
  if (!SUPPORTED_ASSET_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unsupported asset type" });
  }

  const payload: SrtAssetByTypeResponse = {
    asset: store.getGeneratedAssetByType(asset.id, type)
  };

  return res.json(payload);
});

srtsRouter.post("/srts/:id/diagnostics/:task/select-variant", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const task = req.params.task as AITask;
  if (!["analysis", "reels", "newsletter", "linkedin", "x"].includes(task)) {
    return res.status(400).json({ error: "Unsupported task" });
  }

  const parsed = selectVariantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid select variant payload",
      details: parsed.error.flatten()
    });
  }

  const diagnostics = store
    .listGenerationDiagnostics(asset.id)
    .find((item) => item.task === task);
  if (!diagnostics) {
    return res.status(404).json({ error: "Task diagnostics not found" });
  }

  const selectedVariant = diagnostics.variants.find(
    (variant) => variant.variant === parsed.data.variant
  );
  if (!selectedVariant) {
    return res.status(404).json({ error: "Variant not found" });
  }

  if (selectedVariant.status !== "ok") {
    return res.status(400).json({ error: "Variant is not valid and cannot be selected" });
  }

  const normalized = asRecord(selectedVariant.normalizedOutput);
  if (!normalized) {
    return res.status(400).json({ error: "Variant has no normalized output to apply" });
  }

  const validation = asRecord(normalized._validation);
  if (validation && validation.ok === false) {
    return res.status(400).json({ error: "Variant failed validation and cannot be selected" });
  }

  const payload = stripVariantMetaFromPayload(normalized);
  const savedAsset = store.upsertGeneratedAsset({
    srtAssetId: asset.id,
    type: taskToAssetType(task),
    status: resolveAssetStatusByDiagnostics(asset.id, task),
    payload
  });

  const diagnosticsNext = {
    ...diagnostics,
    selectedVariant: parsed.data.variant,
    variants: diagnostics.variants.map((variant) => ({
      ...variant,
      selected: variant.variant === parsed.data.variant
    }))
  };
  const { updatedAt: _updatedAt, ...diagnosticsUpsert } = diagnosticsNext;
  store.upsertGenerationDiagnostics(diagnosticsUpsert);

  const response: SelectAssetVariantResponse = {
    asset: savedAsset,
    task,
    selectedVariant: parsed.data.variant
  };

  return res.status(200).json(response);
});

srtsRouter.post("/srts/:id/assets/:type/refine", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const type = req.params.type as GeneratedAssetType;
  if (!SUPPORTED_ASSET_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unsupported asset type" });
  }

  if (!["analysis", "reels", "newsletter", "linkedin", "x"].includes(type)) {
    return res.status(400).json({ error: "Refinement supported only for text assets" });
  }

  const parsed = refineAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid refine payload",
      details: parsed.error.flatten()
    });
  }

  enqueueAssetRefinement(
    asset.id,
    type,
    parsed.data.action,
    parsed.data.instruction
  );

  const payload: RefineAssetResponse = {
    srtAssetId: asset.id,
    type,
    action: parsed.data.action,
    status: "queued"
  };

  return res.status(202).json(payload);
});

srtsRouter.post("/srts/:id/assets/:type/blocks/refine", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const type = req.params.type as GeneratedAssetType;
  if (!SUPPORTED_ASSET_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unsupported asset type" });
  }

  if (!["analysis", "reels", "newsletter", "linkedin", "x"].includes(type)) {
    return res.status(400).json({ error: "Refinement supported only for text assets" });
  }

  const parsed = refineAssetBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid refine block payload",
      details: parsed.error.flatten()
    });
  }

  enqueueAssetBlockRefinement(
    asset.id,
    type,
    parsed.data.blockPath,
    parsed.data.action,
    parsed.data.instruction,
    parsed.data.evidenceOnly
  );

  const payload: RefineAssetBlockResponse = {
    srtAssetId: asset.id,
    type,
    blockPath: parsed.data.blockPath,
    action: parsed.data.action,
    evidenceOnly: parsed.data.evidenceOnly,
    status: "queued"
  };

  return res.status(202).json(payload);
});

srtsRouter.patch("/srts/:id/assets/:type/manual", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const type = req.params.type as GeneratedAssetType;
  if (!SUPPORTED_ASSET_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unsupported asset type" });
  }

  if (!["analysis", "reels", "newsletter", "linkedin", "x"].includes(type)) {
    return res.status(400).json({ error: "Manual save supported only for text assets" });
  }

  const parsed = saveAssetManualSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid manual asset payload",
      details: parsed.error.flatten()
    });
  }

  const task = assetTypeToTask(type);
  if (!task) {
    return res.status(400).json({ error: "Manual save supported only for text assets" });
  }

  const saved = store.upsertGeneratedAsset({
    srtAssetId: asset.id,
    type,
    status: resolveAssetStatusByDiagnostics(asset.id, task),
    payload: parsed.data.payload as GeneratedAssetPayload
  });

  const response: SaveAssetManualResponse = {
    asset: saved
  };
  return res.status(200).json(response);
});

srtsRouter.get("/srts/:id/export/pdf", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }
  const mode = resolveExportMode(req.query.mode);
  const includeSources = mode === "debug" || isTruthyQueryFlag(req.query.includeSources);
  const includeAnalysis = mode === "debug" || isTruthyQueryFlag(req.query.includeAnalysis);
  const includeJsonAssets = mode === "debug" || isTruthyQueryFlag(req.query.includeJsonAssets);

  const analysisAsset = store.getGeneratedAssetByType(asset.id, "analysis");
  const reelsAsset = store.getGeneratedAssetByType(asset.id, "reels");
  const newsletterAsset = store.getGeneratedAssetByType(asset.id, "newsletter");
  const linkedinAsset = store.getGeneratedAssetByType(asset.id, "linkedin");
  const xAsset = store.getGeneratedAssetByType(asset.id, "x");
  const carouselAsset = store.getGeneratedAssetByType(asset.id, "carousel");
  const coversAsset = store.getGeneratedAssetByType(asset.id, "covers");
  const analysisAttribution = pickAttributionFromTaskDiagnostics(asset.id, "analysis");
  const reelsAttribution = pickAttributionFromTaskDiagnostics(asset.id, "reels");
  const newsletterAttribution = pickAttributionFromTaskDiagnostics(asset.id, "newsletter");
  const linkedinAttribution = pickAttributionFromTaskDiagnostics(asset.id, "linkedin");
  const xAttribution = pickAttributionFromTaskDiagnostics(asset.id, "x");

  const hasPublishAssets = Boolean(reelsAsset || newsletterAsset || linkedinAsset || xAsset);
  const hasAnyAssets = Boolean(
    analysisAsset || reelsAsset || newsletterAsset || linkedinAsset || xAsset || carouselAsset || coversAsset
  );

  if (!hasAnyAssets) {
    return res.status(400).json({ error: "No generated assets available to export" });
  }
  if (mode === "publish" && !hasPublishAssets) {
    return res.status(400).json({ error: "No publish-ready channel assets available to export" });
  }

  const suffix = mode === "debug" ? "authority-export-debug" : "authority-posting-pack";
  const filename = `${safePdfFilename(asset.filename)}-${suffix}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);

  const doc = new PDFDocument({
    size: "A4",
    margin: 48
  });
  doc.pipe(res);

  if (mode === "publish") {
    renderPublishHeaderPdf(doc, asset);
    if (reelsAsset) {
      renderReelsPublishPdf(doc, reelsAsset.payload as ReelsPayload);
    }
    if (newsletterAsset) {
      renderNewsletterPublishPdf(doc, newsletterAsset.payload as NewsletterPayload);
    }
    if (linkedinAsset) {
      renderLinkedinPublishPdf(doc, linkedinAsset.payload as LinkedinPayload);
    }
    if (xAsset) {
      renderXPublishPdf(doc, xAsset.payload as XPostsPayload);
    }
  } else {
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("Authority Distribution Engine Export");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10.5).fillColor("#334155").text(`SRT ID: ${asset.id}`);
    doc.text(`Arquivo: ${asset.filename}`);
    doc.text(`Gerado em: ${new Date().toISOString()}`);
    doc.text(`Status atual: ${asset.status}`);
    doc.moveDown(0.6);

    if (includeAnalysis && analysisAsset) {
      renderAnalysisPdf(doc, analysisAsset.payload as AnalysisPayload);
      if (includeSources) {
        renderSourceAttributionPdf(doc, analysisAttribution);
      }
    }
    if (reelsAsset) {
      renderReelsPdf(doc, reelsAsset.payload as ReelsPayload);
      if (includeSources) {
        renderSourceAttributionPdf(doc, reelsAttribution);
      }
    }
    if (newsletterAsset) {
      renderNewsletterPdf(doc, newsletterAsset.payload as NewsletterPayload);
      if (includeSources) {
        renderSourceAttributionPdf(doc, newsletterAttribution);
      }
    }
    if (linkedinAsset) {
      renderLinkedinPdf(doc, linkedinAsset.payload as LinkedinPayload);
      if (includeSources) {
        renderSourceAttributionPdf(doc, linkedinAttribution);
      }
    }
    if (xAsset) {
      renderXPdf(doc, xAsset.payload as XPostsPayload);
      if (includeSources) {
        renderSourceAttributionPdf(doc, xAttribution);
      }
    }
    if (includeJsonAssets && carouselAsset) {
      renderGenericJsonPdf(doc, "Carousel", carouselAsset.payload as GeneratedAssetPayload);
    }
    if (includeJsonAssets && coversAsset) {
      renderGenericJsonPdf(doc, "Covers", coversAsset.payload as GeneratedAssetPayload);
    }
  }

  doc.end();
});

srtsRouter.get("/srts/:id/export/txt", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const analysisAsset = store.getGeneratedAssetByType(asset.id, "analysis");
  const reelsAsset = store.getGeneratedAssetByType(asset.id, "reels");
  const newsletterAsset = store.getGeneratedAssetByType(asset.id, "newsletter");
  const linkedinAsset = store.getGeneratedAssetByType(asset.id, "linkedin");
  const xAsset = store.getGeneratedAssetByType(asset.id, "x");
  const carouselAsset = store.getGeneratedAssetByType(asset.id, "carousel");
  const coversAsset = store.getGeneratedAssetByType(asset.id, "covers");
  const analysisAttribution = pickAttributionFromTaskDiagnostics(asset.id, "analysis");
  const reelsAttribution = pickAttributionFromTaskDiagnostics(asset.id, "reels");
  const newsletterAttribution = pickAttributionFromTaskDiagnostics(asset.id, "newsletter");
  const linkedinAttribution = pickAttributionFromTaskDiagnostics(asset.id, "linkedin");
  const xAttribution = pickAttributionFromTaskDiagnostics(asset.id, "x");

  if (
    !analysisAsset &&
    !reelsAsset &&
    !newsletterAsset &&
    !linkedinAsset &&
    !xAsset &&
    !carouselAsset &&
    !coversAsset
  ) {
    return res.status(400).json({ error: "No generated assets available to export" });
  }

  const lines: string[] = [
    "Authority Distribution Engine Export",
    `SRT ID: ${asset.id}`,
    `Arquivo: ${asset.filename}`,
    `Gerado em: ${new Date().toISOString()}`,
    `Status atual: ${asset.status}`
  ];

  if (analysisAsset) {
    renderAnalysisTxt(lines, analysisAsset.payload as AnalysisPayload);
    renderSourceAttributionTxt(lines, analysisAttribution);
  }
  if (reelsAsset) {
    renderReelsTxt(lines, reelsAsset.payload as ReelsPayload);
    renderSourceAttributionTxt(lines, reelsAttribution);
  }
  if (newsletterAsset) {
    renderNewsletterTxt(lines, newsletterAsset.payload as NewsletterPayload);
    renderSourceAttributionTxt(lines, newsletterAttribution);
  }
  if (linkedinAsset) {
    renderLinkedinTxt(lines, linkedinAsset.payload as LinkedinPayload);
    renderSourceAttributionTxt(lines, linkedinAttribution);
  }
  if (xAsset) {
    renderXTxt(lines, xAsset.payload as XPostsPayload);
    renderSourceAttributionTxt(lines, xAttribution);
  }
  if (carouselAsset) {
    renderGenericJsonTxt(lines, "Carousel", carouselAsset.payload as GeneratedAssetPayload);
  }
  if (coversAsset) {
    renderGenericJsonTxt(lines, "Covers", coversAsset.payload as GeneratedAssetPayload);
  }

  const filename = `${safePdfFilename(asset.filename)}-authority-export.txt`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.status(200).send(lines.join("\n"));
});

srtsRouter.get("/srts/:id/export/markdown", (req, res) => {
  const asset = store.getSrtAsset(req.params.id);
  if (!asset) {
    return res.status(404).json({ error: "SRT asset not found" });
  }

  const analysisAsset = store.getGeneratedAssetByType(asset.id, "analysis");
  const reelsAsset = store.getGeneratedAssetByType(asset.id, "reels");
  const newsletterAsset = store.getGeneratedAssetByType(asset.id, "newsletter");
  const linkedinAsset = store.getGeneratedAssetByType(asset.id, "linkedin");
  const xAsset = store.getGeneratedAssetByType(asset.id, "x");
  const carouselAsset = store.getGeneratedAssetByType(asset.id, "carousel");
  const coversAsset = store.getGeneratedAssetByType(asset.id, "covers");
  const analysisAttribution = pickAttributionFromTaskDiagnostics(asset.id, "analysis");
  const reelsAttribution = pickAttributionFromTaskDiagnostics(asset.id, "reels");
  const newsletterAttribution = pickAttributionFromTaskDiagnostics(asset.id, "newsletter");
  const linkedinAttribution = pickAttributionFromTaskDiagnostics(asset.id, "linkedin");
  const xAttribution = pickAttributionFromTaskDiagnostics(asset.id, "x");

  if (
    !analysisAsset &&
    !reelsAsset &&
    !newsletterAsset &&
    !linkedinAsset &&
    !xAsset &&
    !carouselAsset &&
    !coversAsset
  ) {
    return res.status(400).json({ error: "No generated assets available to export" });
  }

  const lines: string[] = [
    "# Authority Distribution Engine Export",
    "",
    `- SRT ID: ${asset.id}`,
    `- Arquivo: ${asset.filename}`,
    `- Gerado em: ${new Date().toISOString()}`,
    `- Status atual: ${asset.status}`
  ];

  if (analysisAsset) {
    renderAnalysisMarkdown(lines, analysisAsset.payload as AnalysisPayload);
    renderSourceAttributionMarkdown(lines, analysisAttribution);
  }
  if (reelsAsset) {
    renderReelsMarkdown(lines, reelsAsset.payload as ReelsPayload);
    renderSourceAttributionMarkdown(lines, reelsAttribution);
  }
  if (newsletterAsset) {
    renderNewsletterMarkdown(lines, newsletterAsset.payload as NewsletterPayload);
    renderSourceAttributionMarkdown(lines, newsletterAttribution);
  }
  if (linkedinAsset) {
    renderLinkedinMarkdown(lines, linkedinAsset.payload as LinkedinPayload);
    renderSourceAttributionMarkdown(lines, linkedinAttribution);
  }
  if (xAsset) {
    renderXMarkdown(lines, xAsset.payload as XPostsPayload);
    renderSourceAttributionMarkdown(lines, xAttribution);
  }
  if (carouselAsset) {
    pushMarkdownHeader(lines, "Carousel");
    lines.push("```json");
    lines.push(JSON.stringify(carouselAsset.payload, null, 2));
    lines.push("```");
  }
  if (coversAsset) {
    pushMarkdownHeader(lines, "Covers");
    lines.push("```json");
    lines.push(JSON.stringify(coversAsset.payload, null, 2));
    lines.push("```");
  }

  const filename = `${safePdfFilename(asset.filename)}-authority-export.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.status(200).send(lines.join("\n"));
});
