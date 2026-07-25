import { useState, useMemo } from 'react';
import { useTableTheme } from '../../theme/tableTheme';
import { useRoundLog } from '../../hooks/useRoundLog';
import TableBackground from './TableBackground';
import HudBar from './HudBar';
import ScoreStrip from './ScoreStrip';
import OpponentSeat from './OpponentSeat';
import CenterPile from './CenterPile';
import StatusBanner from './StatusBanner';
import ControlsRow from './ControlsRow';
import MobileHandV2 from './MobileHandV2';
import SpectatorHandV2 from './SpectatorHandV2';
import RoundLogSheet from './RoundLogSheet';
import RoundCelebration from './RoundCelebration';
import VoiceControlBubble from '../VoiceControlBubble';

// Orchestrator for the v2 mobile in-game table. Stateful game logic lives in
// GameRoom and arrives via props; only local UI state (info/log toggles) is here.
function GameTableMobile(props) {
    const {
        user, roomId, gameState, myPlayerId, fourColorMode,
        sortedHand, myHand, selectedCards, toggleCard, handleSelectCards,
        playCards, passTurn, isSubmitting, isMyTurn, getRelativePlayer,
        canKickPlayer, handlePlayerClick,
        sortMode, isCustomOrder, handleSortClick,
        roundResult, nextRound, onOpenSettings, onCreateAccount,
        sensors, handleDragStart, handleDragEnd,
        handContainerRef, handleTouchStart, handleTouchMove, handleTouchEnd,
        containerWidth, voiceState, voiceAudioLevels,
        isSpectator, viewerIndex, onSelectSeat, onOpenSpectators,
    } = props;

    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const { log, pileTrickPlays } = useRoundLog(gameState);
    const [infoOn, setInfoOn] = useState(false);
    const [logOpen, setLogOpen] = useState(false);

    const players = gameState.players || [];
    // viewerIndex is computed once in GameRoom and shared with CenterPile's
    // fly-in math, so seat rotation can't drift between the two.

    const seatTop = getRelativePlayer(2);
    const seatLeft = getRelativePlayer(3);
    const seatRight = getRelativePlayer(1);

    const lastPlayedHand = gameState.lastPlayedHand;
    const trickWinPending = gameState.trickWinPending;
    const mustBeat = !!lastPlayedHand && lastPlayedHand.playerId !== myPlayerId;

    // Free lead: it's my turn with no hand to beat.
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

    const rootStyle = useMemo(() => ({
        position: 'absolute', inset: 0, overflow: 'hidden',
        fontFamily: "'Outfit',ui-sans-serif,system-ui,sans-serif",
        // Accent CSS vars consumed by keyframes (cddGlow / cddPulse).
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
                        audioLevel={voiceAudioLevels?.[user?.username] || 0}
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

            {infoOn && <ScoreStrip players={players} acc={acc} rm={rm} />}

            {[
                { player: seatTop, position: 'top' },
                { player: seatLeft, position: 'left' },
                { player: seatRight, position: 'right' },
            ].map(({ player, position }) => (
                <OpponentSeat
                    key={position}
                    player={player}
                    position={position}
                    isTurn={gameState.currentTurn === player?.id}
                    infoOn={infoOn}
                    acc={acc}
                    rm={rm}
                    // Spectators tap a seat to sit in it; hosts tap to kick. The
                    // two roles are mutually exclusive, so one handler serves both.
                    onPlayerClick={isSpectator ? onSelectSeat : handlePlayerClick}
                    isClickable={isSpectator ? !!player : canKickPlayer(player)}
                    hint={isSpectator ? 'Tap to view' : null}
                    voiceLevel={voiceAudioLevels?.[player?.name] || 0}
                />
            ))}

            <CenterPile
                pilePlays={pileTrickPlays}
                lastPlayedHand={lastPlayedHand}
                players={players}
                viewerIndex={viewerIndex}
                fourColor={fourColorMode}
                accGrad={accGrad}
                soft={soft}
                rm={rm}
                logCount={log.length + (log.length === 1 ? ' play' : ' plays')}
                showControlToast={showControlToast}
                onOpenLog={() => setLogOpen(true)}
                hasLog={log.length > 0}
            />

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
            />

            {/* Bottom controls + hand. Spectators get the watched seat's hand
                face-up and no controls at all. */}
            <div style={{ position: 'absolute', bottom: 'calc(10px + env(safe-area-inset-bottom))', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, zIndex: 30 }}>
                {isSpectator ? (
                    <SpectatorHandV2
                        sortedHand={sortedHand}
                        containerWidth={containerWidth}
                        acc={acc}
                        fourColor={fourColorMode}
                        ownerName={getRelativePlayer(0)?.name}
                    />
                ) : (<>
                <ControlsRow
                    playerHand={myHand}
                    lastPlayedHand={lastPlayedHand}
                    isMyTurn={isMyTurn}
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
                    acc={acc}
                    accGrad={accGrad}
                    rm={rm}
                />
                <MobileHandV2
                    sortedHand={sortedHand}
                    selectedCards={selectedCards}
                    onToggle={toggleCard}
                    sensors={sensors}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    handContainerRef={handContainerRef}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    containerWidth={containerWidth}
                    acc={acc}
                    fourColor={fourColorMode}
                />
                </>)}
            </div>


            <RoundLogSheet
                open={logOpen}
                log={log}
                acc={acc}
                fourColor={fourColorMode}
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

export default GameTableMobile;
