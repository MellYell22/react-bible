import {
  buildMobileProject,
  enterMobileBuilder,
  getBuilderProject,
  listBuilderProjects,
} from './service';

type BuilderHttpRequest = {
  method?: string;
  url?: string;
  body?: any;
};

type BuilderHttpResponse = {
  status: number;
  body: Record<string, unknown>;
};

function actionFrom(req: BuilderHttpRequest): string {
  const url = new URL(req.url || '/api/mobile-builder', 'http://localhost');
  return String(req.body?.action || url.searchParams.get('action') || '').trim();
}

export async function handleMobileBuilderHttp(req: BuilderHttpRequest): Promise<BuilderHttpResponse> {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/api/mobile-builder', 'http://localhost');
    const action = actionFrom(req);

    if (method === 'GET' && (!action || action === 'health')) {
      return {
        status: 200,
        body: {
          status: 'ok',
          service: 'mobile-builder',
        },
      };
    }

    if (method === 'POST' && action === 'enter') {
      return { status: 200, body: await enterMobileBuilder() };
    }

    if (method === 'POST' && action === 'build') {
      return { status: 200, body: { project: await buildMobileProject(req.body || {}) } };
    }

    if (method === 'GET' && action === 'projects') {
      return { status: 200, body: await listBuilderProjects() };
    }

    if (method === 'GET' && action === 'project') {
      const projectId = url.searchParams.get('projectId') || '';
      const project = projectId ? await getBuilderProject(projectId) : null;
      if (!project) {
        return { status: 404, body: { error: 'Project not found.' } };
      }
      return { status: 200, body: { project } };
    }

    return {
      status: 404,
      body: {
        error: `Unsupported mobile builder request: ${method} ${action || 'no-action'}`,
      },
    };
  } catch (error: any) {
    return {
      status: Number(error?.statusCode || 500),
      body: {
        error: error?.message || 'Mobile builder request failed.',
      },
    };
  }
}
