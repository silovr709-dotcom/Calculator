// «Бланк на фабрику» — ядро РЕцепт PRO по направлению «Фабрика → тип бланка → правила».
// Спецификации построены СТРОГО по инструкциям:
//   «Инструкция по заполнению бланк а кухни 2025.pdf»
//   «Инструкция по заполнению бланка корпус 2025.pdf»
// Ничего не придумываем: поля и обязательность — из бланков, значения из калькулятора
// подставляются только там, где это однозначно. Ручные значения хранятся в
// project.factoryBlankDrafts, молча данные пользователя не исправляются.
import type { FactoryFieldSource, KitchenModule, Pricebook, Project, SlotKey } from '../types';
import { lineMatchesChecklistKey } from './checklist';
import { checkModule, moduleStandsOnFloor, resolveSlot, slotNeed } from './modules';

// ---------- Модель спецификации ----------

export type BlankAutoFrom =
  | 'productType'      // наименование изделия по типу проекта
  | 'hTall'            // h пеналов общая (каркас + ноги)
  | 'hWall'            // h шкафов (каркас)
  | 'hBase'            // h столов общая (с ногами)
  | 'moduleSizesVHD'   // «Размер корпуса (ВШГ) …-N шт» списком (корпусный бланк)
  | 'facadeMaterial'   // вид фасада / материал
  | 'hinges'           // петли: модель + количество
  | 'handles'          // ручки: модель + количество
  | 'drawerGuides'     // направляющие: модель + комплекты
  | 'legs'             // ножки: высота + количество
  | 'lifts'            // подъёмные механизмы: модель + количество
  | 'worktop'          // тип столешницы (толщина/категория)
  | 'worktopColor'     // цвет столешницы
  | 'wallPanel'        // стеновая панель
  | 'baseboard'        // плинтус
  | 'plinth'           // цоколь
  | 'sink';            // мойка

export interface FactoryBlankField {
  key: string;
  label: string;
  section: string;
  required: boolean;
  /** Ожидаемый источник значения по инструкции. */
  expected: FactoryFieldSource;
  /** Автоподстановка из калькулятора (если возможна). */
  autoFrom?: BlankAutoFrom;
  /** Правило из инструкции — показываем под полем, чтобы менеджер не допустил ошибку. */
  hint?: string;
}

export interface FactoryBlankSpec {
  id: string;
  factoryName: string;
  blankName: string;
  fields: FactoryBlankField[];
}

const H = (key: string, label: string, opts: Partial<FactoryBlankField> = {}): FactoryBlankField => ({
  key, label, section: 'Шапка', required: false, expected: 'manual', ...opts,
});

// ---------- Бланк ВИСМА «КУХНИ 2025» (по инструкции) ----------

