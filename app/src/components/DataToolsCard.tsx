// Резервная копия браузера: перенесена с главного экрана в настройки,
// чтобы на ежедневном экране проектов не было служебных действий.
import { useRef } from 'react';
import { downloadFile, makeBackup, restoreBackup } from '../lib/storage';
import { toast } from '../lib/toast';

export default function DataToolsCard() {
  const fileRef = useRef<HTMLInputElement>(null);

  const backup = () => {
    const data = makeBackup();
    downloadFile(`recept-backup-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
    toast.ok('Резервная копия скачана');
  };

  const restore = async (file: File) => {
    if (!confirm('Восстановление заменит проекты, шаблоны и настройки в этом браузере данными из копии. На сервере данные сольются при следующем сохранении. Продолжить?')) return;
    try {
      const message = restoreBackup(await file.text());
      toast.ok(message);
      location.reload();
    } catch (error) {
      toast.error(`Не удалось восстановить копию: ${(error as Error).message}`);
    }
  };

  return (
    <section className="card">
      <h3>Данные и копии</h3>
      <p className="muted small">
        Копия браузера — страховка, если нужно перенести данные на другое устройство без сервера.
        На боевом сайте постоянные копии делаются на сервере в разделе «Сервер».
      </p>
      <div className="system-action-strip">
        <button type="button" className="btn ghost" onClick={backup}>⭳ Скачать копию (JSON)</button>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>⭱ Восстановить из копии…</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restore(file);
          event.target.value = '';
        }}
      />
    </section>
  );
}
