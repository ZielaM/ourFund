import { describe, expect, it } from "vitest";
import {
  evaluateLockout,
  LOCKOUT_MAX_FAILURES,
  LOCKOUT_WINDOW_MS,
  type LoginAttemptRecord,
} from "./lockout";

const now = new Date("2026-11-12T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const failure = (minutes: number): LoginAttemptRecord => ({
  succeeded: false,
  createdAt: minutesAgo(minutes),
});
const success = (minutes: number): LoginAttemptRecord => ({
  succeeded: true,
  createdAt: minutesAgo(minutes),
});

describe("evaluateLockout", () => {
  it("does not lock an account without attempts", () => {
    expect(evaluateLockout([], now)).toEqual({ locked: false });
  });

  it("allows one fewer failure than the limit", () => {
    const attempts = [failure(1), failure(2), failure(3), failure(4)];

    expect(attempts).toHaveLength(LOCKOUT_MAX_FAILURES - 1);
    expect(evaluateLockout(attempts, now)).toEqual({ locked: false });
  });

  it("locks after the limit of consecutive failures", () => {
    const attempts = [failure(1), failure(2), failure(3), failure(4), failure(5)];

    expect(evaluateLockout(attempts, now)).toEqual({
      locked: true,
      retryAt: new Date(minutesAgo(5).getTime() + LOCKOUT_WINDOW_MS),
    });
  });

  it("unlocks when the oldest counted failure leaves the window", () => {
    const attempts = [failure(1), failure(2), failure(3), failure(4), failure(5)];
    const state = evaluateLockout(attempts, now);

    expect(state.locked).toBe(true);
    if (state.locked) {
      expect(evaluateLockout(attempts, state.retryAt)).toEqual({ locked: false });
      expect(evaluateLockout(attempts, new Date(state.retryAt.getTime() - 1)).locked).toBe(true);
    }
  });

  it("ignores failures older than the window", () => {
    const attempts = [failure(1), failure(2), failure(3), failure(4), failure(16)];

    expect(evaluateLockout(attempts, now)).toEqual({ locked: false });
  });

  it("starts counting again after a successful sign-in", () => {
    const attempts = [failure(1), failure(2), success(3), failure(4), failure(5), failure(6)];

    expect(evaluateLockout(attempts, now)).toEqual({ locked: false });
  });

  it("measures the lock from the fifth most recent failure when there are more", () => {
    const attempts = [failure(1), failure(2), failure(3), failure(4), failure(5), failure(9)];
    const state = evaluateLockout(attempts, now);

    expect(state).toEqual({
      locked: true,
      retryAt: new Date(minutesAgo(5).getTime() + LOCKOUT_WINDOW_MS),
    });
  });

  it("does not depend on the order of the records", () => {
    const attempts = [failure(4), failure(1), failure(5), failure(3), failure(2)];

    expect(evaluateLockout(attempts, now).locked).toBe(true);
  });

  it("ignores records dated in the future", () => {
    const attempts = [failure(-1), failure(1), failure(2), failure(3), failure(4)];

    expect(evaluateLockout(attempts, now)).toEqual({ locked: false });
  });
});
