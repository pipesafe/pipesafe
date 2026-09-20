/**
 * Verifier - pluggable webhook signature verification
 *
 * Verification runs in the gateway against the EXACT raw request bytes
 * (HMAC schemes break on re-serialized JSON). Schemes declare the secrets
 * they need as SecretRefs so deploys know what to provision; values are
 * resolved lazily at runtime.
 */
import type { SecretRef } from "@pipesafe/infra";
import { IntakeNotImplementedError } from "../errors";

export interface VerifyContext {
  /** Exact request body bytes as received. */
  rawBody: string;
  headers: Readonly<Record<string, string>>;
  getSecret(ref: SecretRef): Promise<string>;
}

/**
 * Decouples "accept the request" from "a signature was verified", so
 * schemes like `none` can accept dev traffic while the envelope honestly
 * records `verified: false`.
 */
export interface VerifyResult {
  /** Accept the request? The gateway rejects (401) when false. */
  accepted: boolean;
  /** Recorded on the envelope: did signature verification actually pass? */
  verified: boolean;
}

export interface Verifier {
  /** e.g. "stripe", "hmac-sha256", "none", or a custom scheme name. */
  readonly scheme: string;
  /** Declared so deploys know which secrets to provision. */
  readonly secretRefs: readonly SecretRef[];
  verify(ctx: VerifyContext): Promise<VerifyResult>;
}

const notImplemented = (scheme: string): Verifier["verify"] => {
  return () => {
    throw new IntakeNotImplementedError(`verifiers.${scheme}`);
  };
};

/**
 * Built-in verification schemes. Implementations land in Phase 1; the
 * factories are fully typed now so webhook declarations compile.
 */
export const verifiers = {
  /** Stripe-Signature v1 HMAC with timestamp tolerance. */
  stripe(
    signingSecret: SecretRef,
    _opts?: { toleranceSeconds?: number }
  ): Verifier {
    return {
      scheme: "stripe",
      secretRefs: [signingSecret],
      verify: notImplemented("stripe"),
    };
  },

  /** Generic HMAC-SHA256 over the raw body, compared to a header value. */
  hmacSha256(
    secret: SecretRef,
    _opts: { header: string; encoding?: "hex" | "base64"; prefix?: string }
  ): Verifier {
    return {
      scheme: "hmac-sha256",
      secretRefs: [secret],
      verify: notImplemented("hmacSha256"),
    };
  },

  /** No verification - dev only. Envelopes store `verified: false`. */
  none(): Verifier {
    return {
      scheme: "none",
      secretRefs: [],
      verify: () => Promise.resolve({ accepted: true, verified: false }),
    };
  },

  /** Custom scheme escape hatch. */
  custom(
    scheme: string,
    secretRefs: readonly SecretRef[],
    verify: Verifier["verify"]
  ): Verifier {
    return { scheme, secretRefs, verify };
  },
};
