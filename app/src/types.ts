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
  toClient: boolean;     // показывать в клиентской цене
}

export interface ProjectSettings {
  markupBasePct: number | null;               // null = не задано
  markupByGroup: Partial<Record<SummaryGroup, number | null>>;
  extraExpenses: ExtraExpense[];
  applyEmalRule: boolean;                     // правило «эмаль < 1 кв.м +30%» (на сумму проекта)
  assemblyCost: number | null;
  deliveryCost: number | null;
}

/** Фото/эскиз проекта (хранится в самом проекте, сжимается при загрузке) */
export interface ProjectPhoto {
  id: string;
  name: string;
  dataUrl: string; // сжатый JPEG (data:image/jpeg;base64,...)
  addedAt: string;
  showToClient: boolean; // включать в клиентскую версию (КП)
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
  /** false — не выводить эскиз в клиентском КП; отсутствие поля = выводить */
  showInClient?: boolean;
  /** Планировка кухни; отсутствие поля = прямая (совместимость со старыми проектами). */
  shape?: KitchenLayoutShape;
  /** Вид эскиза по умолчанию; отсутствие поля = фасадные развёртки. */
  view?: KitchenSketchView;
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
  /** Настройки эскиза. Необязательное поле сохраняет совместимость со старыми проектами. */
  sketch?: KitchenSketchSettings;
  createdAt: string;
  updatedAt: string;
}

// ---------- Модули («Расчёт проекта») ----------

/** Слоты комплектации модуля. Значение слота — конкретная позиция прайса Висма. */
export type SlotKey = 'body' | 'facade' | 'hinge' | 'drawerSys' | 'lift' | 'handle' | 'shelf';

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
  // размер одного фасада (для расчёта площади м²)
  facadeWmm: number | null;
  facadeHmm: number | null;
  slots: Record<SlotKey, SlotChoice>;
  /**
   * Стена, вдоль которой стоит модуль в эскизе.
   * Отсутствие поля = задняя стена (совместимость со старыми проектами).
   */
  wall?: KitchenWall;
  /** Процентные надбавки прайса (нестандарт +10/30/50%…), считаются от суммы корпуса */
  surcharges?: string[];
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
  cost: number;           // итого себестоимость
  client: number;         // цена для клиента
  markupRub: number;
  markupPct: number | null;      // средневзвешенная наценка, %
  marginPct: number | null;      // маржинальность = наценка / цена клиента
  unpricedCount: number;  // строк без цены
}
