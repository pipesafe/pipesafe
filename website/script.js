// Animation Configuration
const ANIMATION_CONFIG = {
  COMPILE_START: 400, // LSP response time (realistic)
  COMPILE_STAGGER: 120, // Time between each error appearing
  DEPLOY_START: 100, // Start showing "Deploying..." almost immediately
  DEPLOY_DURATION: 2500, // CI/CD pipeline simulation
  RUN_DURATION: 400, // Actual query is ~2ms, but show briefly
  ERROR_DELAY: 150, // Brief pause before error appears
  FIX_DELAY: 10000, // 10 seconds after errors appear
  FIX_CURSOR_DURATION: 600, // How long cursor blinks before fix
  FIX_STAGGER: 1200, // Time between each fix
};

// Animation State Management
let animationTimeouts = [];
let hasAnimatedRuntime = false;
let hasAnimatedCompile = false;

function clearAnimations() {
  animationTimeouts.forEach((timeout) => clearTimeout(timeout));
  animationTimeouts = [];
}

function resetState() {
  // Hide replay button
  DOM.replayContainer.classList.remove("visible");

  // Reset runtime terminal
  DOM.deployingIndicator.classList.remove("visible", "done");
  DOM.runningIndicator.classList.remove("visible", "done");
  DOM.runtimeErrors.classList.remove("visible");
  DOM.runtimeErrorMsg.classList.remove("visible");
  DOM.runtimeErrorNote.classList.remove("visible");

  // Reset compile terminal
  DOM.compileErrors.classList.remove("visible");
  DOM.compileSuccess.classList.remove("visible");
  DOM.allClear.classList.remove("visible");
  DOM.compileSection.classList.remove("shrunk");
  DOM.fixBtn.classList.remove("visible", "hidden");

  // Reset error underlines
  document.querySelectorAll(".error-underline").forEach((el) => {
    el.classList.remove("active");
  });

  // Reset error lines
  document.querySelectorAll(".error-line, .error-detail").forEach((el) => {
    el.classList.remove("visible", "fade-out");
  });

  // Reset fixable code
  document.querySelectorAll(".fixable-code").forEach((el) => {
    el.classList.remove("is-fixed");
  });

  // Reset cursors
  document.querySelectorAll(".code-cursor").forEach((el) => {
    el.classList.remove("visible");
  });
}

// DOM Element Cache - avoid repeated lookups
const DOM = {
  replayContainer: null,
  deployingIndicator: null,
  runningIndicator: null,
  runtimeErrors: null,
  runtimeErrorMsg: null,
  runtimeErrorNote: null,
  compileErrors: null,
  compileSuccess: null,
  allClear: null,
  compileSection: null,
  fixBtn: null,
};

function initDOMCache() {
  DOM.replayContainer = document.getElementById("replay-container");
  DOM.deployingIndicator = document.getElementById("deploying-indicator");
  DOM.runningIndicator = document.getElementById("running-indicator");
  DOM.runtimeErrors = document.getElementById("runtime-errors");
  DOM.runtimeErrorMsg = document.getElementById("runtime-error-msg");
  DOM.runtimeErrorNote = document.getElementById("runtime-error-note");
  DOM.compileErrors = document.getElementById("compile-errors");
  DOM.compileSuccess = document.getElementById("compile-success");
  DOM.allClear = document.getElementById("all-clear");
  DOM.compileSection = document.getElementById("compile-section");
  DOM.fixBtn = document.getElementById("fix-btn");
}

// Animation Functions
function showReplayButton() {
  DOM.replayContainer.classList.add("visible");
}

function animateFixing(startTime) {
  const fixes = [1, 2, 3, 4];

  fixes.forEach((fixNum, index) => {
    const fixTime = startTime + index * ANIMATION_CONFIG.FIX_STAGGER;

    // Show cursor
    animationTimeouts.push(
      setTimeout(() => {
        // Hide previous cursor if any
        document
          .querySelectorAll(".code-cursor")
          .forEach((c) => c.classList.remove("visible"));

        const cursor = document.querySelector(
          `.code-cursor[data-cursor="${fixNum}"]`
        );
        if (cursor) cursor.classList.add("visible");
      }, fixTime)
    );

    // Apply fix
    animationTimeouts.push(
      setTimeout(() => {
        // Fix the code
        const fixable = document.querySelector(
          `.fixable-code[data-fix="${fixNum}"]`
        );
        if (fixable) fixable.classList.add("is-fixed");

        // Remove the underline
        const underline = document.querySelector(
          `.error-underline[data-error="${fixNum}"]`
        );
        if (underline) underline.classList.remove("active");

        // Fade out the error
        const errorLine = document.querySelector(
          `.error-line[data-error="${fixNum}"]`
        );
        const errorDetail = document.querySelector(
          `.error-detail[data-error="${fixNum}"]`
        );
        if (errorLine) errorLine.classList.add("fade-out");
        if (errorDetail) errorDetail.classList.add("fade-out");
      }, fixTime + ANIMATION_CONFIG.FIX_CURSOR_DURATION)
    );
  });

  // After all fixes, show "No errors", hide cursor, and shrink section
  const allFixedTime =
    startTime +
    fixes.length * ANIMATION_CONFIG.FIX_STAGGER +
    ANIMATION_CONFIG.FIX_CURSOR_DURATION +
    300;
  animationTimeouts.push(
    setTimeout(() => {
      document
        .querySelectorAll(".code-cursor")
        .forEach((c) => c.classList.remove("visible"));
      DOM.compileSection.classList.add("shrunk");
      DOM.allClear.classList.add("visible");
    }, allFixedTime)
  );
}

