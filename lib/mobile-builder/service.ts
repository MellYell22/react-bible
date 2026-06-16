import { generateWebApp } from './generator';
import { getLocalProject, listLocalProjects, upsertLocalProject } from './localStore';
import { getProjectFromConvex, isConvexConfigured, listProjectsFromConvex, syncProjectToConvex } from './convexStore';
import { isDaytonaConfigured, runGeneratedAppInDaytona } from './daytonaRunner';
import type {
  BuilderLogEntry,
  BuilderProject,
  BuilderSession,
  BuildProjectInput,
} from './types';

const SINGLE_USER_SESSION_ID = 'aa-designs-single-user';

function now(): string {
  return new Date().toISOString();
}

function log(level: BuilderLogEntry['level'], message: string): BuilderLogEntry {
  return { at: now(), level, message };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function enterMobileBuilder(): Promise<{ session: BuilderSession; integrations: Record<string, boolean> }> {
  return {
    session: {
      id: SINGLE_USER_SESSION_ID,
      displayName: 'AA Designs',
      createdAt: now(),
    },
    integrations: {
      daytonaConfigured: isDaytonaConfigured(),
      convexConfigured: isConvexConfigured(),
    },
  };
}

export async function listBuilderProjects(): Promise<{ projects: BuilderProject[]; source: 'convex' | 'local' }> {
  const convexProjects = await listProjectsFromConvex();
  if (convexProjects) {
    return { projects: convexProjects, source: 'convex' };
  }

  return { projects: listLocalProjects(), source: 'local' };
}

export async function getBuilderProject(projectId: string): Promise<BuilderProject | null> {
  return getLocalProject(projectId) || await getProjectFromConvex(projectId);
}

export async function buildMobileProject(input: BuildProjectInput): Promise<BuilderProject> {
  const prompt = stringValue(input.prompt).trim();
  if (!prompt) {
    throw Object.assign(new Error('Prompt is required.'), { statusCode: 400 });
  }

  const generated = generateWebApp(prompt, stringValue(input.style));
  const createdAt = now();
  let project: BuilderProject = {
    ...generated,
    createdAt,
    updatedAt: createdAt,
    status: 'generated',
    preview: {
      mode: 'inline',
      html: generated.previewHtml,
    },
    logs: [
      log('success', 'Generated a complete static web app from the mobile prompt.'),
    ],
    sandbox: {
      configured: isDaytonaConfigured(),
    },
    convex: {
      configured: isConvexConfigured(),
      ok: false,
    },
  };

  upsertLocalProject(project);

  project = {
    ...project,
    status: isDaytonaConfigured() ? 'sandbox-starting' : 'needs-daytona',
    updatedAt: now(),
    logs: [
      ...project.logs,
      log('info', isDaytonaConfigured() ? 'Sending generated app to Daytona.' : 'Daytona is not configured; inline preview is ready.'),
    ],
  };
  upsertLocalProject(project);

  const daytonaResult = await runGeneratedAppInDaytona(generated);
  const previewUrl = daytonaResult.sandbox.previewUrl;
  project = {
    ...project,
    updatedAt: now(),
    status: previewUrl ? 'running' : daytonaResult.sandbox.configured ? 'failed' : 'needs-daytona',
    preview: previewUrl
      ? {
          mode: 'daytona',
          url: previewUrl,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }
      : project.preview,
    sandbox: daytonaResult.sandbox,
    logs: [
      ...project.logs,
      ...daytonaResult.logs,
    ],
  };

  const convex = await syncProjectToConvex(project);
  project = {
    ...project,
    updatedAt: now(),
    convex,
    logs: [
      ...project.logs,
      log(convex.ok ? 'success' : 'warning', convex.ok ? 'Project synced to Convex.' : 'Convex sync did not complete; project kept in the local store.'),
    ],
  };

  upsertLocalProject(project);
  return project;
}
