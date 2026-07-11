import { ButtonHTMLAttributes } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  small?: boolean;
}

export function PrimaryButton({ children, small = false, disabled, ...props }: PrimaryButtonProps) {
  return (
    <button
      className="transition-all"
      disabled={disabled}
      style={{
        background: disabled ? 'var(--graphite)' : 'var(--volt)',
        color: disabled ? 'var(--ghost)' : '#F0F4FF',
        borderRadius: 'var(--radius-btn)',
        fontFamily: "'Inter', sans-serif",
        fontSize: small ? '13px' : '14px',
        fontWeight: 500,
        lineHeight: '20px',
        padding: small ? '8px 12px' : '12px 24px',
        height: small ? '36px' : '44px',
        border: 'none',
        boxShadow: disabled ? 'none' : '0 0 20px var(--volt-glow)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, box-shadow 0.15s, opacity 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--volt-hover)';
          e.currentTarget.style.boxShadow = '0 0 28px var(--volt-glow)';
        }
      }}
      onMouseOut={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--volt)';
          e.currentTarget.style.boxShadow = '0 0 20px var(--volt-glow)';
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}

interface GhostButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  small?: boolean;
}

export function GhostButton({ children, small = false, disabled, ...props }: GhostButtonProps) {
  return (
    <button
      className="border transition-all"
      disabled={disabled}
      style={{
        background: 'transparent',
        borderRadius: 'var(--radius-btn)',
        borderColor: 'var(--rule)',
        color: 'var(--ash)',
        fontFamily: "'Inter', sans-serif",
        fontSize: small ? '13px' : '14px',
        fontWeight: 500,
        lineHeight: '20px',
        padding: small ? '8px 12px' : '12px 24px',
        height: small ? '36px' : '44px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.15s, color 0.15s, opacity 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'var(--volt)';
          e.currentTarget.style.color = 'var(--paper)';
        }
      }}
      onMouseOut={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'var(--rule)';
          e.currentTarget.style.color = 'var(--ash)';
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}
