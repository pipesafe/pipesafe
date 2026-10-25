/**
 * Verifier - pluggable webhook signature verification
 *
 * Verification runs in the gateway against the EXACT raw request bytes
 * (HMAC schemes break on re-serialized JSON).
 *
 * Secrets are supplied by the caller as VALUES, not as references intake
 * resolves. Your IaC already provisions secrets; intake reads what it is
 * given. Pass `process.env.X!` for the common case, or a thunk when the
 * value must be fetched (and re-fetched, on rotation) at runtime.
 */
import { IntakeNotImplementedError } from "../errors";

/**
 * A secret value, or a resolver for one. A thunk is called per
 * verification, so rotating secrets work as long as the resolver caches to
 * taste - intake does no caching of its own.
 */
export type SecretValue = string | (() => string | Promise<string>);

export interface VerifyContext {
  /** Exact request body bytes as received. */
  rawBody: string;
  headers: Readonly<Record<string, string>>;
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
    _signingSecret: SecretValue,
    _opts?: { toleranceSeconds?: number }
  ): Verifier {
    return { scheme: "stripe", verify: notImplemented("stripe") };
  },

  /** Generic HMAC-SHA256 over the raw body, compared to a header value. */
  hmacSha256(
    _secret: SecretValue,
    _opts: { header: string; encoding?: "hex" | "base64"; prefix?: string }
  ): Verifier {
    return { scheme: "hmac-sha256", verify: notImplemented("hmacSha256") };
  },

  /** No verification - dev only. Envelopes store `verified: false`. */
  none(): Verifier {
    return {
      scheme: "none",
      verify: () => Promise.resolve({ accepted: true, verified: false }),
    };
  },

  /** Custom scheme escape hatch. */
  custom(scheme: string, verify: Verifier["verify"]): Verifier {
    return { scheme, verify };
  },
};
