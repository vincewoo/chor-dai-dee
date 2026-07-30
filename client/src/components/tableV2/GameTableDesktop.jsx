import { useState, useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { useRoundLog } from '../../hooks/useRoundLog';
import { useAvatars } from '../../hooks/useAvatars';
import { useIsWide } from '../../hooks/useMediaQuery';
import useElementWidth from '../../hooks/useElementWidth';
import TableBackground from './TableBackground';
import HudBar from './HudBar';
import ScoreStrip from './ScoreStrip';
import ScorePanel from './ScorePanel';
import OpponentSeat from './OpponentSeat';
import CenterPile from './CenterPile';
import StatusBanner from './StatusBanner';
import ControlsRow from './ControlsRow';
import MobileHandV2 from './MobileHandV2';
import SpectatorHandV2 from './SpectatorHandV2';
import RoundLogSheet from './RoundLogSheet';
import RoundLogPanel from './RoundLogPanel';
import RoundCelebration from './RoundCelebration';
import CoachBubble from './CoachBubble';
import VoiceControlBubble from '../VoiceControlBubble';
import { DESKTOP_LAYOUT, SCORE_RAIL_WIDTH, LOG_RAIL_WIDTH } from './layout';

// Vertical space the absolutely-positioned HudBar occupies (top offset + row).
const HUD_HEIGHT = 72;

// Orchestrator for the v2 desktop in-game table. Takes exactly the same props
// as GameTableMobile — all game logic lives in GameRoom — and differs only in
// composition: a three-column grid whose outer rails hold the scoreboard and
// the round log permanently.
//
// Below `useIsWide` those rails would crowd the table, so they drop out and the
// screen falls back to the mobile affordances for the same information: the
// HUD's Info toggle (ScoreStrip) and the tap-to-open RoundLogSheet.
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
        isSpectator, viewerIndex, onSelectSeat, onOpenSpectators, coach,
    } = props;

    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const { log, pileTrickPlays } = useRoundLog(gameState);
    const wide = useIsWide();
    const [infoOn, setInfoOn] = useState(false);
    const [logOpen, setLogOpen] = useState(false);

    // The hand sizes itself off the centre column, not the window: the rails
    // take width the fan can't use. GameRoom's containerWidth is the mobile
    // measurement and is deliberately ignored here.
    const [handAreaRef, handAreaWidth] = useElementWidth();

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

    // With the log rail on screen there is nothing to open, so the pile stops
    // being a button.
    const sheetIsTheLog = !wide;
    const hasLog = sheetIsTheLog && log.length > 0;

    const rootStyle = useMemo(() => ({
        position: 'absolute', inset: 0, overflow: 'hidden',
        fontFamily: "'Outfit',ui-sans-serif,system-ui,sans-serif",
        '--cdd-acc': acc,
        '--cdd-acc-soft': soft,
    }), [acc, soft]);

    return (
        <div style={rootStyle}>
            <TableBackground surface={surface} soft={soft} />

            <HudBar
                roomId={roomId}
                gameMode={gameState.gameMode}
                roundNumber={gameState.roundNumber}
                infoOn={infoOn}
                onToggleInfo={() => setInfoOn(v => !v)}
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

            {/* Without the score rail, the scores fall back to the Info overlay. */}
            {!wide && infoOn && <ScoreStrip players={players} acc={acc} rm={rm} />}

            <div
                style={{
                    position: 'absolute', inset: 0, zIndex: 5,
                    paddingTop: HUD_HEIGHT, paddingLeft: 18, paddingRight: 18, paddingBottom: 14,
                    display: 'grid', gap: 18,
                    gridTemplateColumns: wide
                        ? `${SCORE_RAIL_WIDTH}px minmax(0,1fr) ${LOG_RAIL_WIDTH}px`
                        : 'minmax(0,1fr)',
                    boxSizing: 'border-box',
                }}
            >
                {wide && (
                    <ScorePanel
                        players={players}
                        myPlayerId={myPlayerId}
                        currentTurn={gameState.currentTurn}
                        pointThreshold={gameState.pointThreshold}
                        acc={acc}
                    />
                )}

                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                    {/* Table area: seats around the pile. Its own positioning
                        context, so DESKTOP_LAYOUT's percentages track this box
                        rather than the whole viewport. */}
                    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                        {[
                            { player: seatTop, position: 'top' },
                            { player: seatLeft, position: 'left' },
                            { player: seatRight, position: 'right' },
                        ].map(({ player, position }) => (
                            <OpponentSeat
                                key={position}
                                player={player}
                                position={position}
                                placement={DESKTOP_LAYOUT.seats[position]}
                                size={DESKTOP_LAYOUT.seats.size}
                                isTurn={gameState.currentTurn === player?.id}
                                infoOn={infoOn}
                                acc={acc}
                                rm={rm}
                                onPlayerClick={isSpectator ? onSelectSeat : handlePlayerClick}
                                isClickable={isSpectator ? !!player : canKickPlayer(player)}
                                hint={isSpectator ? 'Click to view' : null}
                            />
                        ))}

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
                            hasLog={hasLog}
                            frame={DESKTOP_LAYOUT.pile.frame}
                            scale={DESKTOP_LAYOUT.pile.scale}
                            stackHeight={DESKTOP_LAYOUT.pile.stackHeight}
                        />
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
                                geometry={DESKTOP_LAYOUT.hand}
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
                                geometry={DESKTOP_LAYOUT.hand}
                            />
                        </>)}
                    </div>
                </div>

                {wide && <RoundLogPanel log={log} acc={acc} fourColor={fourColorMode} pusoyMode={pusoyMode} />}
            </div>

            {sheetIsTheLog && (
                <RoundLogSheet
                    open={logOpen}
                    log={log}
                    acc={acc}
                    fourColor={fourColorMode}
                    pusoyMode={pusoyMode}
                    rm={rm}
                    onClose={() => setLogOpen(false)}
                />
            )}

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
