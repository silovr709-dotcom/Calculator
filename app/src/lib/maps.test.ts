import { describe, expect, it } from 'vitest';
import { addressBook, dayRoute, mapPointUrl, mapRouteUrl, navigatorUrl, normalizeAddress } from './maps';
import type { CalendarEvent, ClientProfile, Project } from '../types';

describe('адреса и карты', () => {
  it('чистит адрес от лишних пробелов', () => {
    expect(normalizeAddress('  ул.  Мира,   5  ')).toBe('ул. Мира, 5');
  });

  it('делает ссылку на точку', () => {
    expect(mapPointUrl('ул. Мира, 5')).toContain('yandex.ru/maps/?text=');
  });

  it('строит маршрут через несколько точек', () => {
    const url = mapRouteUrl(['ул. Мира, 5', 'пр. Ленина, 10']);
    expect(url).toContain('rtext=');
    expect(url).toContain('~');
    expect(url).toContain('rtt=auto');
  });

  it('одна точка — просто поиск, пустой список — карта', () => {
    expect(mapRouteUrl(['ул. Мира, 5'])).toContain('text=');
    expect(mapRouteUrl([])).toBe('https://yandex.ru/maps/');
  });

  it('не дублирует подряд идущие одинаковые адреса', () => {
    const url = mapRouteUrl(['ул. Мира, 5', 'ул. Мира, 5', 'пр. Ленина, 10']);
    expect(url.split('~')).toHaveLength(2);
  });

  it('даёт ссылку в навигатор', () => {
    expect(navigatorUrl('ул. Мира, 5')).toContain('yandexnavi://');
  });

  it('собирает подсказки адресов без повторов', () => {
    const projects = [{ id: 'p1', schedule: { address: 'ул. Мира, 5' } }] as unknown as Project[];
    const clients = [{ id: 'c1', objectAddress: 'ул. мира, 5', deliveryAddress: 'склад, Полевая 2' }] as unknown as ClientProfile[];
    const events = [{ id: 'e1', address: 'пр. Ленина, 10' }] as unknown as CalendarEvent[];
    const book = addressBook(projects, clients, events);
    expect(book).toHaveLength(3);
    expect(book).toContain('пр. Ленина, 10');
  });

  it('точки дня идут по времени', () => {
    const route = dayRoute([
      { address: 'ул. Мира, 5', title: 'Монтаж', time: '14:00' },
      { address: 'пр. Ленина, 10', title: 'Замер', time: '09:30' },
      { address: '', title: 'Без адреса' },
    ]);
    expect(route.map((stop) => stop.title)).toEqual(['Замер', 'Монтаж']);
  });
});
