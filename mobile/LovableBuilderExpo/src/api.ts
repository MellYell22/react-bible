import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { BuilderProject, BuilderSession } from './types';

type EnterResponse = {
  session: BuilderSession;
  integrations: Record<string, boolean>;
};

type BuildResponse = {
  project: BuilderProject;
};

type ProjectsResponse = {
  projects: BuilderProject[];
  source: string;
};

const configuredBaseUrl =
  process.env.EXPO_PUBLIC_BUILDER_API_BASE_URL ||
  (Constants.expoConfig?.extra?.builderApiBaseUrl as string | undefined) ||
  'http://localhost:3000';

function baseUrl() {
  if (Platform.OS === 'android' && configuredBaseUrl.includes('localhost')) {
    return configuredBaseUrl.replace('localhost', '10.0.2.2');
  }
  return configuredBaseUrl.replace(/\/$/, '');
}

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl()}/api/mobile-builder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Builder API failed with ${response.status}`);
  }

  return data as T;
}

export async function enterBuilder(): Promise<EnterResponse> {
  return request<EnterResponse>({ action: 'enter' });
}

export async function buildProject(prompt: string, style: string): Promise<BuilderProject> {
  const response = await request<BuildResponse>({ action: 'build', prompt, style });
  return response.project;
}

export async function listProjects(): Promise<BuilderProject[]> {
  const response = await fetch(`${baseUrl()}/api/mobile-builder?action=projects`);
  const data = (await response.json()) as ProjectsResponse | { error?: string };
  if (!response.ok) {
    throw new Error('error' in data ? data.error : `Builder API failed with ${response.status}`);
  }
  return (data as ProjectsResponse).projects;
}

export function getBuilderApiBaseUrl() {
  return baseUrl();
}