function animateCompileTime() {
  // Show error sections container
  animationTimeouts.push(
    setTimeout(() => {
      DOM.compileErrors.classList.add("visible");
    }, ANIMATION_CONFIG.COMPILE_START)
  );

  // Animate each error appearing with its underline
  for (let i = 1; i <= 4; i++) {
    const delay =
      ANIMATION_CONFIG.COMPILE_START + i * ANIMATION_CONFIG.COMPILE_STAGGER;

    animationTimeouts.push(
      setTimeout(() => {
        // Show underline in code
        const underline = document.querySelector(
          `.error-underline[data-error="${i}"]`
        );
        if (underline) underline.classList.add("active");

        // Show error line and detail
        const errorLine = document.querySelector(
          `.error-line[data-error="${i}"]`
        );
        const errorDetail = document.querySelector(
          `.error-detail[data-error="${i}"]`
        );
        if (errorLine) errorLine.classList.add("visible");
        if (errorDetail) {
          setTimeout(() => errorDetail.classList.add("visible"), 50);
        }
      }, delay)
    );
  }

  // Show success message and fix button after all errors
  animationTimeouts.push(
    setTimeout(
      () => {
        DOM.compileSuccess.classList.add("visible");
        DOM.fixBtn.classList.add("visible");
      },
      ANIMATION_CONFIG.COMPILE_START + 5 * ANIMATION_CONFIG.COMPILE_STAGGER
    )
  );
}

function startFixAnimation() {
  // Hide the button
  DOM.fixBtn.classList.add("hidden");
  // Start fix animation immediately
  animateFixing(0);
}

function animateRuntime() {
  // Show "Deploying..." indicator
  animationTimeouts.push(
    setTimeout(() => {
      DOM.deployingIndicator.classList.add("visible");
    }, ANIMATION_CONFIG.DEPLOY_START)
  );

  // Mark deploy done, show "Running..." indicator
  animationTimeouts.push(
    setTimeout(() => {
      DOM.deployingIndicator.classList.add("done");
      DOM.runningIndicator.classList.add("visible");
    }, ANIMATION_CONFIG.DEPLOY_START + ANIMATION_CONFIG.DEPLOY_DURATION)
  );

  // Mark running as failed, show error
  animationTimeouts.push(
    setTimeout(
      () => {
        DOM.runningIndicator.classList.add("done");

        setTimeout(() => {
          DOM.runtimeErrors.classList.add("visible");
          DOM.runtimeErrorMsg.classList.add("visible");

          setTimeout(() => {
            DOM.runtimeErrorNote.classList.add("visible");
            // Show replay button after all animations complete
            setTimeout(showReplayButton, 500);
          }, 300);
        }, ANIMATION_CONFIG.ERROR_DELAY);
      },
      ANIMATION_CONFIG.DEPLOY_START +
        ANIMATION_CONFIG.DEPLOY_DURATION +
        ANIMATION_CONFIG.RUN_DURATION
    )
  );
}

function isInView(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight =
    window.innerHeight || document.documentElement.clientHeight;
  return (
    rect.top < windowHeight &&
    rect.bottom > 0 &&
    rect.height * 0.5 <
      Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0)
  );
}

function replayAnimations() {
  clearAnimations();
  resetState();

  // Reset animation tracking
  hasAnimatedRuntime = false;
  hasAnimatedCompile = false;

  const runtimeTerminal = document.getElementById("runtime-terminal");
  const compileTerminal = document.getElementById("compile-terminal");

  // Only start animations for terminals currently in view
  // Others will trigger via Intersection Observer when scrolled to
  animationTimeouts.push(
    setTimeout(() => {
      if (runtimeTerminal && isInView(runtimeTerminal)) {
        hasAnimatedRuntime = true;
        animateRuntime();
      }
      if (compileTerminal && isInView(compileTerminal)) {
        hasAnimatedCompile = true;
        animateCompileTime();
      }
    }, 100)
  );
}

// Initialize Animations on Page Load
document.addEventListener("DOMContentLoaded", () => {
  // Cache DOM elements once
  initDOMCache();

  // Set up Intersection Observer for scroll-triggered animations
  const observerOptions = {
    root: null,
    rootMargin: "0px",
    threshold: 0.5, // Trigger when 50% of the terminal is visible
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.id;

        if (id === "runtime-terminal" && !hasAnimatedRuntime) {
          hasAnimatedRuntime = true;
          setTimeout(animateRuntime, 100);
        }

        if (id === "compile-terminal" && !hasAnimatedCompile) {
          hasAnimatedCompile = true;
          setTimeout(animateCompileTime, 100);
        }
      }
    });
  }, observerOptions);

  // Observe both terminal sections
  const runtimeTerminal = document.getElementById("runtime-terminal");
  const compileTerminal = document.getElementById("compile-terminal");

  if (runtimeTerminal) observer.observe(runtimeTerminal);
  if (compileTerminal) observer.observe(compileTerminal);
});

// Copy command to clipboard
function copyCommand() {
  navigator.clipboard.writeText("npm install pipesafe").then(() => {
    const feedback = document.getElementById("copy-feedback");
    feedback.classList.add("visible");
    setTimeout(() => feedback.classList.remove("visible"), 1500);
  });
}

// Make functions globally accessible for inline onclick
window.startFixAnimation = startFixAnimation;
window.replayAnimations = replayAnimations;
window.copyCommand = copyCommand;
