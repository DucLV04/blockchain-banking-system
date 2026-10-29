// Student ID: xxxxx79 (A=9, B=7)
export const A = 9;
export const B = 7;

export const VARIANT = {
  gracePeriodSeconds: ((A % 3) + 2) * 86400, // (9 % 3) + 2 = 2 days
  defaultAprBps: 200 + A * 25,               // 200 + 225 = 425 bps (4.25%)
  earlyPenaltyBps: 300 + B * 50,             // 300 + 350 = 650 bps (6.5%)
  defaultTenorDays: B % 2 === 0 ? 90 : 180, // 7 is odd -> 180 days
} as const;

// Updated limits per user request
export const PLAN0_MIN_DEPOSIT = 5_000_000n;       // 5 USDC
export const PLAN0_MAX_DEPOSIT = 50_000_000_000n; // 50,000 USDC
