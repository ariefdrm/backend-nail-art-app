const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export const DURATION_PATTERN = /^\d+[smhd]$/;

/** Parses "15m", "7d", "30s", "2h" into seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  const [, amount, unit] = match ?? [];
  if (!amount || !unit) throw new Error(`Invalid duration: "${value}" (use e.g. 15m, 7d)`);
  return Number(amount) * UNIT_SECONDS[unit as keyof typeof UNIT_SECONDS];
}
