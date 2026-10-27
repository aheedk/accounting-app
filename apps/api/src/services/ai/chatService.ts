import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { schemas } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { callClaudeWithTool, callClaudeForText, type ChatHistoryMessage } from './chatLlm.js';
import { buildSchemaContext } from './chatSchemaContext.js';
import { runReadOnlyQuery, UnsafeQueryError } from './chatSqlEngine.js';
import { buildActionPayload } from './chatActionService.js';
import { runInsightQueries, summarizeInsights } from './chatInsightService.js';

const HISTORY_LIMIT = 10;

export type ChatResult = {
  reply: string;
  conversationId: string;
  action?: schemas.ChatActionPayload;
  data?: Record<string, unknown>[];
};

// --- Conversation persistence -----------------------------------------

async function getOrCreateConversation(
  trx: Transaction<DB>, businessId: string, userId: string, conversationId: string | undefined, firstMessage: string,
) {
  if (conversationId) {
    const existing = await trx.selectFrom('chat_conversations').selectAll()
      .where('id', '=', conversationId).where('business_id', '=', businessId).where('user_id', '=', userId)
      .executeTakeFirst();
    if (existing) return existing;
  }
  const title = firstMessage.length > 80 ? `${firstMessage.slice(0, 77)}...` : firstMessage;
  return trx.insertInto('chat_conversations')
    .values({ business_id: businessId, user_id: userId, title })
    .returningAll().executeTakeFirstOrThrow();
}

