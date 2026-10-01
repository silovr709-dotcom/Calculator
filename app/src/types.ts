// ---------- Прайс (нормализованная база, создаётся tools/extract_pricebook.py) ----------

export type PriceKind = 'fixed' | 'percent' | 'surcharge' | 'unavailable' | 'text' | 'empty';
export type PriceBasis = 'unit' | 'm2' | 'lm' | 'sheet' | 'percent_of_base' | null;

export interface PriceItem {
  id: string;
  category: string;
  subcategory: string | null;
  name: string;
  article: string | null;
  unit: string | null;
  priceKind: PriceKind;
  price: number | null;
  priceRaw: string | null;
  priceBasis: PriceBasis;
  attrs: Record<string, string>;
  note: string | null;
  group: string | null; // mdf_pvh | emal | plastic | tss | glass | ms | souz | slotex | arkobaleno | gola
  source: { sheet: string; row: number };
}

export interface PricebookIssue {
  kind: string;
  sheet: string;
  row: number;
  detail: string;
}

export interface Pricebook {
  meta: {
    id: string;
    name: string;
    supplier: string;
    priceYear: number;
    sourceFile: string;
    importedAt: string;
    itemCount: number;
    categories: string[];
    stats: { byCategory: Record<string, { count: number; priced: number }>; byUnit: Record<string, number> };
  };
  items: PriceItem[];
  refs: Record<string, unknown[]>;
  notes: Record<string, string[]>;
  issues: PricebookIssue[];
}

// ---------- Сводные группы для итогов и наценки ----------

export const SUMMARY_GROUPS = [
  'Корпуса',
  'Фасады',
  'Столешницы',
  'Фурнитура',
  'Ручки',
  'GOLA / профили',
  'Мойки и смесители',
  'Электрика',
  'Цоколь и опоры',
  'Работы и упаковка',
  'Прочее',
] as const;
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

// ---------- Проект ----------

export interface LineParams {
  // для basis=m2: размеры одной детали, мм
  widthMm?: number;
  heightMm?: number;
  // для basis=m2 без размеров: площадь напрямую, м²
  areaM2?: number;
  // для basis=lm: длина одной детали, мм
  lengthMm?: number;
}

export interface ProjectLine {
  id: string;
  // снимок позиции прайса на момент добавления:
  itemId: string;
  pricebookId: string;
  category: string;       // категория прайса
  group: SummaryGroup;    // сводная группа (можно переопределить)
  name: string;
  article: string | null;
  unit: string | null;
  priceKind: PriceKind;
  price: number | null;   // снимок цены
  priceBasis: PriceBasis;
  priceGroup: string | null; // group из прайса (emal, ms...)
  qty: number;
  params: LineParams;
  baseLineId?: string | null; // для процентных строк — база
  note?: string;
}

export interface ExtraExpense {
  id: string;
  name: string;
  amount: number | null; // null = не задано (не придумываем)
  /** Процент от клиентской суммы проекта по материалам (до расходов и правила эмали — от costLines→client).
   *  Если задан, фиксированная сумма amount игнорируется. Отсутствует в старых проектах = фиксированная сумма. */
  percent?: number | null;
  toClient: boolean;     // показывать в клиентской цене
}

/** Расшифровка одного доп. расхода в итогах (сборка/доставка/процентные). */
export interface ExtraExpenseDetail {
  id?: string;           // id расхода из настроек (для связи с редактором)
  name: string;
  amount: number;        // рассчитанная сумма, ₽
  percent: number | null;// если расход процентный — сам процент
  toClient: boolean;
}

export type ClientPriceRounding = 1 | 10 | 100 | 1000;

