export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export type LoginAttemptRecord = {
  succeeded: boolean;
  createdAt: Date;
};

export type LockoutState = { locked: false } | { locked: true; retryAt: Date };

/**
 * Sign-in is blocked after LOCKOUT_MAX_FAILURES failed attempts in a row within the last
 * LOCKOUT_WINDOW_MS. A successful sign-in starts the count again. The block ends when the
 * oldest of the counted failures falls out of the window.
 */
export function evaluateLockout(attempts: readonly LoginAttemptRecord[], now: Date): LockoutState {
  const windowStart = now.getTime() - LOCKOUT_WINDOW_MS;
  const recent = attempts
    .filter((attempt) => {
      const time = attempt.createdAt.getTime();
      return time > windowStart && time <= now.getTime();
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const failures: Date[] = [];
  for (const attempt of recent) {
    if (attempt.succeeded) break;
    failures.push(attempt.createdAt);
  }

  if (failures.length < LOCKOUT_MAX_FAILURES) {
    return { locked: false };
  }

  const oldestCounted = failures[LOCKOUT_MAX_FAILURES - 1];
  return { locked: true, retryAt: new Date(oldestCounted.getTime() + LOCKOUT_WINDOW_MS) };
}
