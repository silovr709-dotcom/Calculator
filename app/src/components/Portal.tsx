import { useEffect, useState, type ReactNode, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

function createHost(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.className = 'overlay-portal';
  return el;
}

/**
 * Рендерит оверлеи (модальные окна, полноэкранные попапы) прямо в <body>.
 *
 * Зачем: карточки, панели и шапки используют backdrop-filter и transform.
 * Любой такой предок становится containing block для position: fixed, поэтому
 * модальное окно, отрисованное внутри карточки, позиционируется и обрезается
 * по этой карточке — визуально «наезжает» на соседние разделы вместо того,
 * чтобы честно перекрыть экран. Портал в body убирает эту зависимость.
 */
export default function Portal(props: { children: ReactNode }) {
  const [host] = useState(createHost);

  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [host]);

  if (!host) return null;
  return createPortal(props.children, host);
}

/**
 * Полноэкранная подложка модального окна: всегда поверх всего приложения,
 * независимо от того, из какой карточки её открыли.
 */
export function Overlay(props: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const { children, ...rest } = props;
  return <Portal><div {...rest}>{children}</div></Portal>;
}
