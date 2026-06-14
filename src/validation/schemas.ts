// @ts-nocheck
import { z } from 'zod';

export const AnyRecordSchema = z.record(z.string(), z.any());

export const CharacterCardInputSchema = AnyRecordSchema;

export const CreateSessionRequestSchema = z.object({
  characterCard: CharacterCardInputSchema,
  userName: z.string().min(1).optional(),
  playerPersona: z.string().optional(),
  collection: z.string().min(1).optional(),
  includeGreeting: z.boolean().optional()
}).passthrough();

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1),
  includePrompt: z.boolean().optional(),
  options: AnyRecordSchema.optional()
}).passthrough();

export const RagDocumentRequestSchema = z.object({
  collection: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  text: z.string().min(1),
  metadata: AnyRecordSchema.optional()
}).passthrough();

export const RagSearchRequestSchema = z.object({
  collection: z.string().min(1).optional(),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
  minScore: z.number().optional(),
  filter: AnyRecordSchema.optional()
}).passthrough();

export const WorldInfoActivationRequestSchema = z.object({
  worldBook: z.any(),
  messages: z.array(z.object({
    role: z.string().optional(),
    content: z.string(),
    name: z.string().optional()
  }).passthrough()),
  options: AnyRecordSchema.optional()
}).passthrough();

export const ToolDefinitionRequestSchema = AnyRecordSchema;

export const ToolPluginRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  tools: z.array(ToolDefinitionRequestSchema).optional(),
  metadata: AnyRecordSchema.optional()
}).passthrough();

export const ToolPluginPatchRequestSchema = ToolPluginRequestSchema.partial().passthrough();

export const ToolExecutionRequestSchema = z.object({
  input: z.any().default({}),
  context: AnyRecordSchema.optional()
}).passthrough();

export function parseWithSchema(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error = new Error(result.error.issues.map(formatIssue).join('; '));
  error.statusCode = 400;
  error.name = 'ValidationError';
  throw error;
}

function formatIssue(issue) {
  const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
  return `${path}: ${issue.message}`;
}
