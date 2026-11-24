import type { SVGProps } from 'react';

/** Small, original line-icon set (24px grid, 1.75 stroke). */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
});
const I = (d: React.ReactNode) => ({ size, ...p }: P) => <svg {...base(size)} {...p}>{d}</svg>;

export const IconHome = I(<><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>);
export const IconSend = I(<><path d="M4 12h13" /><path d="m12 6 6 6-6 6" /></>);
export const IconUsers = I(<><circle cx="9" cy="8.5" r="3.5" /><path d="M3 19.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" /><path d="M16 5.2a3.3 3.3 0 0 1 0 6.6" /><path d="M18 14.7c1.6.7 2.6 2.4 3 4.8" /></>);
export const IconList = I(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>);
export const IconExchange = I(<><path d="M4 8h13l-3.5-3.5" /><path d="M20 16H7l3.5 3.5" /></>);
export const IconPhone = I(<><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></>);
export const IconBell = I(<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconHelp = I(<><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3" /><path d="M12 16.8h.01" /></>);
export const IconShield = I(<><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>);
export const IconPlus = I(<><path d="M12 5v14M5 12h14" /></>);
export const IconChevronRight = I(<path d="m9 6 6 6-6 6" />);
export const IconChevronLeft = I(<path d="m15 6-6 6 6 6" />);
export const IconCheck = I(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconX = I(<><path d="M6 6l12 12M18 6 6 18" /></>);
export const IconAlert = I(<><path d="M12 4 21 19.5H3z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconInfo = I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconClock = I(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>);
export const IconDownload = I(<><path d="M12 4v11" /><path d="m7 10.5 5 5 5-5" /><path d="M5 20h14" /></>);
export const IconShare = I(<><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" /></>);
export const IconLogout = I(<><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H16" /></>);
export const IconEdit = I(<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>);
export const IconTrash = I(<><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>);
export const IconSearch = I(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconWallet = I(<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12.5h2" /><path d="M3 9.5h18" /></>);
