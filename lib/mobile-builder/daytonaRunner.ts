import type { BuilderLogEntry, DaytonaSandboxSummary, GeneratedWebApp } from './types';

type DaytonaRunResult = {
  sandbox: DaytonaSandboxSummary;
  logs: BuilderLogEntry[];
};

function log(level: BuilderLogEntry['level'], message: string): BuilderLogEntry {
  return { at: new Date().toISOString(), level, message };
}

function daytonaConfig() {
  return {
    apiKey: (process.env.DAYTONA_API_KEY || '').trim(),
    apiUrl: (process.env.DAYTONA_API_URL || '').trim(),
    target: (process.env.DAYTONA_TARGET || '').trim(),
  };
}

export function isDaytonaConfigured(): boolean {
  return Boolean(daytonaConfig().apiKey);
}

export async function runGeneratedAppInDaytona(app: GeneratedWebApp): Promise<DaytonaRunResult> {
  const config = daytonaConfig();
  const logs: BuilderLogEntry[] = [];

  if (!config.apiKey) {
    return {
      sandbox: {
        configured: false,
        error: 'DAYTONA_API_KEY is not configured. Returning inline preview instead.',
      },
      logs: [log('warning', 'Daytona is not configured, so the app is using an inline local preview.')],
    };
  }

  try {
    const { Daytona } = await import('@daytona/sdk');
    const daytona = new Daytona({
      apiKey: config.apiKey,
      ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
      ...(config.target ? { target: config.target } : {}),
    });

    logs.push(log('info', 'Creating Daytona TypeScript sandbox.'));
    const sandbox = await daytona.create({
      language: 'typescript',
      envVars: { NODE_ENV: 'development' },
      autoStopInterval: 45,
      autoArchiveInterval: 1440,
      autoDeleteInterval: 2880,
      labels: {
        app: 'lovable-mobile-builder',
        project: app.id,
      },
    } as any, { timeout: 90 });

    const remoteRoot = `lovable-mobile-builder-${app.id}`;
    await sandbox.process.executeCommand(`rm -rf ${remoteRoot} && mkdir -p ${remoteRoot}`, undefined, {}, 20);

    logs.push(log('info', `Uploading ${app.files.length} generated files.`));
    await sandbox.fs.uploadFiles(
      app.files.map((file) => ({
        source: Buffer.from(file.content, 'utf8'),
        destination: `${remoteRoot}/${file.path}`,
      })),
      120,
    );

    logs.push(log('info', 'Starting generated web app preview server.'));
    const startResult = await sandbox.process.executeCommand(
      `sh -lc "cd ${remoteRoot} && nohup node server.mjs > /tmp/${remoteRoot}.log 2>&1 &"`,
      undefined,
      {},
      20,
    );

    if (startResult.exitCode !== 0) {
      logs.push(log('error', startResult.result || 'Preview server failed to start.'));
      return {
        sandbox: {
          configured: true,
          id: sandbox.id,
          name: sandbox.name,
          state: String(sandbox.state || 'unknown'),
          target: sandbox.target,
          error: startResult.result || 'Preview server failed to start.',
        },
        logs,
      };
    }

    await sandbox.process.executeCommand('node -e "fetch(\'http://127.0.0.1:5173\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"', undefined, {}, 20);

    const signedPreview = await sandbox.getSignedPreviewUrl(5173, 3600);
    logs.push(log('success', 'Daytona preview is live.'));

    return {
      sandbox: {
        configured: true,
        id: sandbox.id,
        name: sandbox.name,
        state: String(sandbox.state || 'started'),
        target: sandbox.target,
        previewUrl: signedPreview.url,
      },
      logs,
    };
  } catch (error: any) {
    return {
      sandbox: {
        configured: true,
        error: error?.message || 'Daytona sandbox failed.',
      },
      logs: [
        ...logs,
        log('error', error?.message || 'Daytona sandbox failed.'),
      ],
    };
  }
}
