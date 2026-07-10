/**
 * SecretRef - named references to secrets
 *
 * Code declares secrets by NAME only; values are supplied at deploy time
 * (via deploy options or process.env) and written to the provider's secret
 * store (AWS: SSM Parameter Store SecureString). At runtime, functions
 * resolve references lazily through the provider's secret resolver and
 * cache them in the warm container. Secret values never appear in module
 * code, bundles, or Pulumi state written to MongoDB.
 */

/**
 * A named reference to a secret. Carries no value - only the name used to
 * locate the value in the provider's secret store.
 */
export interface SecretRef {
  readonly kind: "secret";
  readonly name: string;
}

/**
 * Create a {@link SecretRef} for the given secret name.
 *
 * @example
 * const signingSecret = secret("STRIPE_SIGNING_SECRET");
 */
export function secret(name: string): SecretRef {
  return { kind: "secret", name };
}
