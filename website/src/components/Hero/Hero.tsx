import InstallBox from "../InstallBox";
import SocialLinks from "../SocialLinks";
import styles from "./Hero.module.css";

export default function Hero() {
  return (
    <div className={styles.hero}>
      <h1 className={styles.title}>PipeSafe</h1>
      <p className={styles.tagline}>Type-safe MongoDB aggregations.</p>
      <InstallBox />
      <SocialLinks />
      <p className={styles.status}>
        Now available as{" "}
        <a href="https://www.npmjs.com/package/@pipesafe/core">
          @pipesafe/core
        </a>{" "}
        on NPM.
      </p>
    </div>
  );
}
