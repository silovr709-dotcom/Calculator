import { describe, expect, it } from 'vitest';
import { decodePunycodeLabel, prettyHost, prettyUrl } from './prettyUrl';

describe('красивые адреса для клиента', () => {
  it('расшифровывает домен .рф', () => {
    expect(prettyHost('xn----itba1bdbcfp1b.xn--p1ai')).toBe('рецепт-про.рф');
  });

  it('не трогает обычные домены', () => {
    expect(prettyHost('u3683615.isp.regruhosting.ru')).toBe('u3683615.isp.regruhosting.ru');
    expect(decodePunycodeLabel('example')).toBe('example');
  });

  it('собирает ссылку на КП целиком', () => {
    expect(prettyUrl('https://xn----itba1bdbcfp1b.xn--p1ai/kp/7b4111e41d60a92b'))
      .toBe('https://рецепт-про.рф/kp/7b4111e41d60a92b');
  });

  it('убирает index.html из адреса', () => {
    expect(prettyUrl('https://xn----itba1bdbcfp1b.xn--p1ai/index.html')).toBe('https://рецепт-про.рф/');
  });

  it('битую строку возвращает как есть', () => {
    expect(prettyUrl('не адрес')).toBe('не адрес');
  });
});
