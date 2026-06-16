import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const projectValue = v.object({
  id: v.string(),
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
  previewHtml: v.string(),
  files: v.array(v.object({
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
  })),
  preview: v.object({
    mode: v.union(v.literal('inline'), v.literal('daytona')),
    html: v.optional(v.string()),
    url: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
  }),
  logs: v.array(v.object({
    at: v.string(),
    level: v.union(v.literal('info'), v.literal('success'), v.literal('warning'), v.literal('error')),
    message: v.string(),
  })),
  sandbox: v.optional(v.object({
    configured: v.boolean(),
    id: v.optional(v.string()),
    name: v.optional(v.string()),
    state: v.optional(v.string()),
    target: v.optional(v.string()),
    previewUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  })),
  convex: v.optional(v.object({
    configured: v.boolean(),
    ok: v.boolean(),
    error: v.optional(v.string()),
  })),
});

function toClientProject(doc: any) {
  return {
    id: doc.projectId,
    name: doc.name,
    prompt: doc.prompt,
    stack: doc.stack,
    summary: doc.summary,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    files: doc.files,
    previewHtml: doc.previewHtml,
    preview: doc.preview,
    logs: doc.logs,
    sandbox: doc.sandbox,
    convex: doc.convex,
  };
}

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db
      .query('builderProjects')
      .withIndex('by_updated_at')
      .order('desc')
      .take(25);

    return projects.map(toClientProject);
  },
});

export const getProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query('builderProjects')
      .withIndex('by_project_id', (q) => q.eq('projectId', args.projectId))
      .unique();

    return project ? toClientProject(project) : null;
  },
});

export const upsertProject = mutation({
  args: { project: projectValue },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('builderProjects')
      .withIndex('by_project_id', (q) => q.eq('projectId', args.project.id))
      .unique();

    const doc = {
      projectId: args.project.id,
      name: args.project.name,
      prompt: args.project.prompt,
      stack: args.project.stack,
      summary: args.project.summary,
      status: args.project.status,
      createdAt: args.project.createdAt,
      updatedAt: args.project.updatedAt,
      files: args.project.files,
      previewHtml: args.project.previewHtml,
      preview: args.project.preview,
      logs: args.project.logs,
      sandbox: args.project.sandbox,
      convex: args.project.convex,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert('builderProjects', doc);
  },
});
