// Показ всплывающих сообщений: аккуратные плашки вместо системного alert().

import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastMessage } from '../lib/toast';

export default function ToastHost() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setMessages), []);

  useEffect(() => {
    if (messages.length === 0) return;
    const timers = messages.map((message) => window.setTimeout(() => dismissToast(message.id), message.timeout));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    <div className="toast-host no-print" role="status" aria-live="polite">
      {messages.map((message) => (
        <div key={message.id} className={`toast toast-${message.tone}`}>
          <span>{message.text}</span>
          <button type="button" aria-label="Закрыть" onClick={() => dismissToast(message.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