export interface ProjectSettings {
  markupBasePct: number | null;               // null = не задано
  markupByGroup: Partial<Record<SummaryGroup, number | null>>;
  extraExpenses: ExtraExpense[];
  applyEmalRule: boolean;                     // правило «эмаль < 1 кв.м +30%» (на сумму проекта)
  assemblyCost: number | null;
  deliveryCost: number | null;
  /** Шаг округления клиентской цены вверх. Отсутствует в старых проектах = 1 ₽. */
  clientRounding?: ClientPriceRounding;
}

export type WizardStepId = 'data' | 'shape' | 'materials' | 'modules' | 'review' | 'total';

export type ClientOfferPresentationMode = 'brief' | 'detailed' | 'technical';

export interface ClientOfferSettings {
  validUntil?: string;
  paymentTerms?: string;
  installation?: string;
  delivery?: string;
  notes?: string;
  /** Режим детализации клиентского КП: короткое письмо, рабочая детализация или техническое приложение. */
  presentationMode?: ClientOfferPresentationMode;
  /** false — скрыть суммы внутри комплектации и оставить только итоги модулей/проекта. */
  showDetailPrices?: boolean;
}

/** Снимок КП для истории согласований: не хранит весь проект, только контрольные цифры и контекст. */
export interface ClientOfferSnapshot {
  id: string;
  createdAt: string;
  name: string;
  clientTotal: number;
  costTotal: number;
  modulesCount: number;
  linesCount: number;
  issuesCount: number;
  variantId?: string | null;
  note?: string;
}

export type OrderWorkflowStatus =
  | 'draft'
  | 'calculating'
  | 'offerSent'
  | 'clientThinking'
  | 'approved'
  | 'techCheck'
  | 'factorySent'
  | 'production'
  | 'ready'
  | 'delivered'
  | 'rejected';

export interface OrderWorkflow {
  status: OrderWorkflowStatus;
  nextAction?: string;
  nextContactAt?: string;
  managerComment?: string;
  updatedAt?: string;
}

export interface MeasurementWall {
  id: string;
  name: string;
  lengthMm: number | null;
  note?: string;
}

export interface MeasurementOpening {
  id: string;
  kind: 'window' | 'door' | 'other';
  name: string;
  wallId?: string;
  offsetMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  sillHeightMm?: number | null;
  note?: string;
}

export interface MeasurementCommunication {
  id: string;
  kind: 'water' | 'gas' | 'electricity' | 'ventilation' | 'other';
  name: string;
  wallId?: string;
  offsetMm: number | null;
  heightMm: number | null;
  note?: string;
}

export interface MeasurementData {
  roomHeightMm: number | null;
  walls: MeasurementWall[];
  openings: MeasurementOpening[];
  communications: MeasurementCommunication[];
  photos: ProjectPhoto[];
  notes: string;
  updatedAt: string;
}

export interface CalculationVariant {
  id: string;
  name: string;
  description: string;
  /** Перекрытия настроек проекта для всех модулей. */
  defaults: ModuleDefaults;
  /** Явные значения слотов варианта сильнее ручной комплектации модуля. */
  slotOverrides: Partial<Record<SlotKey, string | null>>;
  /** Переопределение столешницы/стеновой панели (позиции project.lines — не слоты модулей).
   *  Отсутствует в старых проектах = используются позиции основного проекта. */
  surfaceOverrides?: Partial<Record<'worktop' | 'wallPanel', string | null>>;
  settings: ProjectSettings;
  clientVisible: boolean;
}

/** Фото/эскиз проекта (хранится в самом проекте, сжимается при загрузке) */
export type MeasurementPhotoAnnotationType = 'dimension' | 'marker';
export type MeasurementPhotoAccuracy = 'calibrated' | 'preliminary';

/** Известный отрезок на фотографии, по которому рассчитывается масштаб. */
export interface MeasurementPhotoCalibration {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthMm: number;
}

export interface MeasurementPhotoAnnotation {
  id: string;
  type: MeasurementPhotoAnnotationType;
  /** Координаты в процентах от ширины/высоты фотографии, чтобы разметка не ломалась на телефоне. */
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  label: string;
  valueMm?: number | null;
  /** Без калибровки размер считается предварительным, даже если введён вручную. */
  accuracy?: MeasurementPhotoAccuracy;
}

