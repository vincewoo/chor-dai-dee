import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import SortableHandCardV2 from './SortableHandCardV2';
import useHandGeometry from '../../hooks/useHandGeometry';

// The player's overlapping hand. Reuses GameRoom's dnd sensors + handlers via
// props so drag-reorder, swipe-select, and tap-select all keep working.
function MobileHandV2({
    sortedHand, selectedCards, onToggle,
    sensors, onDragStart, onDragEnd,
    handContainerRef, onTouchStart, onTouchMove, onTouchEnd,
    containerWidth, acc, fourColor, pusoyMode, geometry,
}) {
    const { width, height, marginLeft, typeScale } = useHandGeometry(sortedHand.length, containerWidth, geometry);

    return (
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: Math.max(126, height + 8), alignItems: 'flex-end', paddingBottom: 2 }}>
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
                                    pusoyMode={pusoyMode}
                                    typeScale={typeScale}
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
