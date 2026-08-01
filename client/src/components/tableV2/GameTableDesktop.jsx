import { useState, useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { useRoundLog } from '../../hooks/useRoundLog';
import { useAvatars } from '../../hooks/useAvatars';
import useElementWidth from '../../hooks/useElementWidth';
import useElementSize from '../../hooks/useElementSize';
import { sortByRank } from '../../utils/cardUtils';
import TableBackground from './TableBackground';
import HudBar from './HudBar';
import ScoreCorner from './ScoreCorner';
import OpponentFanSeat from './OpponentFanSeat';
import CenterPile from './CenterPile';
import StatusBanner from './StatusBanner';
import ControlsRow from './ControlsRow';
import MobileHandV2 from './MobileHandV2';
import SpectatorHandV2 from './SpectatorHandV2';
import RoundLogDrawer from './RoundLogDrawer';
import RoundCelebration from './RoundCelebration';
import CoachBubble from './CoachBubble';
import VoiceControlBubble from '../VoiceControlBubble';
import { DESKTOP_LAYOUT, desktopHandCardWidth, desktopPileMetrics } from './layout';
import { sideFanStep } from './fanGeometry';

// Vertical space the absolutely-positioned HudBar occupies (top offset + row).
const HUD_HEIGHT = 72;

// Orchestrator for the v2 desktop in-game table. Takes exactly the same props
// as GameTableMobile — all game logic lives in GameRoom — and differs only in
// composition.
//
// A desktop screen has room the phone does not, and this table spends it on the
// table rather than on chrome:
//
//   - Opponents' hands are drawn as fans of real cards, one back per card held,
//     with no number. How close someone is to going out is a shape you see
//     rather than a digit you read. Spectators see the same fans face-up.
//   - The scoreboard is a corner panel that expands on hover, not a 244px rail.
//   - The round log opens as a slide-in panel when you click the pile, instead
//     of holding a 304px rail open for something consulted a few times a round.
//
// The felt those two rails gave back went to the pile and the hand.
function GameTableDesktop(props) {
    const {
        user, roomId, gameState, myPlayerId, fourColorMode, pusoyMode,
        sortedHand, myHand, selectedCards, toggleCard, handleSelectCards,
        playCards, passTurn, isSubmitting, isMyTurn, getRelativePlayer,
        canKickPlayer, handlePlayerClick,
        sortMode, isCustomOrder, handleSortClick,
        roundResult, nextRound, onOpenSettings, onCreateAccount,
        sensors, handleDragEnd,
        handContainerRef,
        voiceState,
        isSpectator, viewerIndex, spectatorHands, onSelectSeat, onOpenSpectators, coach,
    } = props;

    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const { log, pileTrickPlays, logIsPartial } = useRoundLog(gameState);
    const [logOpen, setLogOpen] = useState(false);

    // The hand sizes itself off the table column, not the window. GameRoom's
    // containerWidth is the mobile measurement and is deliberately ignored here.
    const [handAreaRef, handAreaWidth] = useElementWidth();
    // The column's height is the table's whole vertical budget, and the band is
    // what the pile and the side seats are left with once the top seat and the
    // bottom stack have taken theirs. Measuring both is what lets a short
    // viewport draw a smaller table instead of an overlapping one.
    const [columnRef, column] = useElementSize();
    const [bandRef, band] = useElementSize();

    const players = gameState.players || [];
    useAvatars(players.map(p => p.name));

    const seatTop = getRelativePlayer(2);
    const seatLeft = getRelativePlayer(3);
    const seatRight = getRelativePlayer(1);

    const lastPlayedHand = gameState.lastPlayedHand;
    const trickWinPending = gameState.trickWinPending;
    const mustBeat = !!lastPlayedHand && lastPlayedHand.playerId !== myPlayerId;

    const freeLead = isMyTurn && !lastPlayedHand && !trickWinPending;
    const isFirstLead = freeLead && gameState.roundNumber === 1 && log.length === 0;
    const showControlToast = freeLead && log.length > 0;

    const currentPlayer = players.find(p => p.id === gameState.currentTurn);
    const trickWinner = gameState.trickWinner
        ? players.find(p => p.id === gameState.trickWinner)?.name
        : null;

    const canPlay = !isSpectator && isMyTurn && selectedCards.length > 0 && !trickWinPending && !isSubmitting;
    const canPass = !isSpectator && isMyTurn && !!lastPlayedHand && !trickWinPending && !isSubmitting;
    const playLabel = canPlay ? `Play ${selectedCards.length}` : 'Play';

    // Both side fans use one step, so the seats stay level and read as a matched
    // pair. The longer of the two hands is what the band has to accommodate.
    const sideStep = sideFanStep(
        Math.max(seatLeft?.cardCount || 0, seatRight?.cardCount || 0),
        band.height
    );

    // The hand is sized off the column and the pile off the band that is left,
    // in that order — a smaller card is still a card, a pile you cannot read is
    // not a pile.
    const handGeometry = useMemo(
        () => ({ ...DESKTOP_LAYOUT.hand, maxCardWidth: desktopHandCardWidth(column.height) }),
        [column.height]
    );
    const pile = desktopPileMetrics(band.height);

    // Only a spectator is ever sent the other seats' cards; everyone else gets
    // backs. Sorted by rank so a watched hand can actually be read.
    const handFor = (player) => {
        if (!isSpectator || !player) return null;
        const hand = spectatorHands?.[player.id];
        return hand && hand.length ? sortByRank(hand) : null;
    };

    const rootStyle = useMemo(() => ({
        position: 'absolute', inset: 0, overflow: 'hidden',
        fontFamily: "'Outfit',ui-sans-serif,system-ui,sans-serif",
        '--cdd-acc': acc,
        '--cdd-acc-soft': soft,
    }), [acc, soft]);

    const seatProps = {
        acc, rm, fourColor: fourColorMode, pusoyMode, sideStep,
        // Spectators click a seat to watch it; hosts click to kick. The two
        // roles are mutually exclusive, so one handler serves both.
        onPlayerClick: isSpectator ? onSelectSeat : handlePlayerClick,
        hint: isSpectator ? 'Click to view' : null,
    };

    return (
        <div style={rootStyle}>
            <TableBackground surface={surface} soft={soft} />

            <HudBar
                roomId={roomId}
                gameMode={gameState.gameMode}
                roundNumber={gameState.roundNumber}
                // The corner scoreboard is always on screen and expands to show
                // everything the Info layer used to reveal, so there is nothing
                // left for the toggle to toggle.
                showInfo={false}
                onOpenSettings={onOpenSettings}
                isGuest={user?.isGuest}
                onCreateAccount={onCreateAccount}
                acc={acc}
                spectatorCount={gameState.spectators?.length || 0}
                onOpenSpectators={
                    (gameState.spectators?.length > 0 || isSpectator) ? onOpenSpectators : undefined
                }
                voiceControl={(
                    <VoiceControlBubble
                        username={user?.username}
                        voiceEnabled={voiceState?.voiceEnabled || false}
                        isVoiceConnected={voiceState?.isVoiceConnected || false}
                        isMuted={voiceState?.isMuted || false}
                        isDeafened={voiceState?.isDeafened || false}
                        forcedMute={voiceState?.forcedMute || false}
                        onToggleVoice={voiceState?.handleVoiceToggle}
                        onToggleMute={voiceState?.toggleMute}
                        onToggleDeafen={voiceState?.toggleDeafen}
                        onVolumeChange={voiceState?.handleVolumeChange}
                        players={players}
                        peers={voiceState?.peers || []}
                        playerVolumes={voiceState?.playerVolumes || {}}
                        size="hud"
                    />
                )}
            />

            <ScoreCorner
                players={players}
                myPlayerId={myPlayerId}
                currentTurn={gameState.currentTurn}
                pointThreshold={gameState.pointThreshold}
                acc={acc}
                side={DESKTOP_LAYOUT.scoreboard.side}
                top={DESKTOP_LAYOUT.scoreboard.top}
                inset={DESKTOP_LAYOUT.scoreboard.inset}
            />

            <div
                ref={columnRef}
                style={{
                    position: 'absolute', inset: 0, zIndex: 5,
                    paddingTop: HUD_HEIGHT, paddingLeft: 18, paddingRight: 18, paddingBottom: 14,
                    display: 'flex', flexDirection: 'column',
                    boxSizing: 'border-box',
                }}
            >
                {/* Table area: seats around the pile. Its own positioning
                    context, so DESKTOP_LAYOUT's offsets track this box rather
                    than the whole viewport. */}
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                    <OpponentFanSeat
                        player={seatTop}
                        position="top"
                        placement={DESKTOP_LAYOUT.seats.top}
                        cards={handFor(seatTop)}
                        isTurn={gameState.currentTurn === seatTop?.id}
                        isClickable={isSpectator ? !!seatTop : canKickPlayer(seatTop)}
                        {...seatProps}
                    />

                    {/* Everything that has to clear the top seat and the corner
                        scoreboard shares one band and is centred in it, so the
                        composition holds at any viewport height rather than
                        only at the one it was drawn at. */}
                    <div
                        ref={bandRef}
                        style={{ position: 'absolute', top: DESKTOP_LAYOUT.upperReserve, left: 0, right: 0, bottom: 0 }}
                    >
                        <OpponentFanSeat
                            player={seatLeft}
                            position="left"
                            placement={DESKTOP_LAYOUT.seats.left}
                            cards={handFor(seatLeft)}
                            isTurn={gameState.currentTurn === seatLeft?.id}
                            isClickable={isSpectator ? !!seatLeft : canKickPlayer(seatLeft)}
                            {...seatProps}
                        />
                        <OpponentFanSeat
                            player={seatRight}
                            position="right"
                            placement={DESKTOP_LAYOUT.seats.right}
                            cards={handFor(seatRight)}
                            isTurn={gameState.currentTurn === seatRight?.id}
                            isClickable={isSpectator ? !!seatRight : canKickPlayer(seatRight)}
                            {...seatProps}
                        />

                        <CenterPile
                            pilePlays={pileTrickPlays}
                            lastPlayedHand={lastPlayedHand}
                            players={players}
                            viewerIndex={viewerIndex}
                            fourColor={fourColorMode}
                            pusoyMode={pusoyMode}
                            accGrad={accGrad}
                            soft={soft}
                            rm={rm}
                            logCount={log.length + (log.length === 1 ? ' play' : ' plays')}
                            showControlToast={showControlToast}
                            onOpenLog={() => setLogOpen(true)}
                            hasLog={log.length > 0}
                            frame={DESKTOP_LAYOUT.pile.frame}
                            scale={pile.scale}
                            stackHeight={pile.stackHeight}
                            labelInside
                            reviewVerb="click"
                        />
                    </div>
                </div>

                {/* Bottom section: banner, controls and hand in normal flow,
                    so nothing needs a magic offset from the viewport edge. */}
                <div
                    ref={handAreaRef}
                    // `relative` only so the coach bubble can anchor to the
                    // top of this section; nothing else here is positioned.
                    style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 12, flexShrink: 0 }}
                >
                    <StatusBanner
                        isMyTurn={!isSpectator && isMyTurn && !trickWinPending}
                        mustBeat={!isSpectator && mustBeat}
                        trickWinPending={trickWinPending}
                        trickWinnerName={trickWinner}
                        currentPlayerName={currentPlayer?.name}
                        isFirstLead={isFirstLead}
                        acc={acc}
                        accGrad={accGrad}
                        rm={rm}
                        pusoyMode={pusoyMode}
                        placement={DESKTOP_LAYOUT.banner}
                    />

                    {isSpectator ? (
                        <SpectatorHandV2
                            sortedHand={sortedHand}
                            containerWidth={handAreaWidth}
                            acc={acc}
                            fourColor={fourColorMode}
                            pusoyMode={pusoyMode}
                            ownerName={getRelativePlayer(0)?.name}
                            geometry={handGeometry}
                        />
                    ) : (<>
                        <CoachBubble
                            message={coach?.enabled ? coach.message : null}
                            onDismiss={coach?.onDismiss}
                            fourColor={fourColorMode}
                            pusoyMode={pusoyMode}
                            acc={acc}
                            rm={rm}
                        />
                        <ControlsRow
                            playerHand={myHand}
                            lastPlayedHand={lastPlayedHand}
                            isMyTurn={isMyTurn}
                            isFirstLead={isFirstLead}
                            selectedCards={selectedCards}
                            onSelectCards={handleSelectCards}
                            sortMode={sortMode}
                            isCustomOrder={isCustomOrder}
                            onSortClick={handleSortClick}
                            canPlay={canPlay}
                            canPass={canPass}
                            playLabel={playLabel}
                            onPlay={playCards}
                            onPass={passTurn}
                            coach={coach}
                            acc={acc}
                            accGrad={accGrad}
                            rm={rm}
                        />
                        <MobileHandV2
                            sortedHand={sortedHand}
                            selectedCards={selectedCards}
                            onToggle={toggleCard}
                            sensors={sensors}
                            onDragEnd={handleDragEnd}
                            handContainerRef={handContainerRef}
                            containerWidth={handAreaWidth}
                            acc={acc}
                            fourColor={fourColorMode}
                            pusoyMode={pusoyMode}
                            geometry={handGeometry}
                        />
                    </>)}
                </div>
            </div>

            <RoundLogDrawer
                open={logOpen}
                log={log}
                partial={logIsPartial}
                acc={acc}
                fourColor={fourColorMode}
                pusoyMode={pusoyMode}
                rm={rm}
                onClose={() => setLogOpen(false)}
            />

            {roundResult && (
                <RoundCelebration
                    roundResult={roundResult}
                    pointThreshold={gameState.pointThreshold}
                    onNextRound={nextRound}
                    acc={acc}
                    accGrad={accGrad}
                    soft={soft}
                    rm={rm}
                />
            )}
        </div>
    );
}

export default GameTableDesktop;
