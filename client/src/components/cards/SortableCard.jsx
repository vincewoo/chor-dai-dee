import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Card from '../Card';
import { memo } from 'react';

/**
 * Sortable card wrapper component for drag-and-drop functionality
 * Uses @dnd-kit for drag-and-drop handling
 */
const SortableCard = ({ card, isSelected, onToggle, index, dynamicMargin, dynamicWidth, dynamicHeight }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: `${card.rank}-${card.suit}`,
        transition: {
            duration: 150,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        },
    });

    const defaultTransition = 'margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    const styleTransition = isDragging
        ? undefined
        : (transition ? `${transition}, ${defaultTransition}` : defaultTransition);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: styleTransition,
        zIndex: isDragging ? 50 : 'auto',
    };

    // Apply margin logic:
    // 1. First card: No left margin (save space)
    // 2. Other cards: Use dynamic overlap (mobile) or fixed overlap (desktop)

    if (index === 0) {
        style.marginLeft = '0';
    } else {
        // Subsequent cards: use overlap
        if (dynamicMargin !== undefined) {
            style.marginLeft = typeof dynamicMargin === 'number' ? `${dynamicMargin}px` : dynamicMargin;
        } else {
            style.marginLeft = '-45px';
        }
    }

    return (
        <div
            ref={setNodeRef}
            style={{ ...style, touchAction: 'none' }}
            data-card-id={`${card.rank}-${card.suit}`}
            className={`hover:ml-0 md:hover:-ml-[1.5vmax] ${index !== 0 ? 'md:-ml-[1.5vmax]' : ''} ${isDragging ? 'opacity-50' : ''}`}
            {...attributes}
            {...listeners}
        >
            <Card
                rank={card.rank}
                suit={card.suit}
                selected={isSelected}
                onClick={() => onToggle(card)}
                index={index}
                size="xlarge"
                dynamicWidth={dynamicWidth}
                dynamicHeight={dynamicHeight}
            />
        </div>
    );
};

export default memo(SortableCard);
