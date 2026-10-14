// The Hindi dictionary for the screens: the exact English phrase -> Hindi. Loaded only for people who use Hindi (see app/layout.tsx).
// tests/unit/i18n-coverage.test.ts fails when the screens contain English text that is not in here.
import p1 from './p1.js';
import p2 from './p2.js';
import p3 from './p3.js';
import p4 from './p4.js';
import p5 from './p5.js';
import p6 from './p6.js';

export const HI = { ...p1, ...p2, ...p3, ...p4, ...p5, ...p6 };
