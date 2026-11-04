import type { Tier } from '../../lib/types';

/**
 * Shape carries the meaning as well as color:
 * clean = circle + check, minor = triangle + !, risk = octagon (stop sign) + ×, unknown = circle + ?
 */
export function TierIcon({ tier, size = 20, title }: { tier: Tier; size?: number; title?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', role: title ? 'img' : undefined, 'aria-hidden': title ? undefined : true };
  const t = title ? <title>{title}</title> : null;
  switch (tier) {
    case 'clean':
      return (
        <svg {...common} className="tier-icon tier-clean">
          {t}
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <path d="M7 12.4l3.2 3.2L17 8.8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'minor':
      return (
        <svg {...common} className="tier-icon tier-minor">
          {t}
          <path d="M12 1.8c.6 0 1.1.3 1.4.8l9.7 17.1c.6 1.1-.2 2.4-1.4 2.4H2.3c-1.2 0-2-1.3-1.4-2.4L10.6 2.6c.3-.5.8-.8 1.4-.8z" fill="currentColor" />
          <path d="M12 8.2v6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="12" cy="18" r="1.5" fill="#fff" />
        </svg>
      );
    case 'risk':
      return (
        <svg {...common} className="tier-icon tier-risk">
          {t}
          <path d="M7.4 1h9.2L23 7.4v9.2L16.6 23H7.4L1 16.6V7.4z" fill="currentColor" />
          <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="tier-icon tier-unknown">
          {t}
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <path d="M9.4 9.3a2.7 2.7 0 1 1 3.8 2.5c-.8.4-1.2 1-1.2 1.8v.6" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
          <circle cx="12" cy="17.6" r="1.4" fill="#fff" />
        </svg>
      );
  }
}