async function loadRecentMessages(trx: Transaction<DB>, conversationId: string): Promise<ChatHistoryMessage[]> {
  const rows = await trx.selectFrom('chat_messages')
    .select(['role', 'content'])
    .where('conversation_id', '=', conversationId)
    .orderBy('created_at', 'desc')
    .limit(HISTORY_LIMIT)
    .execute();
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

async function insertMessage(
  trx: Transaction<DB>, conversationId: string,
  input: { role: 'user' | 'assistant'; content: string; actionPayload?: schemas.ChatActionPayload; sqlQuery?: string },
) {
  await trx.insertInto('chat_messages').values({
    conversation_id: conversationId,
    role: input.role,
    content: input.content,
    action_payload: input.actionPayload ? JSON.stringify(input.actionPayload) : null,
    sql_query: input.sqlQuery ?? null,
  }).execute();
  await trx.updateTable('chat_conversations').set({ updated_at: sql`now()` }).where('id', '=', conversationId).execute();
}

// --- Intent classification ---------------------------------------------

const intentResultSchema = z.object({ intent: schemas.chatIntentSchema });

async function classifyIntent(message: string, history: ChatHistoryMessage[], client: Anthropic | undefined): Promise<schemas.ChatIntent> {
  const result = await callClaudeWithTool({
    system: `Classify the user's latest message into exactly one intent:
- "query": asking a question about their own financial data (amounts, transactions, balances, who owes what)
- "action": asking to create or record something (a journal entry, expense, invoice, deposit)
- "insight": asking for a general analysis, health check, or "how are we doing" / "anything unusual" style question, not a specific data lookup
- "help": asking how to use the app, or a general accounting question not about their own data`,
    history: [...history, { role: 'user', content: message }],
    toolName: 'classify_intent',
    toolDescription: "Classify the user's message.",
    toolInputSchema: {
      type: 'object',
      properties: { intent: { type: 'string', enum: ['query', 'action', 'insight', 'help'] } },
      required: ['intent'],
      additionalProperties: false,
    },
    zodSchema: intentResultSchema,
    client,
  });
  return result.intent;
}

// --- Query intent: text-to-SQL ------------------------------------------

const sqlResultSchema = z.object({ sql: z.string() });

async function handleQuery(
  db: Kysely<DB>, businessId: string, message: string, history: ChatHistoryMessage[], client: Anthropic | undefined,
): Promise<{ reply: string; data: Record<string, unknown>[]; sqlQuery: string }> {
  const schemaContext = buildSchemaContext();
  const { sql: generatedSql } = await callClaudeWithTool({
    system: `Write a single read-only PostgreSQL SELECT query to answer the user's question about their business's accounting data.
- Always filter by business_id = $1 for tenant isolation — use the literal parameter token $1, never a literal uuid.
- Use appropriate JOINs, GROUP BY, and date filtering.
- For relative date ranges, use real PostgreSQL interval units only (year/month/week/day/hour) — there is no "quarter" interval unit. For "last quarter", compute it with date_trunc('quarter', CURRENT_DATE) and interval arithmetic in months (a quarter is 3 months), not INTERVAL '1 quarter'.
- Only reference the tables below. Return exactly one SELECT (or WITH ... SELECT) statement, no comments, no trailing explanation.

${schemaContext}`,
    history: [...history, { role: 'user', content: message }],
    toolName: 'generate_sql',
    toolDescription: 'Return the SQL query to run.',
    toolInputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'], additionalProperties: false },
    zodSchema: sqlResultSchema,
    client,
  });

  let rows: Record<string, unknown>[];
  try {
    rows = await runReadOnlyQuery(db, businessId, generatedSql);
  } catch (e) {
    if (e instanceof UnsafeQueryError) {
      return {
        reply: "I couldn't safely answer that — the query I generated didn't pass a safety check, so I didn't run it. Try rephrasing the question.",
        data: [],
        sqlQuery: generatedSql,
      };
    }
    // The static guardrail only checks shape/safety, not that the generated
    // SQL is actually valid — a query can pass it and still fail at
    // execution (bad syntax, a typo'd column). That's a query-generation
    // quality issue, not a security one, so it should degrade to a normal
    // reply rather than a 500.
    return {
      reply: "I couldn't answer that — the query I generated didn't run successfully. Try rephrasing the question.",
      data: [],
      sqlQuery: generatedSql,
    };
  }

  const reply = await callClaudeForText({
    system: 'Answer the user\'s question in plain English using only the query results given. Include specific numbers. If the results are empty, say so honestly rather than guessing.',
    history: [
      ...history,
      { role: 'user', content: message },
      { role: 'user', content: `Query results (JSON): ${JSON.stringify(rows)}` },
    ],
    client,
  });

  return { reply, data: rows, sqlQuery: generatedSql };
}

// --- Insight intent -------------------------------------------------------

async function handleInsight(db: Kysely<DB>, businessId: string, client: Anthropic | undefined): Promise<string> {
  const metrics = await runInsightQueries(db, businessId);
  return summarizeInsights(metrics, client);
}

// --- Help intent ------------------------------------------------------

async function handleHelp(message: string, history: ChatHistoryMessage[], client: Anthropic | undefined): Promise<string> {
  return callClaudeForText({
    system: 'You are an assistant for an accounting app (Accmatica). Answer questions about how to use the app or general accounting concepts (e.g. reconciliation, the difference between a bill and an expense). You have no access to this business\'s actual data for this kind of question — if asked something that needs real data, say so and suggest asking as a data question instead.',
    history: [...history, { role: 'user', content: message }],
    client,
  });
}

// --- Orchestration ------------------------------------------------------

export async function handleChatMessage(
  db: Kysely<DB>,
  ctx: { business_id: string; user_id: string },
  input: { message: string; conversationId?: string },
  deps: { client?: Anthropic } = {},
): Promise<ChatResult> {
  return db.transaction().execute(async trx => {
    const conversation = await getOrCreateConversation(trx, ctx.business_id, ctx.user_id, input.conversationId, input.message);
    const history = await loadRecentMessages(trx, conversation.id);
    await insertMessage(trx, conversation.id, { role: 'user', content: input.message });

    const intent = await classifyIntent(input.message, history, deps.client);

    if (intent === 'query') {
      const { reply, data, sqlQuery } = await handleQuery(db, ctx.business_id, input.message, history, deps.client);
      await insertMessage(trx, conversation.id, { role: 'assistant', content: reply, sqlQuery });
      return { reply, conversationId: conversation.id, data };
    }

    if (intent === 'action') {
      const { action, note } = await buildActionPayload(db, ctx.business_id, [...history, { role: 'user', content: input.message }], deps.client);
      const reply = action
        ? `I've prepared a ${action.type.replace('_', ' ')} for you to review.${note ? ` Note: ${note}` : ''}`
        : `I couldn't put together a transaction from that${note ? ` — ${note}` : ''}. Try giving me more detail (amount, date, accounts involved).`;
      await insertMessage(trx, conversation.id, { role: 'assistant', content: reply, ...(action ? { actionPayload: action } : {}) });
      return { reply, conversationId: conversation.id, ...(action ? { action } : {}) };
    }

    if (intent === 'insight') {
      const reply = await handleInsight(db, ctx.business_id, deps.client);
      await insertMessage(trx, conversation.id, { role: 'assistant', content: reply });
      return { reply, conversationId: conversation.id };
    }

    // help
    const reply = await handleHelp(input.message, history, deps.client);
    await insertMessage(trx, conversation.id, { role: 'assistant', content: reply });
    return { reply, conversationId: conversation.id };
  });
}
