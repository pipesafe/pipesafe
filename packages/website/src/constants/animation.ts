export const ANIMATION_CONFIG = {
  /** LSP response time (realistic) */
  COMPILE_START: 400,
  /** Time between each error appearing */
  COMPILE_STAGGER: 120,
  /** Start showing "Deploying..." almost immediately */
  DEPLOY_START: 100,
  /** CI/CD pipeline simulation */
  DEPLOY_DURATION: 2500,
  /** Actual query is ~2ms, but show briefly */
  RUN_DURATION: 400,
  /** Brief pause before error appears */
  ERROR_DELAY: 150,
  /** How long cursor blinks before fix */
  FIX_CURSOR_DURATION: 600,
  /** Time between each fix */
  FIX_STAGGER: 1200,
} as const;

export type AnimationConfig = typeof ANIMATION_CONFIG;
