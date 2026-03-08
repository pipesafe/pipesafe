import { useState, useCallback } from "react";
import Hero from "./components/Hero/Hero";
import RuntimeTerminal from "./components/RuntimeTerminal/RuntimeTerminal";
import CompileTerminal from "./components/CompileTerminal/CompileTerminal";
import ReplayButton from "./components/ReplayButton/ReplayButton";
import styles from "./App.module.css";

export default function App() {
  // Changing animationKey remounts terminal components, resetting their animations
  const [animationKey, setAnimationKey] = useState(0);
  const [showReplayButton, setShowReplayButton] = useState(false);

  const handleReplay = useCallback(() => {
    setShowReplayButton(false);
    setAnimationKey((k) => k + 1);
  }, []);

  const handleAnimationComplete = useCallback(() => {
    setShowReplayButton(true);
  }, []);

  return (
    <div className={styles.container}>
      <Hero />
      <RuntimeTerminal
        key={`runtime-${animationKey}`}
        onAnimationComplete={handleAnimationComplete}
      />
      <CompileTerminal key={`compile-${animationKey}`} />
      <ReplayButton visible={showReplayButton} onReplay={handleReplay} />
    </div>
  );
}
