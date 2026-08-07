import { useTableTheme } from '../../theme/tableTheme';
import ScreenShell, { ScreenBackdrop } from './ScreenShell';
import logoImage from '../../assets/chor-dai-dee-logo.webp';

// Presentational shell for every auth screen. Login.jsx owns all the state,
// validation and network calls; this file only decides how they look, so the
// five flows (login, register, and the three Google steps) share one frame.
export function AuthShell({ title, subtitle, error, children, footer }) {
    const { acc, soft, surface, rm } = useTableTheme();

    return (
        <ScreenShell
            className="relative h-full w-full font-sans"
            style={{ background: surface.base, fontFamily: "'Outfit',sans-serif", '--cdd-acc': acc, '--cdd-acc-soft': soft }}
            backdrop={
                <ScreenBackdrop
                    tint={surface.tint}
                    soft={soft}
                    glow={{ width: 560, height: 380, top: '-120px' }}
                    watermarks={[
                        { suit: 'S', size: 150, rotate: -14, style: { top: 180, left: -46 } },
                        { suit: 'H', size: 165, rotate: 12, opacity: 0.03, style: { top: 520, right: -52 } },
                    ]}
                />
            }
        >
            <div className="relative z-10 mx-auto flex min-h-full w-full max-w-[420px] flex-col justify-center px-[22px] py-10">
                <div className="flex flex-col items-center gap-2">
                    <img
                        src={logoImage}
                        alt="Chor Dai Dee"
                        style={{ width: 128, height: 128, filter: 'drop-shadow(0 14px 30px rgba(0,0,0,.5))', ...(rm ? {} : { animation: 'cddFloat 4s ease-in-out infinite' }) }}
                    />
                    <div style={{ color: '#f4f5f7', fontWeight: 800, fontSize: 22 }}>{title}</div>
                    {subtitle && (
                        <div className="text-center" style={{ color: 'rgba(244,245,247,.55)', fontSize: 13, fontWeight: 600 }}>{subtitle}</div>
                    )}
                </div>

                <div
                    className="mt-6 flex flex-col gap-3"
                    style={{
                        background: 'linear-gradient(160deg,rgba(0,0,0,.48),rgba(0,0,0,.3))',
                        border: '1px solid rgba(255,255,255,.1)',
                        borderRadius: 18,
                        padding: 18,
                        boxShadow: '0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.08)',
                    }}
                >
                    {error && (
                        <div
                            role="alert"
                            aria-live="polite"
                            style={{ background: 'rgba(224,67,79,.16)', border: '1px solid rgba(255,141,150,.4)', borderRadius: 12, padding: '9px 12px', color: '#ff8d96', fontSize: 13, fontWeight: 600 }}
                        >
                            {error}
                        </div>
                    )}
                    {children}
                </div>

                {footer && <div className="mt-4 text-center">{footer}</div>}
            </div>
        </ScreenShell>
    );
}

export function Field({ id, label, hint, ...props }) {
    return (
        <label htmlFor={id} className="flex flex-col gap-[6px]">
            <span style={{ color: 'rgba(244,245,247,.5)', fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>
                {label.toUpperCase()}
            </span>
            <input
                id={id}
                style={{
                    boxSizing: 'border-box', width: '100%', height: 46,
                    background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.16)',
                    borderRadius: 12, padding: '0 14px', color: '#f4f5f7',
                    fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 15, outline: 'none',
                }}
                {...props}
            />
            {hint && (
                <span style={{ color: 'rgba(244,245,247,.4)', fontSize: 11, fontWeight: 600 }}>{hint}</span>
            )}
        </label>
    );
}

// `variant` picks the emphasis: primary is the accent gradient, secondary an
// outlined panel button, ghost a bare text link.
export function AuthButton({ variant = 'primary', children, ...props }) {
    const { acc, accGrad, soft } = useTableTheme();
    const base = {
        width: '100%', borderRadius: 14, fontFamily: "'Outfit',sans-serif",
        fontWeight: 800, cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.7 : 1,
    };
    const styles = {
        primary: { ...base, padding: '15px 0', border: 'none', background: accGrad, color: '#0b0d10', fontSize: 16, boxShadow: `0 10px 24px ${soft},inset 0 1px 0 rgba(255,255,255,.3)` },
        secondary: { ...base, padding: '13px 0', border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.38)', color: '#f4f5f7', fontSize: 15 },
        ghost: { ...base, padding: '8px 0', border: 'none', background: 'none', color: acc, fontSize: 13, fontWeight: 700 },
    };
    return <button style={styles[variant]} {...props}>{children}</button>;
}

export function Divider({ label = 'OR' }) {
    return (
        <div className="flex items-center gap-3">
            <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.12)' }} />
            <span style={{ color: 'rgba(244,245,247,.4)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5 }}>{label}</span>
            <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,.12)' }} />
        </div>
    );
}
