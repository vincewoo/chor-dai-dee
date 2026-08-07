import { useTableTheme } from '../../theme/tableTheme';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// Presentational frame for the profile page, following the same split as the
// auth screens: Profile.jsx owns all state, validation and network calls, this
// file only decides how they look. The page is a stack of independent cards
// because each one is its own form with its own success and failure -- changing
// a username should not clear what you typed into the password fields.

const FONT = "'Outfit',sans-serif";
const TEXT = '#f4f5f7';
const MUTED = 'rgba(244,245,247,.55)';

export function ProfileShell({ title, subtitle, onBack, children }) {
    const { acc, soft, surface } = useTableTheme();

    return (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: FONT, '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    watermarks={[
                        { suit: 'S', size: 150, rotate: -14, style: { top: 250, left: -46 } },
                        { suit: 'D', size: 165, rotate: 12, opacity: 0.03, style: { top: 460, right: -52 } },
                    ]}
                />
            }
        >
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[440px] flex-col px-[22px] pb-safe-92 pt-safe-18 md:max-w-[560px] md:px-8">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[9px] min-w-0">
                        <button
                            onClick={onBack}
                            aria-label="Back"
                            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.38)', color: TEXT, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >‹</button>
                        <div className="min-w-0">
                            <div className="truncate" style={{ color: TEXT, fontWeight: 800, fontSize: 17 }}>{title}</div>
                            {subtitle && (
                                <div className="truncate" style={{ color: MUTED, fontSize: 12, fontWeight: 600 }}>{subtitle}</div>
                            )}
                        </div>
                    </div>
                    <img src={logoImage} alt="Chor Dai Dee" style={{ flexShrink: 0, width: 32, height: 32, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.4))' }} />
                </div>

                <div className="mt-5 flex flex-col gap-4">{children}</div>
            </div>
        </ScreenShell>
    );
}

// One settings card. `status` is the card's own result line, so a success in
// one section does not read as a success in the one below it.
export function Section({ title, description, status, children }) {
    return (
        <section
            className="flex flex-col gap-3"
            style={{
                background: 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 18,
                padding: 18,
                boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
            }}
        >
            <div>
                <h2 style={{ color: TEXT, fontWeight: 800, fontSize: 15 }}>{title}</h2>
                {description && (
                    <p style={{ color: MUTED, fontSize: 12, fontWeight: 600, marginTop: 3 }}>{description}</p>
                )}
            </div>
            {status && <StatusLine kind={status.kind}>{status.message}</StatusLine>}
            {children}
        </section>
    );
}

export function StatusLine({ kind = 'error', children }) {
    const ok = kind === 'success';
    return (
        <div
            role={ok ? 'status' : 'alert'}
            aria-live="polite"
            style={{
                background: ok ? 'rgba(110,231,168,.14)' : 'rgba(224,67,79,.16)',
                border: `1px solid ${ok ? 'rgba(110,231,168,.4)' : 'rgba(255,141,150,.4)'}`,
                borderRadius: 12,
                padding: '9px 12px',
                color: ok ? '#6ee7a8' : '#ff8d96',
                fontSize: 13,
                fontWeight: 600,
            }}
        >
            {children}
        </div>
    );
}

// A labelled fact with an optional action on the right -- the linked-Google row
// and the avatar shortcut.
export function InfoRow({ label, value, tone = 'default', action }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <div style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>
                    {label.toUpperCase()}
                </div>
                <div
                    className="truncate"
                    style={{ color: tone === 'muted' ? MUTED : TEXT, fontSize: 14, fontWeight: 700, marginTop: 2 }}
                >
                    {value}
                </div>
            </div>
            {action}
        </div>
    );
}

export default ProfileShell;
