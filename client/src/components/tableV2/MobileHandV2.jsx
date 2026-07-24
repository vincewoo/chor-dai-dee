import { useMemo } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import SortableHandCardV2 from './SortableHandCardV2';

// The player's overlapping hand. Reuses GameRoom's dnd sensors + handlers via
// props so drag-reorder, swipe-select, and tap-select all keep working.
function MobileHandV2({
    sortedHand, selectedCards, onToggle,
    sensors, onDragStart, onDragEnd,
    handContainerRef, onTouchStart, onTouchMove, onTouchEnd,
    containerWidth, acc, fourColor,
}) {
    const { width, height, marginLeft } = useMemo(() => {
        const n = sortedHand.length;
        const avail = Math.max(0, (containerWidth || 390) - 12);
        // Base width 75; shrink to fit up to 13 cards at ~32% visible each.
        const maxByCount = avail / (1 + (13 - 1) * 0.32);
        const w = Math.max(48, Math.min(75, maxByCount));
        const h = w * 1.533;
        const ml = n <= 1 ? 0 : Math.max(-(w * 0.68), Math.min(-(w * 0.48), (avail - w) / (n - 1) - w));
        return { width: Math.round(w), height: Math.round(h), marginLeft: Math.round(ml) };
    }, [sortedHand.length, containerWidth]);

    return (
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: 126, alignItems: 'flex-end', paddingBottom: 2 }}>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                <SortableContext
                    items={sortedHand.map(c => `${c.rank}-${c.suit}`)}
                    strategy={horizontalListSortingStrategy}
                >
                    <div
                        ref={handContainerRef}
                        onTouchStart={onTouchStart}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                        style={{ display: 'flex', justifyContent: 'center', touchAction: 'pan-y', minHeight: height }}
                    >
                        {sortedHand.map((card, index) => {
                            const isSelected = selectedCards.some(c => c.rank === card.rank && c.suit === card.suit);
                            return (
                                <SortableHandCardV2
                                    key={`${card.rank}-${card.suit}`}
                                    card={card}
                                    isSelected={isSelected}
                                    onToggle={onToggle}
                                    index={index}
                                    marginLeft={marginLeft}
                                    width={width}
                                    height={height}
                                    acc={acc}
                                    fourColor={fourColor}
                                />
                            );
                        })}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}

export default MobileHandV2;
