import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../services/srtParser.js";

test("parseSrt parses standard blocks and computes duration", () => {
  const input = `1\n00:00:01,000 --> 00:00:03,200\nLinha 1\n\n2\n00:00:04,000 --> 00:00:07,500\nLinha 2\ncontinua`; 

  const result = parseSrt(input, "pt-BR");

  assert.equal(result.language, "pt-BR");
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].idx, 1);
  assert.equal(result.segments[0].startMs, 1000);
  assert.equal(result.segments[1].text, "Linha 2 continua");
  assert.equal(result.durationSec, 8);
});

test("parseSrt ignores invalid blocks while keeping valid ones", () => {
  const input = `1\n00:00:05,000 --> 00:00:01,000\nInvalido\n\n2\n00:00:06,000 --> 00:00:09,000\nValido`; 

  const result = parseSrt(input);

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].text, "Valido");
});

test("parseSrt throws on empty input", () => {
  assert.throws(() => parseSrt("\n\n"), /SRT is empty/);
});

test("parseSrt supports TXT timeline with frame-based timestamps", () => {
  const input = `00:00:00:00 - 00:00:02:15\nDesconhecido\nPrimeira frase\n\n00:00:02:20 - 00:00:04:00\nDesconhecido\nSegunda frase`;

  const result = parseSrt(input);

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].text, "Primeira frase");
  assert.equal(result.segments[1].text, "Segunda frase");
  assert.ok(result.segments[0].startMs < result.segments[0].endMs);
});
