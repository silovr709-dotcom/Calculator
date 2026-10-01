import { describe, expect, it } from 'vitest';
import type { WorktopPiece } from '../types';
import { autoArrangeWorktopPieces, buildWorktopPlanSvg, layoutWorktopPieces, nextWorktopEdgeKind, snapWorktopPiecePosition, worktopEdgeSymbol } from './worktopSketch';

const pieces: WorktopPiece[] = [
  { id: 'a', name: 'Основная', lengthMm: 2400, widthMm: 600, front: 'pf', back: 'pvc', left: 'v', right: 'eurozapil' },
  { id: 'b', name: 'Крыло', lengthMm: 1600, widthMm: 600, front: 'pvc', left: null, right: 'eurostyk' },
];

describe('worktopSketch', () => {
  it('использует фабричные обозначения обработки столешницы', () => {
    expect(worktopEdgeSymbol('v')).toBe('V');
    expect(worktopEdgeSymbol('pvc')).toBe('Х');
    expect(worktopEdgeSymbol('pf')).toBe('ПФ');
    expect(worktopEdgeSymbol('eurozapil')).toBe('⧖');
    expect(worktopEdgeSymbol('eurostyk')).toBe('↔');
  });

  it('строит SVG-схему с размерами и обозначениями кромок', () => {
    const svg = buildWorktopPlanSvg(pieces, { widthPx: 650, heightPx: 420, showLegend: false });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Основная');
    expect(svg).toContain('2400×600 мм');
    expect(svg).toContain('ПФ');
    expect(svg).toContain('V');
    expect(svg).toContain('//');
    expect(svg).toContain('Х');
  });

  it('даёт быстрые схемы прямой и угловой раскладки', () => {
    const line = autoArrangeWorktopPieces(pieces, 'line');
    expect(line[0].rotated).toBe(false);
    expect(line[1].layoutXmm).toBeGreaterThan(line[0].layoutXmm ?? -1);
    const corner = autoArrangeWorktopPieces(pieces, 'corner');
    expect(corner[1].rotated).toBe(true);
    expect(corner[1].layoutYmm).toBeGreaterThan(corner[0].layoutYmm ?? -1);
  });

  it('при перетаскивании прилипает краями и центрами к соседним деталям', () => {
    const layouts = layoutWorktopPieces(autoArrangeWorktopPieces(pieces, 'line'));
    const snappedToRight = snapWorktopPiecePosition(layouts, 'b', 2385, 12, 50);
    expect(snappedToRight.x).toBe(2400);
    expect(snappedToRight.y).toBe(0);
    expect(snappedToRight.snapX).toBe('left');
    expect(snappedToRight.snapY).toBe('top');
  });

  it('циклически переключает обозначение стороны', () => {
    expect(nextWorktopEdgeKind(null)).toBe('pvc');
    expect(nextWorktopEdgeKind('pvc')).toBe('v');
    expect(nextWorktopEdgeKind('eurostyk')).toBeNull();
  });
});
