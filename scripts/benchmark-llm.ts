/**
 * LLM Benchmark — compare extraction accuracy & cost across models
 *
 * Usage:
 *   tsx --env-file=.env scripts/benchmark-llm.ts <path-to-pdf>
 *
 * Requires in .env:
 *   ANTHROPIC_API_KEY
 *   GEMINI_API_KEY
 *   ANTHROPIC_WORKSPACE_ID  (only if using an identity-linked Anthropic key)
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const PDF_PATH = process.argv[2];
if (!PDF_PATH) {
  console.error('Usage: tsx --env-file=.env scripts/benchmark-llm.ts <path-to-pdf>');
  process.exit(1);
}

const pdfBuffer = fs.readFileSync(path.resolve(PDF_PATH));
const base64Pdf = pdfBuffer.toString('base64');

// ── Shared extraction prompt (same as production) ─────────────────────────────
const PROMPT = `Analyze this document and extract its financial data. Return ONLY a single JSON object, no explanation.

If this is a BANK STATEMENT return:
{
  "document_type": "bank_statement",
  "transactions": [
    { "date": "MM/DD/YYYY", "description": "...", "amount": "positive number", "type": "debit or credit", "balance": "..." }
  ]
}

If this is an INVOICE or BILL return:
{
  "document_type": "invoice",
  "invoice_type": "ap or ar",
  "vendor_customer": "...",
  "invoice_number": "...",
  "invoice_date": "MM/DD/YYYY",
  "due_date": "MM/DD/YYYY",
  "subtotal": "...",
  "tax_amount": "...",
  "total": "...",
  "line_items": [
    { "description": "...", "quantity": "...", "unit_price": "...", "amount": "..." }
  ]
}

If neither: { "document_type": "unknown" }`;

// ── Pricing: [$/1M input tokens, $/1M output tokens] ─────────────────────────
const PRICING: Record<string, [number, number]> = {
  'gemini-3.6-flash':          [0.075,  0.30],
  'claude-haiku-4-5-20251001': [0.80,   4.00],
  'gemini-3.1-pro-preview':    [1.25,  10.00],
  'claude-sonnet-5':           [3.00,  15.00],
};

function estimateCost(modelKey: string, inputTokens: number, outputTokens: number): string {
  const pricing = PRICING[modelKey];
  if (!pricing) return '?';
  const [inRate, outRate] = pricing;
  const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
  return `$${cost.toFixed(5)}`;
}

type RunResult = { result: string; inputTokens: number; outputTokens: number; ms: number };

// ── Claude runner ─────────────────────────────────────────────────────────────
async function runClaude(modelId: string): Promise<RunResult> {
  const workspaceId = process.env['ANTHROPIC_WORKSPACE_ID'];
  const client = new Anthropic(
    workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {},
  );
  const start = Date.now();
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        { type: 'text', text: PROMPT },
      ] as Anthropic.MessageParam['content'],
    }],
  });
  return {
    result: response.content[0]?.type === 'text' ? response.content[0].text : '',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    ms: Date.now() - start,
  };
}

// ── Gemini runner (REST — no extra SDK needed) ────────────────────────────────
async function runGemini(modelId: string): Promise<RunResult> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const res = await fetch(url, {
    signal: controller.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
        { text: PROMPT },
      ] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0 },
    }),
  });
  clearTimeout(timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text?: string }> } }>;
    usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
  };
  return {
    result: data.candidates[0]?.content.parts[0]?.text ?? '',
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    ms: Date.now() - start,
  };
}

// ── Models to benchmark ───────────────────────────────────────────────────────
const MODELS = [
  { label: 'Gemini 3.6 Flash  (~$1/mo)', key: 'gemini-3.6-flash',           run: runGemini },
  { label: 'Claude Haiku 4.5 (~$11/mo)', key: 'claude-haiku-4-5-20251001',  run: runClaude },
  { label: 'Gemini 3.1 Pro   (~$17/mo)', key: 'gemini-3.1-pro-preview',     run: runGemini },
  { label: 'Claude Sonnet 5  (~$23/mo)', key: 'claude-sonnet-5',            run: runClaude },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
type Extracted = {
  document_type?: string;
  transactions?: unknown[];
  line_items?: unknown[];
  total?: string;
  vendor_customer?: string;
  invoice_type?: string;
};

function parseExtraction(raw: string): { parsed: Extracted | null; error: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { parsed: null, error: 'No JSON object found in response' };
  try {
    return { parsed: JSON.parse(match[0]) as Extracted, error: '' };
  } catch {
    return { parsed: null, error: 'JSON parse failed' };
  }
}

function scoreAccuracy(parsed: Extracted | null): string {
  if (!parsed) return '✗ failed';
  if (parsed.document_type === 'bank_statement') {
    const n = parsed.transactions?.length ?? 0;
    return n > 0 ? `✓ ${n} transactions` : '⚠ 0 transactions';
  }
  if (parsed.document_type === 'invoice') {
    const n = parsed.line_items?.length ?? 0;
    const total = parsed.total ?? '?';
    return `✓ ${parsed.invoice_type?.toUpperCase()} · ${n} lines · total ${total}`;
  }
  return '⚠ document_type: unknown';
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function main() {
  const SEP = '─'.repeat(80);

  console.log(`\n${SEP}`);
  console.log(`  LLM Benchmark`);
  console.log(`  PDF : ${path.resolve(PDF_PATH)}`);
  console.log(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
  console.log(SEP + '\n');

  for (const model of MODELS) {
    console.log(`▶  ${model.label}`);
    console.log(`   Model ID : ${model.key}`);
    try {
      const { result, inputTokens, outputTokens, ms } = await model.run(model.key);
      const { parsed, error } = parseExtraction(result);
      const cost = estimateCost(model.key, inputTokens, outputTokens);
      const accuracy = scoreAccuracy(parsed);

      console.log(`   Time     : ${ms} ms`);
      console.log(`   Tokens   : ${inputTokens} in / ${outputTokens} out`);
      console.log(`   Cost/req : ${cost}`);
      console.log(`   Result   : ${accuracy}${error ? '  ⚠ ' + error : ''}`);

      if (parsed) {
        const preview = JSON.stringify(parsed, null, 2);
        const lines = preview.split('\n').slice(0, 20);
        const truncated = preview.split('\n').length > 20;
        console.log('\n   --- extracted JSON (first 20 lines) ---');
        console.log(lines.map(l => '   ' + l).join('\n') + (truncated ? '\n   ...' : ''));
      }
    } catch (e: unknown) {
      console.log(`   Result   : ✗ ERROR — ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('\n' + SEP + '\n');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
