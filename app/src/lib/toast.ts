// Всплывающие сообщения вместо системных окон alert().
// Простая шина: любой модуль зовёт toast.ok(...), интерфейс показывает плашку.

export type ToastTone = 'ok' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  /** Сколько миллисекунд держать на экране. */
  timeout: number;
}

type Listener = (messages: ToastMessage[]) => void;

let messages: ToastMessage[] = [];
let listeners: Listener[] = [];
let counter = 0;

function emit(): void {
  for (const listener of listeners) listener(messages);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener);
  listener(messages);
  return () => {
    listeners = listeners.filter((item) => item !== listener);
  };
}

export function dismissToast(id: number): void {
  messages = messages.filter((item) => item.id !== id);
  emit();
}

function push(text: string, tone: ToastTone, timeout: number): number {
  counter += 1;
  const message: ToastMessage = { id: counter, text, tone, timeout };
  // Больше пяти плашек на экране не держим: старые уходят.
  messages = [...messages, message].slice(-5);
  emit();
  return message.id;
}

export const toast = {
  ok: (text: string) => push(text, 'ok', 3500),
  info: (text: string) => push(text, 'info', 4000),
  error: (text: string) => push(text, 'error', 7000),
  /** Для тестов и выхода из приложения. */
  clear: () => { messages = []; emit(); },
  list: () => messages,
};
