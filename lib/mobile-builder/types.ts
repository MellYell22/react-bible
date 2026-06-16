export type BuilderFile = {
  path: string;
  content: string;
  language: 'html' | 'css' | 'javascript' | 'json' | 'markdown' | 'text';
};

export type BuilderLogLevel = 'info' | 'success' | 'warning' | 'error';

export type BuilderLogEntry = {
  at: string;
  level: BuilderLogLevel;
  message: string;
};

export type BuilderStatus =
  | 'draft'
  | 'generated'
  | 'sandbox-starting'
  | 'running'
  | 'needs-daytona'
  | 'failed';

export type BuilderPreview = {
  mode: 'inline' | 'daytona';
  html?: string;
  url?: string;
  expiresAt?: string;
};

export type DaytonaSandboxSummary = {
  configured: boolean;
  id?: string;
  name?: string;
  state?: string;
  target?: string;
  previewUrl?: string;
  error?: string;
};

export type ConvexSyncSummary = {
  configured: boolean;
  ok: boolean;
  error?: string;
};

export type GeneratedWebApp = {
  id: string;
  name: string;
  prompt: string;
  stack: string;
  files: BuilderFile[];
  previewHtml: string;
  summary: string;
};

export type BuilderProject = GeneratedWebApp & {
  createdAt: string;
  updatedAt: string;
  status: BuilderStatus;
  preview: BuilderPreview;
  logs: BuilderLogEntry[];
  sandbox?: DaytonaSandboxSummary;
  convex?: ConvexSyncSummary;
};

export type BuilderSession = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type BuildProjectInput = {
  prompt?: unknown;
  style?: unknown;
  projectId?: unknown;
};
