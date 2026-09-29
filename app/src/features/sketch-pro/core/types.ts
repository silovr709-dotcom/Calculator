import type { SlotKey } from '../../../types';

export type Point = { x: number; y: number };
export type Tool = 'select' | 'free-dimension' | 'h-dimension' | 'v-dimension' | 'chain' | 'module' | 'callout' | 'comment' | 'equipment' | 'link';
export type EquipmentType = 'Холодильник' | 'Духовой шкаф' | 'СВЧ' | 'ПММ' | 'Варочная панель' | 'Вытяжка' | 'Стиральная машина' | 'Мойка' | 'Другое';

export interface SketchMaterialReference {
  moduleId: string;
  slot: SlotKey;
  label?: string;
  itemId?: string | null;
}

export type BaseObject = {
  id: string;
  type: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  width?: number;
  height?: number;
  fill?: string;
  fillOpacity?: number;
  borderRadius?: number;
  hidden?: boolean;
  locked?: boolean;
};

export type DimensionObject = BaseObject & {
  type: 'dimension';
  orientation: 'horizontal' | 'vertical' | 'free';
  textOrientation?: 'parallel' | 'horizontal';
  offset?: number;
  x2: number;
  y2: number;
  value: string;
  lineWidth: number;
  arrowStyle?: 'open' | 'closed' | 'tick';
  chainId?: string;
  prefix?: string;
  suffix?: string;
  tolerance?: string;
  showUnit?: boolean;
  textPosition?: 'center' | 'above' | 'below';
};

export type ModuleObject = BaseObject & {
  type: 'module';
  number: string;
  description: string;
  sourceModuleId?: string;
  materialRefs?: SketchMaterialReference[];
};

export type TextObject = BaseObject & {
  type: 'comment' | 'link' | 'equipment';
  text: string;
  url?: string;
  equipmentType?: EquipmentType;
};

export type CalloutObject = BaseObject & {
  type: 'callout';
  targetX: number;
  targetY: number;
  text: string;
  url?: string;
};

export type SketchObject = DimensionObject | ModuleObject | TextObject | CalloutObject;

export type SketchHeader = {
  enabled: boolean;
  project: string;
  room: string;
  date: string;
  variant: string;
};

/** Полный документ хранится только в IndexedDB, а не в Project/localStorage. */
export type SketchDocument = {
  version: 1;
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  room: string;
  variant: string;
  sourceAssetId: string;
  image: { dataUrl: string; width: number; height: number; name: string };
  objects: SketchObject[];
  header: SketchHeader;
  integration: { projectId: string; clientId?: string };
};

/** Алиас сохраняет читаемость адаптированного редактора из ESCIZ. */
export type SketchProject = SketchDocument;

export type ProjectSummary = Pick<SketchDocument, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { thumbnail?: string; projectId: string };

export const uid = () => crypto.randomUUID();
export const todayRu = () => new Intl.DateTimeFormat('ru-RU').format(new Date());
