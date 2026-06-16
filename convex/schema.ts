import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const builderFile = v.object({
  path: v.string(),
  content: v.string(),
  language: v.union(
    v.literal('html'),
    v.literal('css'),
    v.literal('javascript'),
    v.literal('json'),
    v.literal('markdown'),
    v.literal('text'),
  ),
});

const builderLogEntry = v.object({
  at: v.string(),
  level: v.union(v.literal('info'), v.literal('success'), v.literal('warning'), v.literal('error')),
  message: v.string(),
});

const builderPreview = v.object({
  mode: v.union(v.literal('inline'), v.literal('daytona')),
  html: v.optional(v.string()),
  url: v.optional(v.string()),
  expiresAt: v.optional(v.string()),
});

const sandboxSummary = v.object({
  configured: v.boolean(),
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  state: v.optional(v.string()),
  target: v.optional(v.string()),
  previewUrl: v.optional(v.string()),
  error: v.optional(v.string()),
});

const convexSummary = v.object({
  configured: v.boolean(),
  ok: v.boolean(),
  error: v.optional(v.string()),
});

export default defineSchema({
  builderProjects: defineTable({
    projectId: v.string(),
    name: v.string(),
    prompt: v.string(),
    stack: v.string(),
    summary: v.string(),
    status: v.union(
      v.literal('draft'),
      v.literal('generated'),
      v.literal('sandbox-starting'),
      v.literal('running'),
      v.literal('needs-daytona'),
      v.literal('failed'),
    ),
    createdAt: v.string(),
    updatedAt: v.string(),
    files: v.array(builderFile),
    previewHtml: v.string(),
    preview: builderPreview,
    logs: v.array(builderLogEntry),
    sandbox: v.optional(sandboxSummary),
    convex: v.optional(convexSummary),
  })
    .index('by_project_id', ['projectId'])
    .index('by_updated_at', ['updatedAt']),
});
