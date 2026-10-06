import type { EskizImageReplaceMode, EskizProject } from '../lib/eskizPro';
import { eskizImageReplaceScale } from '../lib/eskizPro';

type Props = {
  /** Новое изображение, которое пользователь выбрал/перетащил/вставил. */
  image: EskizProject['image'];
  /** Эскиз, фото которого меняем. */
  project: EskizProject;
  /** Сколько коммуникаций стоит на этом эскизе. */
  communicationCount: number;
  mode: EskizImageReplaceMode;
  onMode: (mode: EskizImageReplaceMode) => void;
  onCancel: () => void;
  onReplace: () => void;
  /** Создать отдельный новый эскиз вместо замены фото. */
  onCreateNew?: () => void;
  createNewLabel?: string;
};

/** Окно замены фото эскиза: разметка сохраняется, меняется только подложка. */
export default function EskizPhotoDialog(props: Props) {
  const { image, project, communicationCount, mode } = props;
  const scale = eskizImageReplaceScale(project.image, image, 'scale');
  const sameSize = project.image.width === image.width && project.image.height === image.height;

  return <div className="modal-back embedded-eskiz-photo-back" onClick={props.onCancel}>
    <div className="modal embedded-eskiz-photo-modal" onClick={(event) => event.stopPropagation()}>
      <header className="modal-head">
        <div>
          <strong>Новое фото эскиза «{project.title}»</strong>
          <small className="muted">Вся разметка остаётся: размеры, сноски, модули, петли и коммуникации.</small>
        </div>
        <button type="button" className="btn tiny ghost" onClick={props.onCancel}>✕</button>
      </header>
      <div className="embedded-eskiz-photo-body">
        <div className="embedded-eskiz-photo-preview">
          <img src={image.dataUrl} alt="Новое фото эскиза" />
          <small className="muted">{image.name} · {image.width}×{image.height}px</small>
        </div>
        <div className="embedded-eskiz-photo-options">
          <div className="embedded-eskiz-photo-compare">
            <span>Было: <b>{project.image.width}×{project.image.height}</b></span>
            <span>Станет: <b>{image.width}×{image.height}</b>{sameSize ? ' · размер совпадает' : ` · масштаб ×${scale.x.toFixed(2)} / ×${scale.y.toFixed(2)}`}</span>
            <span>Разметка: <b>{project.objects.length} объект(ов)</b> · коммуникаций <b>{communicationCount}</b></span>
          </div>
          <label className={mode === 'scale' ? 'embedded-eskiz-photo-choice active' : 'embedded-eskiz-photo-choice'}>
            <input type="radio" name="eskiz-photo-mode" checked={mode === 'scale'} onChange={() => props.onMode('scale')} />
            <span><b>Подогнать разметку под новое фото</b><small>Координаты размеров и сносок пересчитываются пропорционально. Подходит, когда это то же изображение в другом разрешении.</small></span>
          </label>
          <label className={mode === 'keep' ? 'embedded-eskiz-photo-choice active' : 'embedded-eskiz-photo-choice'}>
            <input type="radio" name="eskiz-photo-mode" checked={mode === 'keep'} onChange={() => props.onMode('keep')} />
            <span><b>Оставить разметку на своих местах</b><small>Координаты не меняются. Подходит, когда новое фото того же размера или пометки нужно подвинуть вручную.</small></span>
          </label>
        </div>
      </div>
      <footer className="modal-foot embedded-eskiz-photo-foot">
        {props.onCreateNew && <button type="button" className="btn ghost" onClick={props.onCreateNew}>{props.createNewLabel ?? 'Сделать отдельным эскизом'}</button>}
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={props.onCancel}>Отмена</button>
        <button type="button" className="btn primary" onClick={props.onReplace}>Заменить фото и сохранить разметку</button>
      </footer>
    </div>
  </div>;
}
