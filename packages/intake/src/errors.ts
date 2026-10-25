/**
 * Runtime errors for @pipesafe/intake.
 */

/**
 * Thrown by scaffold-phase method shells whose implementations land in
 * later phases (see packages/intake/ARCHITECTURE.md for the roadmap).
 */
export class IntakeNotImplementedError extends Error {
  constructor(feature: string) {
    super(
      `${feature} is not implemented yet - see packages/intake/ARCHITECTURE.md for the phased roadmap.`
    );
    this.name = "IntakeNotImplementedError";
  }
}
