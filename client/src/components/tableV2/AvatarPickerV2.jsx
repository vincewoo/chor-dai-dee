import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTableTheme } from '../../theme/tableTheme';
import { PICKER_ANIMALS, TILE_GRADS, AVATAR_NAMES, getAvatarChoice, saveAvatarChoice, persistAvatarChoice } from '../../utils/avatars';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 mobile avatar picker. Mirrors the "Avatar Picker v2" mockup. The choice is
// saved to the account so every other player sees it, and mirrored into
// localStorage so it renders instantly here (and at all for guests, who have no
// account to attach it to).
function AvatarPickerV2({ user }) {
    const username = user?.username;
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const navigate = useNavigate();

    const existing = getAvatarChoice();
    const initialAnimal = existing?.owner === username && existing.animal ? existing.animal : PICKER_ANIMALS[0];
    const initialTile = existing?.owner === username && Number.isInteger(existing.tile) ? existing.tile : 0;

    const [animal, setAnimal] = useState(initialAnimal);
    const [tile, setTile] = useState(initialTile);
    const avatarName = AVATAR_NAMES[animal];

    const confirm = () => {
        saveAvatarChoice({ owner: username, animal, tile });
        // Fire-and-forget: the local save already drives this session's UI, and
        // a failed upload is retried by the next sync on startup.
        persistAvatarChoice(user, { animal, tile });
        navigate('/lobby');
    };

    return (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    watermarks={[
                        { suit: 'S', size: 150, rotate: -14, style: { top: 250, left: -46 } },
                        { suit: 'C', size: 165, rotate: 12, opacity: 0.03, style: { top: 460, right: -52 } },
                    ]}
                />
            }
        >
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-92 pt-safe-18 md:max-w-[720px] md:px-8">
                {/* HUD */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px]">
                        <button
                            onClick={() => navigate('/lobby')}
                            aria-label="Back"
                            style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 17 }}>Choose your animal</div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>

                {/* Preview */}
                <div className="mt-6 flex flex-col items-center gap-[10px]">
                    <div style={{ width: 108, height: 108, borderRadius: 28, background: TILE_GRADS[tile], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 62, boxShadow: `0 0 40px ${soft},0 18px 40px rgba(0,0,0,.5)`, ...(rm ? {} : { animation: 'cddWiggle 2.4s ease-in-out infinite' }) }}>{animal}</div>
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 22 }}>{avatarName}</div>
                </div>

                {/* Animal grid */}
                <div className="mt-7">
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }}>PICK AN ANIMAL</div>
                    <div className="grid grid-cols-4 gap-[10px] md:grid-cols-6 md:gap-3">
                        {PICKER_ANIMALS.map((e, i) => {
                            const on = e === animal;
                            return (
                                <button
                                    key={e}
                                    onClick={() => setAnimal(e)}
                                    aria-label={AVATAR_NAMES[e]}
                                    aria-pressed={on}
                                    style={{ aspectRatio: '1', borderRadius: 16, border: `2px solid ${on ? acc : 'rgba(255,255,255,.14)'}`, background: TILE_GRADS[i % TILE_GRADS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, cursor: 'pointer', boxShadow: on ? `0 0 18px ${soft}` : '0 5px 12px rgba(0,0,0,.3)', transform: `scale(${on ? 1.08 : 1})`, transition: 'transform .15s,border-color .15s', padding: 0 }}
                                >{e}</button>
                            );
                        })}
                    </div>
                </div>

                {/* Tile colour */}
                <div className="mt-6">
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }}>TILE COLOUR</div>
                    <div className="flex gap-[10px]">
                        {TILE_GRADS.map((grad, i) => {
                            const on = i === tile;
                            return (
                                <button
                                    key={i}
                                    onClick={() => setTile(i)}
                                    aria-label={`Tile colour ${i + 1}`}
                                    style={{ flex: 1, height: 44, borderRadius: 13, border: `2px solid ${on ? acc : 'rgba(255,255,255,.16)'}`, background: grad, cursor: 'pointer', boxShadow: on ? `0 0 14px ${soft}` : 'none', padding: 0 }}
                                />
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Confirm */}
            <div className="absolute inset-x-0 z-20 px-[22px]" style={{ bottom: 26 }}>
                <button
                    onClick={confirm}
                    style={{ display: 'block', width: '100%', textAlign: 'center', padding: '16px 0', borderRadius: 14, border: 'none', background: accGrad, color: '#0b0d10', fontWeight: 800, fontSize: 17, boxShadow: `0 10px 24px ${soft},inset 0 1px 0 rgba(255,255,255,.3)`, cursor: 'pointer', fontFamily: "'Outfit',sans-serif" }}
                >That's me!</button>
            </div>
        </ScreenShell>
    );
}

export default AvatarPickerV2;
