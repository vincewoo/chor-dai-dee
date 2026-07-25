import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTableTheme } from '../../theme/tableTheme';
import { PICKER_ANIMALS, TILE_GRADS, NAME_POOLS, getAvatarChoice, saveAvatarChoice } from '../../utils/avatars';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// v2 mobile avatar picker. Mirrors the "Avatar Picker v2" mockup. Persists the
// choice to localStorage (no server avatar field yet) keyed to the current user.
function AvatarPickerV2({ username }) {
    const { acc, accGrad, soft, surface, rm } = useTableTheme();
    const navigate = useNavigate();

    const existing = getAvatarChoice();
    const initialAnimal = existing?.owner === username && existing.animal ? existing.animal : PICKER_ANIMALS[0];
    const initialTile = existing?.owner === username && Number.isInteger(existing.tile) ? existing.tile : 0;

    const [animal, setAnimal] = useState(initialAnimal);
    const [tile, setTile] = useState(initialTile);
    const [nameIdx, setNameIdx] = useState(0);

    const names = NAME_POOLS[animal] || [username];
    const previewName = names[nameIdx % names.length];

    const confirm = () => {
        saveAvatarChoice({ owner: username, animal, tile, name: previewName });
        navigate('/lobby');
    };

    return (
        <div
            className="relative h-full w-full overflow-y-auto overflow-x-hidden font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
        >
            <div className="absolute inset-0 pointer-events-none" style={{ background: surface.tint }} />
            <div className="absolute pointer-events-none" style={{ top: '-140px', left: '50%', transform: 'translateX(-50%)', width: 520, height: 340, borderRadius: '50%', background: `radial-gradient(ellipse,${soft},transparent 70%)` }} />
            <div className="absolute pointer-events-none select-none" style={{ top: 250, left: -46, fontSize: 190, lineHeight: 1, color: 'rgba(255,255,255,.035)', transform: 'rotate(-14deg)' }}>♠</div>
            <div className="absolute pointer-events-none select-none" style={{ top: 560, right: -52, fontSize: 210, lineHeight: 1, color: 'rgba(255,255,255,.03)', transform: 'rotate(12deg)' }}>♣</div>

            <div className="relative z-10 mx-auto flex min-h-full max-w-[440px] flex-col px-[22px] pb-safe-92 pt-safe-18">
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
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 22 }}>{previewName}</div>
                    <button
                        onClick={() => setNameIdx((i) => i + 1)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: 'rgba(244,245,247,.75)', fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                    >🎲 New name</button>
                </div>

                {/* Animal grid */}
                <div className="mt-7">
                    <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }}>PICK AN ANIMAL</div>
                    <div className="grid grid-cols-4 gap-[10px]">
                        {PICKER_ANIMALS.map((e, i) => {
                            const on = e === animal;
                            return (
                                <button
                                    key={e}
                                    onClick={() => { setAnimal(e); setNameIdx(0); }}
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
        </div>
    );
}

export default AvatarPickerV2;
