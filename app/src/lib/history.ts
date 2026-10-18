import type { Project } from '../types';

export interface ProjectHistoryOptions {
  /** Минимальная пауза между снимками одного проекта, мс. */
  throttleMs?: number;
  /** Часы для тестов. */
  now?: () => number;
}

/**
 * Неперсистентная история проекта для быстрого отмены последних изменений.
 *
 * Правки приходят потоком (каждое нажатие клавиши — отдельное изменение), поэтому
 * снимки троттлятся: на серию правок подряд запоминается только её начало.
 * Так undo возвращает состояние до начала правки, а телефон не тратит время
 * на глубокое копирование проекта на каждый символ.
 */
export class ProjectHistory {
  private readonly stacks = new Map<string, Project[]>();
  private readonly lastPushAt = new Map<string, number>();
  private readonly throttleMs: number;
  private readonly now: () => number;

  constructor(options: ProjectHistoryOptions = {}) {
    this.throttleMs = options.throttleMs ?? 1200;
    this.now = options.now ?? Date.now;
  }

  push(project: Project): void {
    const now = this.now();
    const last = this.lastPushAt.get(project.id);
    this.lastPushAt.set(project.id, now);
    if (last != null && now - last < this.throttleMs) return;
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
    this.lastPushAt.delete(projectId);
  }
}
