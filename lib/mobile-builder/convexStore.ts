import { ConvexHttpClient } from 'convex/browser';
import type { BuilderProject, ConvexSyncSummary } from './types';

let cachedClient: ConvexHttpClient | null = null;

function getConvexUrl(): string {
  return (
    process.env.CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    ''
  ).trim();
}

function getClient(): ConvexHttpClient | null {
  const url = getConvexUrl();
  if (!url) return null;
  if (!cachedClient) {
    cachedClient = new ConvexHttpClient(url);
  }
  return cachedClient;
}

export function isConvexConfigured(): boolean {
  return Boolean(getConvexUrl());
}

export async function syncProjectToConvex(project: BuilderProject): Promise<ConvexSyncSummary> {
  const client = getClient();
  if (!client) {
    return { configured: false, ok: false, error: 'CONVEX_URL or VITE_CONVEX_URL is not configured.' };
  }

  try {
    await (client as any).mutation('mobileBuilder:upsertProject', { project });
    return { configured: true, ok: true };
  } catch (error: any) {
    return {
      configured: true,
      ok: false,
      error: error?.message || 'Convex sync failed.',
    };
  }
}

export async function listProjectsFromConvex(): Promise<BuilderProject[] | null> {
  const client = getClient();
  if (!client) return null;

  try {
    return await (client as any).query('mobileBuilder:listProjects', {});
  } catch {
    return null;
  }
}

export async function getProjectFromConvex(projectId: string): Promise<BuilderProject | null> {
  const client = getClient();
  if (!client) return null;

  try {
    return await (client as any).query('mobileBuilder:getProject', { projectId });
  } catch {
    return null;
  }
}
