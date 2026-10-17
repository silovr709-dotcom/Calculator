import { describe, expect, it, beforeEach, vi } from 'vitest';
import { dismissToast, subscribeToasts, toast } from './toast';

describe('всплывающие сообщения', () => {
  beforeEach(() => toast.clear());

  it('добавляет сообщение и сообщает подписчику', () => {
    const seen = vi.fn();
    const stop = subscribeToasts(seen);
    toast.ok('Готово');
    expect(toast.list()).toHaveLength(1);
    expect(toast.list()[0]).toMatchObject({ text: 'Готово', tone: 'ok' });
    expect(seen).toHaveBeenCalled();
    stop();
  });

  it('ошибка живёт дольше обычного сообщения', () => {
    toast.ok('Готово');
    toast.error('Не вышло');
    const [ok, error] = toast.list();
    expect(error.timeout).toBeGreaterThan(ok.timeout);
  });

  it('закрывает сообщение по кнопке', () => {
    const id = toast.info('Сообщение');
    dismissToast(id);
    expect(toast.list()).toHaveLength(0);
  });

  it('не копит больше пяти плашек', () => {
    for (let index = 0; index < 8; index += 1) toast.info(`Сообщение ${index}`);
    expect(toast.list()).toHaveLength(5);
    expect(toast.list()[0].text).toBe('Сообщение 3');
  });

  it('после отписки подписчик молчит', () => {
    const seen = vi.fn();
    const stop = subscribeToasts(seen);
    stop();
    seen.mockClear();
    toast.ok('Ещё одно');
    expect(seen).not.toHaveBeenCalled();
  });
});
