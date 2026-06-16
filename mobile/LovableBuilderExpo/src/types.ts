export type BuilderFile = {
  path: string;
  content: string;
  language: string;
};

export type BuilderLogEntry = {
  at: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

export type BuilderPreview = {
  mode: 'inline' | 'daytona';
  html?: string;
  url?: string;
  expiresAt?: string;
};

export type BuilderProject = {
  id: string;
  name: string;
  prompt: string;
  stack: string;
  files: BuilderFile[];
  previewHtml: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'generated' | 'sandbox-starting' | 'running' | 'needs-daytona' | 'failed';
  preview: BuilderPreview;
  logs: BuilderLogEntry[];
  sandbox?: {
    configured: boolean;
    id?: string;
    state?: string;
    previewUrl?: string;
    error?: string;
  };
  convex?: {
    configured: boolean;
    ok: boolean;
    error?: string;
  };
};

export type BuilderSession = {
  id: string;
  displayName: string;
  createdAt: string;
};
