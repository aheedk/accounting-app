import Anthropic from '@anthropic-ai/sdk';
import type { ZodType } from 'zod';

// Same client-construction pattern as jobs/gmailWorker.ts's buildAnthropicClient
// (the only other place this SDK is used) — API key read implicitly from
// ANTHROPIC_API_KEY by the SDK, an optional workspace header.
const MODEL = 'claude-opus-4-5';

export function buildAnthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {});
}

export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

/**
 * `strict: true` tool mode (used below) requires every object-typed node in
 * the schema — including every nested `data`/line-item object, and every
 * branch of a `oneOf` — to explicitly set `additionalProperties: false`, or
 * the API call is rejected outright (found live: "tools.0.custom: For
 * 'object' type, 'additionalProperties' must be explicitly set to false").
 * Hand-adding that to every nested object across 3 tool schemas (one with 4
 * `oneOf` branches, each with its own `data` object and line-item array) is
 * exactly the kind of thing that's easy to miss one of — so it's done once,
 * recursively, here instead, and every `toolInputSchema` passed to
 * `callClaudeWithTool` gets it free.
 */
function withStrictObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withStrictObjects);
  if (node === null || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[key] = withStrictObjects(value);
  if (out['type'] === 'object' && !('additionalProperties' in out)) out['additionalProperties'] = false;
  return out;
}

/**
 * Calls Claude with exactly one tool, forced, then validates the tool call's
 * input against `zodSchema`. Deliberately NOT the prompt-engineered
 * JSON-in-text + regex + bare `JSON.parse` pattern gmailWorker.ts's document
 * extraction uses — tool-use gives a real JSON-schema contract the model is
 * constrained to (`strict: true`), and every result here either becomes a
 * SQL query that's about to run against the database or a financial
 * transaction pre-fill, so runtime-validated structured output matters more
 * here than matching the older pipeline's pattern.
 */
export async function callClaudeWithTool<T>(args: {
  system: string;
  history: ChatHistoryMessage[];
  toolName: string;
  toolDescription: string;
  toolInputSchema: Anthropic.Tool.InputSchema;
  zodSchema: ZodType<T>;
  // Required-but-nullable, not optional — every caller already threads a
  // `client: Anthropic | undefined` through from its own params, and
  // `exactOptionalPropertyTypes` (this repo's own tsconfig) refuses an
  // optional `client?:` being set to a literal `undefined` at the call site.
  client: Anthropic | undefined;
}): Promise<T> {
  const client = args.client ?? buildAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: args.system,
    messages: args.history.map(m => ({ role: m.role, content: m.content })),
    tools: [{
      name: args.toolName,
      description: args.toolDescription,
      input_schema: withStrictObjects(args.toolInputSchema) as Anthropic.Tool.InputSchema,
      strict: true,
    }],
    tool_choice: { type: 'tool', name: args.toolName },
  });
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return the expected tool call');
  return args.zodSchema.parse(toolUse.input);
}

/** A plain-text reply — used for the final "answer in English" turn and for help intent. */
export async function callClaudeForText(args: { system: string; history: ChatHistoryMessage[]; client: Anthropic | undefined }): Promise<string> {
  const client = args.client ?? buildAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: args.system,
    messages: args.history.map(m => ({ role: m.role, content: m.content })),
  });
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return block?.text ?? '';
}
