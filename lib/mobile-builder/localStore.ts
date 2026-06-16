import type { BuilderProject } from './types';

const projects = new Map<string, BuilderProject>();

export function upsertLocalProject(project: BuilderProject): BuilderProject {
  projects.set(project.id, project);
  return project;
}

export function getLocalProject(id: string): BuilderProject | null {
  return projects.get(id) ?? null;
}

export function listLocalProjects(): BuilderProject[] {
  return Array.from(projects.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