export interface ProjectPhoto {
  id: string;
  name: string;
  dataUrl: string; // сжатый JPEG (data:image/jpeg;base64,...)
  addedAt: string;
  showToClient: boolean; // включать в клиентскую версию (КП)
  /** Калибровка масштаба; отсутствие поля совместимо со старыми фото. */
  measurementCalibration?: MeasurementPhotoCalibration;
  /** Разметка используется в фото замера; отсутствие поля совместимо со старыми фото. */
  measurementAnnotations?: MeasurementPhotoAnnotation[];
}

/** Внешний вид и включение автоматически построенного эскиза кухни. */
export type KitchenSketchStyleId = 'white-oak' | 'graphite-marble' | 'cashmere-stone' | 'scandi-wotan' | 'emerald-gold';

/** Планировка кухни: прямая, Г-образная (левая + задняя стены), П-образная (три стены). */
export type KitchenLayoutShape = 'straight' | 'l' | 'u';

/** Стена, вдоль которой стоит модуль. */
export type KitchenWall = 'left' | 'back' | 'right';

/** Вид эскиза: фасадные развёртки стен, план сверху или объёмный 3D-вид. */
export type KitchenSketchView = 'elevation' | 'plan' | '3d';

export interface KitchenSketchSettings {
  styleId?: KitchenSketchStyleId;
  /** legacy-настройка старого автоэскиза; сам автоэскиз удалён из интерфейса. */
  showInClient?: boolean;
  /** legacy-настройка старого автоэскиза; вывод размеров теперь идёт через внешний Эскиз PRO. */
  showDimensionsInClient?: boolean;
  /** Планировка кухни; отсутствие поля = прямая (совместимость со старыми проектами). */
  shape?: KitchenLayoutShape;
  /** Вид эскиза по умолчанию; отсутствие поля = фасадные развёртки. */
  view?: KitchenSketchView;
  /** Измеренные длины стен, мм. Используются только для подсказок и планировщика. */
  wallLengthsMm?: Partial<Record<KitchenWall, number | null>>;
  /** Измеренная высота помещения, мм. */
  roomHeightMm?: number | null;
}

export interface EskizProSnapshot {
  id: string;
  title: string;
  updatedAt: string;
  /** Полный JSON проекта внешнего инструмента Эскиз PRO. Храним как snapshot, чтобы КП/экспорт проекта не зависели от IndexedDB браузера. */
  project: unknown;
}

export type EskizCommunicationKind =
  | 'socket'
  | 'switch'
  | 'electricOutput'
  | 'waterCold'
  | 'waterHot'
  | 'sewer'
  | 'gas'
  | 'ventilation'
  | 'hood'
  | 'other';

export type EskizCommunicationAnchorKind = 'left' | 'right' | 'top' | 'bottom' | 'custom';

export interface EskizCommunicationDistance {
  id: string;
  label: string;
  anchor: EskizCommunicationAnchorKind;
  valueMm: number | null;
  /** Для anchor='custom' — точка на snapshot Эскиз PRO в координатах исходного изображения. */
  anchorX?: number | null;
  anchorY?: number | null;
  note?: string;
}

