import type { Project } from '../types';

/** Неперсистентная история проекта для быстрого отмены последних изменений. */
export class ProjectHistory {
  private readonly stacks = new Map<string, Project[]>();

  push(project: Project): void {
    const stack = this.stacks.get(project.id) ?? [];
    this.stacks.set(project.id, [...stack, structuredClone(project)].slice(-20));
  }

  canUndo(projectId: string): boolean {
    return (this.stacks.get(projectId)?.length ?? 0) > 0;
  }

  undo(projectId: string): Project | null {
    const stack = this.stacks.get(projectId);
    if (!stack?.length) return null;
    const previous = stack[stack.length - 1];
    const next = stack.slice(0, -1);
    if (next.length) this.stacks.set(projectId, next);
    else this.stacks.delete(projectId);
    return structuredClone(previous);
  }

  clear(projectId: string): void {
    this.stacks.delete(projectId);
  }
}
