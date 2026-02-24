import type { ParsedSrt } from "@authority/shared";

const TIMESTAMP_MS_REGEX = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/;
const TIMESTAMP_FRAME_REGEX = /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/;
const SPEAKER_LINE_REGEX = /^[a-zA-ZÀ-ÿ' ]{2,30}$/;
const DEFAULT_FPS = 30;

function toMs(rawTimestamp: string): number {
  const compact = rawTimestamp.trim();

  const msMatch = compact.match(TIMESTAMP_MS_REGEX);
  if (msMatch) {
    const [, h, m, s, ms] = msMatch;

    return (
      Number(h) * 60 * 60 * 1000 +
      Number(m) * 60 * 1000 +
      Number(s) * 1000 +
      Number(ms)
    );
  }

  const frameMatch = compact.match(TIMESTAMP_FRAME_REGEX);
  if (frameMatch) {
    const [, h, m, s, frames] = frameMatch;
    const frameMs = Math.round((Number(frames) / DEFAULT_FPS) * 1000);

    return (
      Number(h) * 60 * 60 * 1000 +
      Number(m) * 60 * 1000 +
      Number(s) * 1000 +
      frameMs
    );
  }

  throw new Error(`Invalid timestamp: ${rawTimestamp}`);
}

function parseTimelineLine(line: string): { startMs: number; endMs: number } | null {
  const compact = line.trim();

  if (compact.includes("-->")) {
    const [rawStart, rawEnd] = compact.split("-->").map((part) => part.trim());
    if (!rawStart || !rawEnd) {
      return null;
    }
    return { startMs: toMs(rawStart), endMs: toMs(rawEnd) };
  }

  if (compact.includes(" - ")) {
    const [rawStart, rawEnd] = compact.split(" - ").map((part) => part.trim());
    if (!rawStart || !rawEnd) {
      return null;
    }
    return { startMs: toMs(rawStart), endMs: toMs(rawEnd) };
  }

  return null;
}

function estimateTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sanitizeTextLines(lines: string[]): string {
  if (lines.length === 0) {
    return "";
  }

  const cleaned = [...lines];
  const first = cleaned[0]?.trim() ?? "";

  // A lot of transcript TXT exports include a speaker marker line.
  if (
    cleaned.length > 1 &&
    SPEAKER_LINE_REGEX.test(first) &&
    !/[.!?]/.test(first)
  ) {
    cleaned.shift();
  }

  return cleaned.join(" ").replace(/\s+/g, " ").trim();
}

export function parseSrt(content: string, language = "pt-BR"): ParsedSrt {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("SRT is empty");
  }

  const blocks = normalized.split(/\n\s*\n/g);

  const segments = blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const timelineIdx = lines.findIndex((line) => Boolean(parseTimelineLine(line)));
      if (timelineIdx === -1) {
        return null;
      }

      const timeline = parseTimelineLine(lines[timelineIdx]);
      if (!timeline) {
        return null;
      }

      const text = sanitizeTextLines(lines.slice(timelineIdx + 1));
      if (!text) {
        return null;
      }

      if (timeline.endMs <= timeline.startMs) {
        return null;
      }

      return {
        startMs: timeline.startMs,
        endMs: timeline.endMs,
        text
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment, idx) => ({
      idx: idx + 1,
      ...segment,
      tokensEst: estimateTokens(segment.text)
    }));

  if (segments.length === 0) {
    throw new Error("No valid transcript segments found in SRT");
  }

  const durationSec = Math.ceil(segments[segments.length - 1].endMs / 1000);

  return {
    language,
    durationSec,
    segments
  };
}