export interface EskizCommunicationMarker {
  id: string;
  /** id snapshot Эскиз PRO, к которому относится отметка. */
  eskizId: string;
  kind: EskizCommunicationKind;
  name: string;
  /** Координаты на snapshot Эскиз PRO в пикселях исходного изображения. */
  x: number;
  y: number;
  widthMm?: number | null;
  heightMm?: number | null;
  diameterMm?: number | null;
  depthMm?: number | null;
  /** Высота центра/низа коммуникации от пола, если известна. */
  elevationMm?: number | null;
  distances?: EskizCommunicationDistance[];
  note?: string;
  /** false — техническая отметка остаётся только внутри проекта и не попадает в КП. */
  showInClient?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface EskizProIntegration {
  linkedProjectIds?: string[];
  activeProjectId?: string | null;
  /** false — не показывать связанные эскизы в клиентском КП; отсутствие поля = показывать. */
  showInClient?: boolean;
  /** active — вставлять в КП только главный эскиз; all — вставлять все связанные snapshot. */
  clientMode?: 'active' | 'all';
  /** Как показывать маркеры модулей на выгружаемом/клиентском эскизе: полные плашки, компактные точки или скрыть. */
  moduleMarkerMode?: 'full' | 'compact' | 'hidden';
  /** Связка: ключ маркера Эскиз PRO (`eskizId:objectId`) → id KitchenModule в расчёте. */
  moduleBindings?: Record<string, string>;
  /** Коммуникации, нанесённые поверх snapshot: розетки, вода, канализация, газ, вентиляция и расстояния до точек. */
  communications?: EskizCommunicationMarker[];
  snapshots?: EskizProSnapshot[];
}

export interface FactoryBlankSketchSettings {
  /** false — не вставлять Эскиз PRO в официальный Excel-бланк фабрики. Отсутствие поля = вставлять, если есть snapshot. */
  enabled?: boolean;
  /** Какой snapshot Эскиз PRO вставлять в левую область бланка; null/undefined = активный или последний. */
  snapshotId?: string | null;
  /** Режим маркеров именно для фабричного Excel: можно сделать компактно или совсем убрать. */
  moduleMarkerMode?: 'full' | 'compact' | 'hidden';
  /** false — не добавлять в картинку фабричного бланка розетки/воду/газ/вентиляцию. */
  showCommunications?: boolean;
  /** false — не добавлять отдельный лист с крупным эскизом, расшифровкой маркеров и проверками. Отсутствие поля = добавлять. */
  includeTechSheet?: boolean;
}

export type KitchenChecklistKey = 'plinth' | 'baseboard' | 'worktop' | 'wallPanel';

export interface KitchenChecklistItem {
  key: KitchenChecklistKey;
  label: string;
  included: boolean;
  lineIds: string[];
  /** Отсутствие позиции явно подтверждено пользователем (кухня без неё — осознанное решение). */
  confirmed: boolean;
}

export interface KitchenChecklistResult {
  items: KitchenChecklistItem[];
  missing: KitchenChecklistItem[];
}

export interface Project {
  id: string;
  name: string;
  client: string;
  date: string;       // ISO date
  comment: string;
  status: 'draft' | 'sent' | 'approved' | 'archived';
  pricebookId: string;
  pricebookName: string;
  lines: ProjectLine[];
  settings: ProjectSettings;
  // «Расчёт проекта»: структурированные позиции кухни (модули) и параметры по умолчанию
  modules?: KitchenModule[];
  moduleDefaults?: ModuleDefaults;
  photos?: ProjectPhoto[];
  /** Технические параметры планировки/стен для проверки и планировщика. Старый автоэскиз удалён из UI. */
  sketch?: KitchenSketchSettings;
  /** Связь с внешним инструментом Эскиз PRO: https://silovr709-dotcom.github.io/ESCIZ/ */
  eskizPro?: EskizProIntegration;
  /** Режим открытия проекта: мастер или привычные вкладки. */
  wizardMode?: 'wizard' | 'advanced';
  wizardStep?: WizardStepId;
  variants?: CalculationVariant[];
  selectedVariantId?: string;
  clientOffer?: ClientOfferSettings;
  /** История сохранённых версий КП для сравнения и повторных согласований. */
  clientOfferSnapshots?: ClientOfferSnapshot[];
  /** Рабочий статус менеджера: следующий контакт, передача технологу/фабрике и комментарии. */
  orderWorkflow?: OrderWorkflow;
  measurement?: MeasurementData;
  /** Подтверждённые пользователем «сознательные отсутствия» обязательных элементов кухни
   *  (например, кухня без стеновой панели и без плинтуса). Зафиксированное подтверждение
   *  снимает ошибку готовности, но остаётся видимым в чек-листе. */
  checklistConfirmations?: KitchenChecklistKey[];
  /** Черновики бланков на фабрику: ключ — id спецификации бланка, значения — введённые/отредактированные поля.
   *  Значения, совпадающие с автоподстановкой из калькулятора, не хранятся (единый источник — проект). */
  factoryBlankDrafts?: Record<string, Record<string, string>>;
  /** Лист 2 бланка — схема столешницы: детали и виды кромок (по инструкции фабрики). */
  worktopPlan?: WorktopPiece[];
  /** Настройки вставки Эскиз PRO в официальный Excel-бланк фабрики. */
  factoryBlankSketch?: FactoryBlankSketchSettings;
  createdAt: string;
  updatedAt: string;
}

// ---------- Модули («Расчёт проекта») ----------

/** Слоты комплектации модуля. Значение слота — конкретная позиция прайса Висма. */
export type SlotKey = 'body' | 'facade' | 'frame' | 'hinge' | 'drawerSys' | 'lift' | 'handle' | 'shelf' | 'legs';

/**
 * Выбор в слоте:
 * mode='default' — берётся из настроек проекта (меняется вместе с ними);
 * mode='manual'  — задано вручную для этой позиции (сохраняется даже при смене настроек проекта).
 * itemId=null при mode='manual' означает «явно ничего не использовать».
 */
export interface SlotChoice {
  mode: 'default' | 'manual';
  itemId: string | null;
}

export interface FacadePart {
  widthMm: number;
  heightMm: number;
  kind: 'door' | 'drawer' | 'panel';
  /** Источник размера для объяснения пользователю. */
  source?: 'technical' | 'manual';
}

/**
 * Отдельная фасадная деталь со своими размерами: боковина, накладка,
 * фасад холодильника и т.п. Не входит в конструктив модуля и не влияет
 * на техничку фасадов/петель; считается отдельной строкой по своей площади.
 */
export interface ExtraFacadePart {
  widthMm: number;
  heightMm: number;
  kind: 'door' | 'drawer' | 'panel';
  /** Количество деталей на один модуль. */
  qty: number;
  /** Свободное название детали, напр. «Боковина правая». */
  label?: string;
  /** Отдельные детали всегда задаются вручную. */
  source?: 'manual';
}

export type FacadeSpecStatus = 'recommended' | 'applied' | 'manual' | 'outdated';

export interface KitchenModule {
  id: string;
  type: string;            // «Нижний шкаф», «Пенал», … или собственный тип
  name: string;            // подпись, напр. «Низ 800 под мойку»
  qty: number;
  // объективные размеры (задаёт пользователь)
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  // конструкция (задаёт пользователь; система ничего не додумывает)
  facades: number;
  drawers: number;
  shelves: number;
  hinges: number;          // петель на модуль, всего
  handles: number;         // ручек на модуль
  lifts: number;           // подъёмных механизмов на модуль
  /** Опор/ножек на модуль. У новых стоящих модулей — 4 по умолчанию.
   *  Отсутствие поля (старые проекты) = не задано, выдаётся подсказка-предупреждение. */
  legs?: number;
  // размер одного фасада (для старых проектов и обратной совместимости)
  facadeWmm: number | null;
  facadeHmm: number | null;
  /** Точные размеры каждого фасада по техничке фабрики. Необязательное поле для старых проектов. */
  facadeParts?: FacadePart[];
  /** Отдельные фасадные детали со своими размерами (боковины, накладки). Не связаны с конструктивом. */
  extraFacadeParts?: ExtraFacadePart[];
  /** Состояние рекомендации фасадов: старые проекты без поля продолжают работать. */
  facadeSpecStatus?: FacadeSpecStatus;
  /** Состояние рекомендации петель: количество можно оставить ручным. */
  hingeSpecStatus?: FacadeSpecStatus;
  slots: Record<SlotKey, SlotChoice>;
  /**
   * Стена, вдоль которой стоит модуль в эскизе.
   * Отсутствие поля = задняя стена (совместимость со старыми проектами).
   */
  wall?: KitchenWall;
  /** Процентные надбавки прайса (нестандарт +10/30/50%…), считаются от суммы корпуса */
  surcharges?: string[];
  /** Надбавки, применённые через рекомендацию по габаритам; не смешиваются с ручными. */
  automaticSurcharges?: string[];
  /** Коды предупреждений, подтверждённых пользователем для этой позиции. */
  confirmations?: string[];
  note?: string;
}

/** Настройки проекта по умолчанию: itemId позиции прайса на каждый слот (null = не задано) */
export type ModuleDefaults = Partial<Record<SlotKey, string | null>>;

export interface Template {
  id: string;
  name: string;
  comment: string;
  lines: ProjectLine[];
  /** Модули «Позиций кухни» (типовой шкаф или целая кухня) */
  modules?: KitchenModule[];
  moduleDefaults?: ModuleDefaults;
  createdAt: string;
}

// ---------- Итоги ----------

export interface LineCalc {
  lineId: string;
  qtyEffective: number;   // фактический множитель (площадь/длина/шт)
  sum: number | null;     // null, если цена не задана
  clientSum: number | null;
  markupPct: number | null;
  warning?: string;
}

export interface Totals {
  byGroup: Record<string, { cost: number; client: number }>;
  emalAdjustment: { applied: boolean; area: number; amount: number } | null;
  costLines: number;      // сумма позиций (+ правило эмали)
  extraTotal: number;     // сборка + доставка + прочие расходы
  extraDetails?: ExtraExpenseDetail[]; // расшифровка расходов с рассчитанными суммами
  cost: number;           // итого себестоимость
  client: number;         // цена для клиента
  markupRub: number;
  markupPct: number | null;      // средневзвешенная наценка, %
  marginPct: number | null;      // маржинальность = наценка / цена клиента
  unpricedCount: number;  // строк без цены
}

// ---------- База знаний РЕцепта ----------

/** Категории базы знаний. Список открытый — новые категории добавляются без миграций. */
export type WorktopEdgeKind = 'pf' | 'pvc' | 'v' | 'eurozapil' | 'eurostyk';

export interface WorktopPiece {
  id: string;
  name: string;
  lengthMm: number | null;
  widthMm: number | null;
  front: WorktopEdgeKind | null;
  left: WorktopEdgeKind | null;
  right: WorktopEdgeKind | null;
}

export type KbCategory =
  | 'instructions'        // инструкции
  | 'calc-rules'          // правила расчёта
  | 'factories'           // информация по фабрикам
  | 'materials'           // материалы
  | 'facades'             // фасады
  | 'hardware'            // фурнитура
  | 'tech-requirements'   // технические требования
  | 'order-forms'         // правила оформления заказов
  | 'regulations'         // внутренние инструкции РЕцепта
  | 'faq';                // ответы на частые вопросы

/** Статья базы знаний. Самодостаточный документ с метаданными — позже ложится в AI-поиск как чанк. */
export interface KbArticle {
  id: string;
  title: string;
  category: KbCategory;
  tags: string[];
  /** Текст статьи (простой markdown-подобный текст). */
  body: string;
  /** Необязательная ссылка на документ репозитория/файл (документы и рабочие материалы). */
  attachment?: string;
  updatedAt: string; // ISO
}

// ---------- Бланк на фабрику ----------

/** Источник значения поля бланка. */
export type FactoryFieldSource = 'project' | 'manual' | 'dict';
