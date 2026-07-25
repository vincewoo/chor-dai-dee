import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo } from 'react';
import HandCardFaceV2 from './HandCardFaceV2';

// v2 hand card: overlapping white face with accent selection raise + deuce dot.
// Keeps the useSortable id scheme (`rank-suit`) and the data-card-id attribute
// so GameRoom's swipe-select and dnd reorder handlers continue to work.
const SortableHandCardV2 = ({
    card, isSelected, onToggle, index, marginLeft, width, height, acc, fourColor,
}) => {
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging,
    } = useSortable({
        id: `${card.rank}-${card.suit}`,
        transition: { duration: 150, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    });

    const wrapperStyle = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : (transition || 'margin-left .2s cubic-bezier(.4,0,.2,1)'),
        zIndex: isDragging ? 50 : 'auto',
        marginLeft: index === 0 ? 0 : marginLeft,
        touchAction: 'none',
        opacity: isDragging ? 0.5 : 1,
        flexShrink: 0,
    };

    return (
        <div
            ref={setNodeRef}
            style={wrapperStyle}
            data-card-id={`${card.rank}-${card.suit}`}
            {...attributes}
            {...listeners}
        >
            <HandCardFaceV2
                card={card}
                isSelected={isSelected}
                width={width}
                height={height}
                acc={acc}
                fourColor={fourColor}
                onClick={() => onToggle(card)}
            />
        </div>
    );
};

export default memo(SortableHandCardV2);
