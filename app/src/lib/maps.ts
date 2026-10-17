// Адреса и карты: ссылки на точку и на маршрут дня, а также «записная книжка»
// адресов — подсказки из клиентов, заказов и дел календаря.

import type { CalendarEvent, ClientProfile, Project } from '../types';

export function normalizeAddress(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Ссылка на точку в Яндекс.Картах. */
export function mapPointUrl(address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(normalizeAddress(address))}`;
}

/** Ссылка на маршрут через все точки подряд: Яндекс сам построит дорогу. */
export function mapRouteUrl(points: string[], from?: string): string {
  const stops = [from, ...points].filter((item): item is string => Boolean(item && item.trim()))
    .map(normalizeAddress);
  const unique = stops.filter((item, index) => index === 0 || item !== stops[index - 1]);
  if (unique.length === 0) return 'https://yandex.ru/maps/';
  if (unique.length === 1) return mapPointUrl(unique[0]);
  return `https://yandex.ru/maps/?rtext=${unique.map((item) => encodeURIComponent(item)).join('~')}&rtt=auto`;
}

/** Ссылка на навигатор для телефона: открывает приложение, если оно есть. */
export function navigatorUrl(address: string): string {
  return `yandexnavi://map_search?text=${encodeURIComponent(normalizeAddress(address))}`;
}

/** Все адреса, которые уже встречались: подсказки при вводе. */
export function addressBook(projects: Project[], clients: ClientProfile[], events: CalendarEvent[]): string[] {
  const seen = new Map<string, string>();
  const add = (value?: string | null) => {
    const address = normalizeAddress(String(value ?? ''));
    if (address.length < 5) return;
    const key = address.toLocaleLowerCase('ru-RU');
    if (!seen.has(key)) seen.set(key, address);
  };

  for (const client of clients) {
    add(client.objectAddress);
    add(client.deliveryAddress);
  }
  for (const project of projects) {
    add(project.schedule?.address);
    add(project.clientOffer?.clientAddress);
  }
  for (const event of events) add(event.address);

  return Array.from(seen.values()).sort((left, right) => left.localeCompare(right, 'ru'));
}

export interface RouteStop {
  address: string;
  title: string;
  time?: string;
}

/** Точки дня по порядку времени — из них строится маршрут. */
export function dayRoute(stops: RouteStop[]): RouteStop[] {
  return [...stops]
    .filter((stop) => normalizeAddress(stop.address).length >= 5)
    .sort((left, right) => (left.time ?? '99:99').localeCompare(right.time ?? '99:99'));
}
