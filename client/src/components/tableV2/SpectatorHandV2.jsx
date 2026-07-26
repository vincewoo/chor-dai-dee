import HandCardFaceV2 from './HandCardFaceV2';
import useHandGeometry from '../../hooks/useHandGeometry';

/**
 * Read-only version of the v2 mobile hand, used in spectator mode to show the
 * watched seat's cards face-up.
 *
 * A separate component rather than a `readOnly` flag on MobileHandV2 because
 * SortableHandCardV2 calls useSortable unconditionally - hooks can't be skipped.
 * Dropping DndContext also avoids touchAction:'none' on a view nobody drags.
 * Geometry and card face are shared, so the two stay visually identical.
 */
function SpectatorHandV2({ sortedHand, containerWidth, acc, fourColor, ownerName, geometry }) {
    const { width, height, marginLeft, typeScale } = useHandGeometry(sortedHand.length, containerWidth, geometry);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                background: 'rgba(0,0,0,.45)', borderRadius: 999, padding: '4px 12px',
            }}>
                <span style={{ fontSize: 12 }}>👁</span>
                <span style={{ color: 'rgba(244,245,247,.85)', fontSize: 12, fontWeight: 700 }}>
                    {ownerName ? `${ownerName}'s hand` : 'Spectating'}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: Math.max(126, height + 8), alignItems: 'flex-end', paddingBottom: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'center', minHeight: height }}>
                    {sortedHand.map((card, index) => (
                        <div
                            key={`${card.rank}-${card.suit}`}
                            style={{ marginLeft: index === 0 ? 0 : marginLeft, flexShrink: 0 }}
                        >
                            <HandCardFaceV2
                                card={card}
                                isSelected={false}
                                width={width}
                                height={height}
                                acc={acc}
                                fourColor={fourColor}
                                typeScale={typeScale}
                                readOnly
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default SpectatorHandV2;