export const VISMA_KITCHEN_BLANK: FactoryBlankSpec = {
  id: 'visma-kitchen-2025',
  factoryName: 'Висма',
  blankName: 'Бланк заказа кухни 2025',
  fields: [
    // Шапка — заполняется менеджером фабрики (на стороне фабрики), у нас — вручную при необходимости
    H('manager', 'Менеджер/Технолог', { hint: 'Заполняется менеджером фабрики' }),
    H('orderNo', '№ заказа', { hint: 'Номер заказа фабрики — менеджер фабрики' }),
    H('seriesNo', '№ серии', { hint: 'Серийное производство — технолог фабрики' }),
    H('startDate', 'Дата запуска', { hint: 'Запуск строго после аванса на р/с; при изменениях проекта дата запуска = день подтверждения изменений клиентом' }),
    H('shipDate', 'Плановая дата отгрузки', { hint: 'Ориентировочная — менеджер фабрики' }),
    { key: 'productName', label: 'Наименование изделия', section: 'Шапка', required: true, expected: 'manual', autoFrom: 'productType', hint: 'Например: кухня, детская, стеллаж' },

    // Каркас
    { key: 'hTall', label: 'h пеналов общ.', section: 'Каркас', required: false, expected: 'project', autoFrom: 'hTall', hint: 'Общая высота с ногами (каркас+ноги). Пример: 2140 мм при опорах h100' },
    { key: 'hBread', label: 'h хлебниц/антр.', section: 'Каркас', required: false, expected: 'manual', hint: 'Только h каркаса, без высоты заниженного фасада. Пример: 360 мм' },
    { key: 'hWall', label: 'h шкафов', section: 'Каркас', required: false, expected: 'project', autoFrom: 'hWall', hint: 'Только h каркаса, без высоты заниженного фасада. Пример: 720 мм' },
    { key: 'hBase', label: 'h столов общ.', section: 'Каркас', required: false, expected: 'project', autoFrom: 'hBase', hint: 'Общая высота с ногами. Пример: 820 мм при опорах h100' },
    { key: 'ldspColor', label: 'Цвет ЛДСП (верх/низ)', section: 'Каркас', required: true, expected: 'dict', hint: 'В официальном бланке есть отдельные клетки «Верх» и «Низ». Если цвет общий — впишите один раз, экспорт продублирует его в обе клетки. Если разные — пишите: «Верх — белый U1655; низ — !венге линум U1104»' },
    { key: 'bodyEdging', label: 'Кромка каркаса (верх/низ)', section: 'Каркас', required: true, expected: 'dict', hint: 'Толщина, артикул, название и производитель. Если верх/низ отличаются — пишите «Верх — …; низ — …». Не указана — фабрика подбирает сама, претензии не принимаются' },
    { key: 'backPanel', label: 'ДА (задняя стенка, верх/низ)', section: 'Каркас', required: false, expected: 'manual', hint: 'ХДФ (паз/набивное). Если верх/низ отличаются — пишите «Верх — …; низ — …»' },
    { key: 'hardPackFacade', label: 'Жесткая упаковка фасадов', section: 'Каркас', required: false, expected: 'manual' },
    { key: 'doublePack', label: 'Двойная гофра на каркас', section: 'Каркас', required: false, expected: 'manual' },
    { key: 'worktopScraps', label: 'Остатки столешниц клиенту', section: 'Каркас', required: false, expected: 'manual' },
    { key: 'packNotes', label: 'Доп. сведения на упаковку', section: 'Каркас', required: false, expected: 'manual' },

    // Фасад
    { key: 'facadeType', label: 'Вид фасада (верх/низ)', section: 'Фасад', required: true, expected: 'project', autoFrom: 'facadeMaterial', hint: 'Вид фасада и поставщик плёнки/пластика/TSS. Если верх/низ отличаются — пишите «Верх — …; низ — …». Пример: МДФ (ПВХ) АДИЛЕТ' },
    { key: 'facadeColor', label: 'Цвет фасада и текстура (верх/низ)', section: 'Фасад', required: true, expected: 'dict', hint: 'Артикул и название по разбивке фабрики. Плёнка с текстурой — ОБЯЗАТЕЛЬНО знак «!». Если разные цвета — пишите «Верх — …; низ — …» и отметьте на эскизе' },
    { key: 'facadeMilling', label: 'Тип фрезеровки/фаска (верх/низ)', section: 'Фасад', required: false, expected: 'dict', hint: 'По техничке фабрики (пример: Пирамида). Если верх/низ отличаются — пишите «Верх — …; низ — …». По образцу заказчика — толщина фасада, фаска/обкатка, ширина рамки, фото с рулеткой' },
    { key: 'facadeFrame', label: 'Вид рамки (верх/низ)', section: 'Фасад', required: false, expected: 'manual', hint: 'Для фасадов в алюминиевой рамке; при различиях пишите «Верх — …; низ — …»' },
    { key: 'facadeEdging', label: 'Кромка фасада (верх/низ)', section: 'Фасад', required: false, expected: 'dict', hint: 'Пластик — 1мм с производителем и артикулом; ЛДСП — 2мм GP Plast с артикулом; TSS/AGT — кромка производителя. Если верх/низ отличаются — пишите «Верх — …; низ — …»' },

    // Дополнения к каркасам/фасадам
    { key: 'legs', label: 'Ножки', section: 'Дополнения', required: false, expected: 'project', autoFrom: 'legs', hint: 'Пластмассовые под цоколь — только высота (100/150). Хром — высота и количество. Пример: Хром, Н=150мм, D=50 — 12 шт.' },
    { key: 'plinth', label: 'Цоколь', section: 'Дополнения', required: false, expected: 'project', autoFrom: 'plinth', hint: 'ЛДСП общий — по эскизу, макс. длина 1800 (указать стыки). МДФ (ПВХ) — длина и цвет, считается кратно 2 м' },
    { key: 'plinthExtras', label: 'Доп. эл-ты к цоколю', section: 'Дополнения', required: false, expected: 'manual', hint: 'Углы 90/135°, заглушки, силиконовый уплотнитель. Пример: 90° — 2 шт., загл. — 2 шт.' },
    { key: 'mensola', label: 'Менсола', section: 'Дополнения', required: false, expected: 'manual', hint: 'Длина детали (глубина стандарт 300, ПВХ 0,4мм)' },
    { key: 'extraShelves', label: 'Доп. полки ЛДСП/Стекло', section: 'Дополнения', required: false, expected: 'manual', hint: 'Куда — указать и отметить на эскизе. Стекло 6мм в еврокромке по кругу: в какие шкафы и сколько' },
    { key: 'cornice', label: 'Козырёк (цвет)', section: 'Дополнения', required: false, expected: 'manual', hint: 'Стандартная глубина 450. Фигурный — с эскизом и основными размерами' },
    { key: 'baguette', label: 'Багет (тип и цвет)', section: 'Дополнения', required: false, expected: 'manual', hint: 'Хлысты 2200, по умолчанию расчёт по корпусу; распил — по эскизу распила' },

    // Столешница
    { key: 'worktopType', label: 'Тип столешницы', section: 'Столешница', required: true, expected: 'project', autoFrom: 'worktop', hint: 'Толщина, производитель, категория. Пример: 38 мм СОЮЗ Универсал. Обязателен лист 2 бланка (схема столешниц с видами кромок)' },
    { key: 'worktopColor', label: 'Цвет столешницы', section: 'Столешница', required: true, expected: 'project', autoFrom: 'worktopColor', hint: 'Название и артикул (обязательно). Пример: Белый 1111Q' },
    { key: 'worktopEdge', label: 'Тип кромки по переду', section: 'Столешница', required: false, expected: 'manual', hint: 'ПФ-постформинг / кромка, например 1,5 мм Рехау Дизайно' },
    { key: 'worktopEdgeColor', label: 'Цвет кромки', section: 'Столешница', required: false, expected: 'manual', hint: 'Название и артикул. Пример: 1257Е Травертин' },
    { key: 'worktopPlanks', label: 'Планки для столешницы', section: 'Столешница', required: false, expected: 'manual', hint: 'Торцевые/угловые/соединительные + кол-во; еврозапил или евростык со стяжками — также на эскизе. Пример: 1 соед, 1 угл, 2 торц.' },
    { key: 'baseboard', label: 'Плинтус', section: 'Столешница', required: false, expected: 'project', autoFrom: 'baseboard', hint: 'Производитель, высота, длина, артикул, название, кол-во. Пример: Кернер, 37мм, 3м №6148 Мрамор белый — 1 хл' },
    { key: 'baseboardCaps', label: 'Заглушки д/плинтуса', section: 'Столешница', required: false, expected: 'manual', hint: 'Количество комплектов и вид' },
    { key: 'wallPanel', label: 'Стеновая/фото панель', section: 'Столешница', required: false, expected: 'project', autoFrom: 'wallPanel', hint: 'Цвет и количество: кратно хлысту/полхлыста при глубине 600. Нестандартная высота — отрезок «высота*ширина». Распил — с размерами' },
    { key: 'wallPanelPlanks', label: 'Планки д/стен. панели', section: 'Столешница', required: false, expected: 'manual', hint: 'Торцевые/угловые/соединительные + количество и толщина 4мм/6мм' },

    // Фурнитура
    { key: 'light', label: 'Светильники', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Подсветка + доп. фурнитура (рассеиватель, лента, блок питания). Паз под врезную подсветку — точное место, отступ от края ≥100мм' },
    { key: 'hinges', label: 'Петли', section: 'Фурнитура', required: true, expected: 'project', autoFrom: 'hinges', hint: 'Производитель, градусы и количество; расположение на эскизе. Пример: Боярд с доводчиком: 110° — 12 шт, 180° — 4 шт' },
    { key: 'glass', label: 'Стекло/Витраж', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Толщина, название/цвет, цвет протяжки (витраж), обработка по периметру (притупление/еврокромка)' },
    { key: 'glassFrame', label: 'Стекло в ал. рамке', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Название стекла, вид профиля и его цвет. Для пластика рамка под стекло — сборная по умолчанию' },
    { key: 'dishDryer', label: 'Посудосушитель', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Тип, артикул, размер; «без дна» — указать отдельно (стандарт — с дном)' },
    { key: 'drawerGuides', label: 'Направляющие', section: 'Фурнитура', required: false, expected: 'project', autoFrom: 'drawerGuides', hint: 'По умолчанию НПВ (ящики ЛДСП, дно ХДФ). т/б — тандембоксы, ТЧО/ТПО — скрытого монтажа; для НПВ с доводчиком — глубина' },
    { key: 'hangerRail', label: 'Шина (проф. навес)', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Количество' },
    { key: 'shelfHolders', label: 'Крепеж полок', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Вид и количество; «база» если базовый. Разные виды — отметить на эскизе' },
    { key: 'basket', label: 'Корзина/бутылочница', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Артикул по прайсу, ширина, количество, сторона крепления (присадка по умолчанию с двух сторон)' },
    { key: 'lifts', label: 'Подъёмные механизмы', section: 'Фурнитура', required: false, expected: 'project', autoFrom: 'lifts', hint: 'Тип и количество; на эскизе — в каких шкафах какой механизм. Пример: HF — 2 шт.' },
    { key: 'tipOn', label: 'Tip-on', section: 'Фурнитура', required: false, expected: 'manual', hint: 'На какие шкафы' },
    { key: 'sink', label: 'Мойка', section: 'Фурнитура', required: false, expected: 'project', autoFrom: 'sink', hint: 'Модель (левая/правая — в хром), цвет (в каменных). На эскизе: М.В. (врезная) или М.Н. (накладная)' },
    { key: 'tray', label: 'Лоток Л/В', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Количество и размер по модельному ряду прайса' },
    { key: 'handles', label: 'Ручки', section: 'Фурнитура', required: false, expected: 'project', autoFrom: 'handles', hint: 'Название, артикул, цвет, количество + сверловка (учитывать техничку: вылет до 30мм в каждую сторону!). Торцевая — сверловка не нужна. Ручки клиента — указать межосевое' },
    { key: 'gasLift', label: 'Газ лифт (г/л)', section: 'Фурнитура', required: false, expected: 'manual', hint: '«база» или артикул и количество' },
    { key: 'thermoStrip', label: 'Термопланка', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Артикул и количество' },
    { key: 'other', label: 'Прочее', section: 'Фурнитура', required: false, expected: 'manual', hint: 'Остальная комплектация: барные стойки, смесители, наполнение столов, менсолодержатели' },
  ],
};

// ---------- Бланк «КОРПУС 2025» (по инструкции) ----------

export const VISMA_CORPUS_BLANK: FactoryBlankSpec = {
  id: 'visma-corpus-2025',
  factoryName: 'Висма',
  blankName: 'Бланк корпус 2025',
  fields: [
    H('orderNo', '№ заказа'),
    H('manager', 'Менеджер'),
    H('technolog', 'Технолог'),
    H('startDate', 'Дата запуска'),
    H('shipDate', 'Дата отгрузки'),
    { key: 'productName', label: 'Наименование', section: 'Шапка', required: true, expected: 'manual', autoFrom: 'productType' },

    { key: 'corpusSizes', label: 'Размер корпуса (ВШГ) с h цоколя', section: 'Корпус', required: true, expected: 'project', autoFrom: 'moduleSizesVHD', hint: 'Размеры только по каркасу (фасады/канты не входят!), с количеством. Пример: 2400*1600*600 — 1 шт' },
    { key: 'plinthHeight', label: 'Высота цоколя, мм', section: 'Корпус', required: false, expected: 'manual', hint: 'h60/80/100; вырез под плинтус — указать, по эскизу' },
    { key: 'corpusColor', label: 'Цвет корпуса', section: 'Корпус', required: true, expected: 'dict', hint: 'По разбивке ЛДСП с артикулом и производителем + все толщины. Пример: Эггер !Дуб Канзас коричневый Н1113 ST10 — 16мм' },
    { key: 'corpusEdging', label: 'Кромка корпуса', section: 'Корпус', required: true, expected: 'dict', hint: 'Толщина, артикул, цвет, производитель. Пример: 0,4мм 201 белый GP' },
    { key: 'backPanel', label: 'Задняя стенка', section: 'Корпус', required: false, expected: 'manual', hint: 'ХДФ в паз / ЛДСП (цвет при нескольких)' },
    { key: 'extraLdsp', label: 'Дополнительное ЛДСП (ВШГ)', section: 'Корпус', required: false, expected: 'manual', hint: 'фп отдельно от изделия и рейки: размеры, количество, цвет ЛДСП' },

    { key: 'openingSize', label: 'Размер проёма (В*Ш)', section: 'Фасады', required: false, expected: 'manual', hint: 'Проём ниши для дверей купе; за минусом планок ЛДСП' },
    { key: 'coupeSystem', label: 'Система/форма ручки/цвет профиля', section: 'Фасады', required: false, expected: 'manual', hint: 'Пример: Абсолют / Лагуна / Шимо тёмный' },
    { key: 'facadeType', label: 'Вид/цвет/фрезеровка/текстура', section: 'Фасады', required: true, expected: 'project', autoFrom: 'facadeMaterial', hint: 'Производитель и исполнение; текстура со знаком «!» — обязательно. По образцу — фото с параметрами и толщиной, направление текстуры' },
    { key: 'facadeEdging', label: 'Кромка фасадов', section: 'Фасады', required: false, expected: 'dict', hint: 'Сначала толщина, потом артикул/название' },
    { key: 'mirror', label: 'Зеркало/стекло/оракал', section: 'Фасады', required: false, expected: 'manual', hint: 'Толщина, артикул/название' },
    { key: 'mirrorEdge', label: 'Еврокромка/фацет', section: 'Фасады', required: false, expected: 'manual' },
    { key: 'mirrorGlue', label: 'Наклейка зеркала/стекла', section: 'Фасады', required: false, expected: 'manual', hint: 'Отступы от края — обязательно' },
    { key: 'baguette', label: 'Багет/пилястры/фп', section: 'Фасады', required: false, expected: 'manual', hint: 'Распил — эскиз распила; пилястра — номер' },

    { key: 'worktopSize', label: 'Размер столешницы', section: 'Столешница', required: false, expected: 'manual', hint: 'С учётом нужных свесов' },
    { key: 'worktopColor', label: 'Цвет столешницы', section: 'Столешница', required: false, expected: 'project', autoFrom: 'worktopColor' },
    { key: 'worktopEdging', label: 'Кромка столешницы', section: 'Столешница', required: false, expected: 'manual' },
    { key: 'worktopScraps', label: 'Остатки столешницы клиенту', section: 'Столешница', required: false, expected: 'manual', hint: 'Если столешница постформированная' },

    { key: 'drawerGuides', label: 'Вид направляющих', section: 'Доп. комплектация', required: false, expected: 'project', autoFrom: 'drawerGuides', hint: 'Производитель, вид, цвет, кол-во' },
    { key: 'hinges', label: 'Петли', section: 'Доп. комплектация', required: false, expected: 'project', autoFrom: 'hinges', hint: 'Производитель, вид, градус, кол-во (накладные/полунакладные раздельно)' },
    { key: 'shelfHolders', label: 'Крепёж полок', section: 'Доп. комплектация', required: false, expected: 'manual', hint: '«База» или вид + количество' },
    { key: 'hangerRail', label: 'Навесы/Шина', section: 'Доп. комплектация', required: false, expected: 'manual' },
    { key: 'tuba', label: 'Туба 25мм/овальная', section: 'Доп. комплектация', required: false, expected: 'manual', hint: 'Вид трубы, цвет, количество' },
    { key: 'flange', label: 'Флянец/держатель/соединитель', section: 'Доп. комплектация', required: false, expected: 'manual' },
    { key: 'basket', label: 'Сетка/крепёж сетки/корзины', section: 'Доп. комплектация', required: false, expected: 'manual' },
    { key: 'handles', label: 'Ручка мебельная/сверловка', section: 'Доп. комплектация', required: false, expected: 'project', autoFrom: 'handles', hint: 'Сверловка обязательна; торцевая — не нужна; ручки клиента — межосевое' },
    { key: 'hardPack', label: 'Жёсткая упаковка', section: 'Доп. комплектация', required: false, expected: 'manual', hint: 'Нужна или нет' },
    { key: 'feet', label: 'Ноги/подпятники', section: 'Доп. комплектация', required: false, expected: 'manual' },
    { key: 'hooks', label: 'Крючки', section: 'Доп. комплектация', required: false, expected: 'manual' },
    { key: 'other', label: 'Прочее', section: 'Доп. комплектация', required: false, expected: 'manual', hint: 'Особенности конструкции и прочая фурнитура' },
  ],
};

export const FACTORY_BLANK_SPECS: FactoryBlankSpec[] = [VISMA_KITCHEN_BLANK, VISMA_CORPUS_BLANK];

export const getFactoryBlankSpec = (id: string): FactoryBlankSpec | undefined =>
  FACTORY_BLANK_SPECS.find((s) => s.id === id);

// ---------- Автоподстановка из калькулятора ----------

const parseCaseInsensitive = /h\s*=?\s*(\d{2,3})/i;

function legsHeightMm(modules: KitchenModule[], project: Project, pricebook: Pricebook): number {
  for (const m of modules) {
    const item = resolveSlot(m, 'legs', project.moduleDefaults ?? {}, pricebook).item;
    const match = item?.name.match(parseCaseInsensitive);
    if (match) return Number(match[1]);
  }
  return 100; // базовая высота из примеров инструкции (h100/h150)
}

/** Мода (самое частое) значение; null, если нет значений. */
function modeOf(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null; let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
}

function moduleSearchText(module: KitchenModule): string {
  return `${module.type} ${module.name}`.toLocaleLowerCase('ru-RU');
}

function isTallCabinet(module: KitchenModule): boolean {
  const text = moduleSearchText(module);
  return module.type === 'Пенал' || /пенал|холодильн/.test(text);
}

function isWallCabinet(module: KitchenModule): boolean {
  const text = moduleSearchText(module);
  return module.type === 'Верхний шкаф' || /верх|навес/.test(text);
}

function isBaseCabinet(module: KitchenModule): boolean {
  if (isTallCabinet(module)) return false;
  if (moduleStandsOnFloor(module.type)) return true;
  const text = moduleSearchText(module);
  return /нижн|стол|тумб|мойк|духов/.test(text);
}

/** Сокращённое имя позиции прайса для бланка (без служебного хвоста). */
const shortName = (name: string) => name.replace(/\s+/g, ' ').trim();

interface SlotSummaryGroup { name: string; qty: number }

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000).replace('.', ',');
}

/**
 * Для бланка фабрики лучше сразу давать технологу разбивку по моделям,
 * а не «модели разные — расписать вручную». Ничего не придумываем: если модель
 * не выбрана, это явно остаётся в тексте и дополнительно ловится проверкой.
 */
function summarizeSlotItems(
  modules: KitchenModule[],
  project: Project,
  pricebook: Pricebook,
  slot: SlotKey,
  unit: string,
  need: (module: KitchenModule) => number,
): string {
  const groups = new Map<string, SlotSummaryGroup>();
  let missing = 0;
  let total = 0;

  for (const module of modules) {
    const qty = need(module) * module.qty;
    if (qty <= 0) continue;
    total += qty;
    const item = resolveSlot(module, slot, project.moduleDefaults ?? {}, pricebook).item;
    if (!item) {
      missing += qty;
      continue;
    }
    const name = shortName(item.name);
    const group = groups.get(name) ?? { name, qty: 0 };
    group.qty += qty;
    groups.set(name, group);
  }

  if (total <= 0) return '';
  const parts = [...groups.values()].map((group) => `${group.name} — ${fmtQty(group.qty)} ${unit}`);
  if (missing > 0) parts.push(`модель не выбрана — ${fmtQty(missing)} ${unit}`);
  return parts.join('; ');
}

export function autofillValue(kind: BlankAutoFrom, project: Project, pricebook: Pricebook): string {
  const modules = project.modules ?? [];
  switch (kind) {
    case 'productType': return 'кухня';
    case 'hTall': {
      const heights = modules.filter((m) => isTallCabinet(m) && m.heightMm != null).map((m) => m.heightMm!);
      const max = heights.length ? Math.max(...heights) : null;
      if (max == null) return '';
      const withLegs = modules.some((m) => isTallCabinet(m) && (m.legs ?? 0) > 0) ? legsHeightMm(modules, project, pricebook) : 0;
      return String(max + withLegs);
    }
    case 'hWall': {
      const height = modeOf(modules.filter((m) => isWallCabinet(m) && m.heightMm != null).map((m) => m.heightMm!));
      return height != null ? String(height) : '';
    }
    case 'hBase': {
      const height = modeOf(modules.filter((m) => isBaseCabinet(m) && m.heightMm != null).map((m) => m.heightMm!));
      if (height == null) return '';
      const legsHeight = legsHeightMm(modules, project, pricebook);
      return String(height + legsHeight);
    }
    case 'moduleSizesVHD': {
      // Инструкция: В*Ш*Г с h цоколя, количество. Пример: 2400*1600*600 — 1 шт
      return modules
        .filter((m) => m.heightMm != null && m.widthMm != null && m.depthMm != null)
        .map((m) => `${m.name}: ${m.heightMm}*${m.widthMm}*${m.depthMm} — ${m.qty} шт`)
        .join(';\n');
    }
    case 'facadeMaterial': {
      return summarizeSlotItems(modules, project, pricebook, 'facade', 'фас.', (m) => slotNeed(m, 'facade'));
    }
    case 'hinges': {
      return summarizeSlotItems(modules, project, pricebook, 'hinge', 'шт', (m) => m.hinges);
    }
    case 'handles': {
      const summary = summarizeSlotItems(modules, project, pricebook, 'handle', 'шт', (m) => m.handles);
      return summary ? `${summary}; сверловка по эскизу` : '';
    }
    case 'drawerGuides': {
      return summarizeSlotItems(modules, project, pricebook, 'drawerSys', 'компл.', (m) => m.drawers);
    }
    case 'legs': {
      const stands = modules.filter((m) => moduleStandsOnFloor(m.type) && (m.legs ?? 0) > 0);
      if (!stands.length) return '';
      const summary = summarizeSlotItems(stands, project, pricebook, 'legs', 'шт', (m) => m.legs ?? 0);
      const height = legsHeightMm(modules, project, pricebook);
      return summary ? `${summary}; Н=${height} мм` : `Н=${height} мм — ${stands.reduce((sum, m) => sum + (m.legs ?? 0) * m.qty, 0)} шт`;
    }
    case 'lifts': {
      return summarizeSlotItems(modules, project, pricebook, 'lift', 'шт', (m) => m.lifts);
    }
    case 'worktop': {
      const line = project.lines.find((l) => lineMatchesChecklistKey('worktop', l));
      if (!line) return '';
      return shortName(line.name);
    }
    case 'worktopColor': {
      const line = project.lines.find((l) => lineMatchesChecklistKey('worktop', l));
      if (!line) return '';
      return shortName(line.name);
    }
    case 'wallPanel': {
      const line = project.lines.find((l) => lineMatchesChecklistKey('wallPanel', l));
      return line ? shortName(line.name) : '';
    }
    case 'baseboard': {
      const line = project.lines.find((l) => lineMatchesChecklistKey('baseboard', l));
      return line ? shortName(line.name) : '';
    }
    case 'plinth': {
      const line = project.lines.find((l) => lineMatchesChecklistKey('plinth', l));
      return line ? shortName(line.name) : '';
    }
    case 'sink': {
      const line = project.lines.find((l) => /мойк/i.test(l.category));
      return line ? shortName(line.name) : '';
    }
    default: return '';
  }
}

// ---------- Черновик и проверка ----------

export interface BlankDraftField {
  field: FactoryBlankField;
  /** Итоговое значение (ручное draft-значение сильнее авто). */
  value: string;
  /** Откуда взято текущее значение. */
  source: 'project' | 'draft' | 'empty';
}

/** Собирает черновик: для каждого поля — автоподстановка + ручное переопределение. */
export function draftFactoryBlank(project: Project, pricebook: Pricebook, spec: FactoryBlankSpec): BlankDraftField[] {
  const draft = project.factoryBlankDrafts?.[spec.id] ?? {};
  return spec.fields.map((field) => {
    const manual = draft[field.key];
    if (manual != null && manual !== '') return { field, value: manual, source: 'draft' };
    const auto = field.autoFrom ? autofillValue(field.autoFrom, project, pricebook) : '';
    if (auto !== '') return { field, value: auto, source: 'project' };
    return { field, value: '', source: 'empty' };
  });
}

export interface BlankIssue { fieldKey: string; label: string; level: 'error' | 'warn'; text: string }

/**
 * Проверка перед формированием бланка. Молча ничего не исправляем —
 * выдаём понятные 🔴/🟡 сообщения, пользователь правит сам.
 */
export function checkFactoryBlank(project: Project, pricebook: Pricebook, spec: FactoryBlankSpec, draft: BlankDraftField[]): BlankIssue[] {
  const issues: BlankIssue[] = [];
  const values = new Map(draft.map((d) => [d.field.key, d.value]));

  // 1) Обязательные поля бланка
  for (const d of draft) {
    if (d.field.required && d.value.trim() === '') {
      issues.push({ fieldKey: d.field.key, label: d.field.label, level: 'error', text: `Не заполнено поле «${d.field.label}»` });
    }
  }

  const modules = project.modules ?? [];
  // 2) Модули с неполными данными (используем существующую проверку калькулятора)
  const modulesWithErrors = modules.filter((m) => checkModule(m, project.moduleDefaults ?? {}, pricebook).errors.length > 0);
  if (modulesWithErrors.length > 0) {
    issues.push({ fieldKey: '__modules', label: 'Модули', level: 'error', text: `Позиций с неполными данными: ${modulesWithErrors.length} — заполните размеры и комплектацию в калькуляторе` });
  }

  // 3) Петли/ручки/направляющие/опоры: количество есть, модель не выбрана
  const needModel: { total: number; hasModel: boolean; key: string; label: string }[] = [
    { total: modules.reduce((s, m) => s + m.hinges * m.qty, 0), hasModel: modules.some((m) => resolveSlot(m, 'hinge', project.moduleDefaults ?? {}, pricebook).item), key: 'hinges', label: 'Петли' },
    { total: modules.reduce((s, m) => s + m.handles * m.qty, 0), hasModel: modules.some((m) => resolveSlot(m, 'handle', project.moduleDefaults ?? {}, pricebook).item), key: 'handles', label: 'Ручки' },
    { total: modules.reduce((s, m) => s + m.drawers * m.qty, 0), hasModel: modules.some((m) => resolveSlot(m, 'drawerSys', project.moduleDefaults ?? {}, pricebook).item), key: 'drawerGuides', label: 'Направляющие' },
  ];
  for (const n of needModel) {
    if (n.total > 0 && !n.hasModel && spec.fields.some((f) => f.key === n.key)) {
      issues.push({ fieldKey: n.key, label: n.label, level: 'error', text: `Указано количество (${n.total} шт), но модель не выбрана — технолог не сможет заказать` });
    }
  }

  // 4) Столешница по правилам бланка (если в спецификации есть поле)
  if (spec.fields.some((f) => f.autoFrom === 'worktop')) {
    const hasWorktop = project.lines.some((l) => lineMatchesChecklistKey('worktop', l));
    const confirmedAbsent = (project.checklistConfirmations ?? []).includes('worktop');
    if (!hasWorktop && !confirmedAbsent) {
      issues.push({ fieldKey: 'worktopType', label: 'Столешница', level: 'error', text: 'Не указана столешница — добавьте её в чек-листе проекта или подтвердите отсутствие' });
    }
  }

  // 5) Разные материалы фасадов у модулей — по инструкции цвета надо расписать (предупреждение)
  const facadeNames = new Set(modules.map((m) => resolveSlot(m, 'facade', project.moduleDefaults ?? {}, pricebook).item?.name).filter(Boolean));
  if (facadeNames.size > 1 && (values.get('facadeColor') ?? '').trim() === '') {
    issues.push({ fieldKey: 'facadeColor', label: 'Цвет фасада', level: 'warn', text: 'В проекте разные материалы фасадов — по правилам фабрики укажите, где какой цвет (на эскизе и в поле)' });
  }

  // 6) Ножки: стоящие модули есть, высота ножек не указана нигде
  const stands = modules.filter((m) => moduleStandsOnFloor(m.type));
  if (spec.fields.some((f) => f.key === 'legs') && stands.length > 0 && (values.get('legs') ?? '').trim() === '') {
    issues.push({ fieldKey: 'legs', label: 'Ножки', level: 'warn', text: 'Есть напольные модули — укажите высоту ножек (100/150 мм, хром — и количество)' });
  }

  return issues;
}

export function factoryBlankProgress(draft: BlankDraftField[]): { auto: number; draftCount: number; empty: number; requiredEmpty: number } {
  let auto = 0; let draftCount = 0; let empty = 0; let requiredEmpty = 0;
  for (const d of draft) {
    if (d.source === 'project') auto += 1;
    else if (d.source === 'draft') draftCount += 1;
    else empty += 1;
    if (d.field.required && d.value.trim() === '') requiredEmpty += 1;
  }
  return { auto, draftCount, empty, requiredEmpty };
}
