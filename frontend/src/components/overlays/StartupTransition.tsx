import { useEffect, useRef, useState } from "react";
import { ChartLineUp, Cpu, Database, WaveSine } from "@phosphor-icons/react";

type StartupTransitionProps = {
  ready: boolean;
  reducedEffects?: boolean;
  onComplete: () => void;
};

export function StartupTransition({ ready, reducedEffects = false, onComplete }: StartupTransitionProps) {
  const startedAt = useRef(Date.now());
  const [revealing, setRevealing] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const reduced = reducedEffects || prefersReducedMotion;
    const minimumVisibleMs = reduced ? 40 : 1280;
    const revealDurationMs = reduced ? 80 : 760;
    const waitMs = Math.max(0, minimumVisibleMs - (Date.now() - startedAt.current));
    const revealTimer = window.setTimeout(() => setRevealing(true), waitMs);
    const completeTimer = window.setTimeout(onComplete, waitMs + revealDurationMs);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete, prefersReducedMotion, ready, reducedEffects]);

  return (
    <section
      className={`startup-transition ${revealing ? "is-revealing" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={ready ? "系统视图已就绪" : "系统数据正在接入"}
    >
      <div className="startup-atmosphere" aria-hidden="true" />
      <div className="startup-shutter startup-shutter-top" aria-hidden="true" />
      <div className="startup-shutter startup-shutter-bottom" aria-hidden="true" />
      <div className="startup-energy-line" aria-hidden="true"><i /><i /><i /></div>

      <div className="startup-frame">
        <div className="startup-kicker"><WaveSine weight="duotone" /><span>AURORA SIGNAL LAB</span><i /></div>
        <div className="startup-brand"><strong>NEON GRID</strong><span>光能解构舱</span></div>
        <div className="startup-spectrum" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <h1>台区光储充辨识与光伏功率分离系统</h1>
        <div className={`startup-progress ${ready ? "is-ready" : ""}`} aria-hidden="true"><span /></div>
        <div className="startup-statuses">
          <span className="is-active"><Database weight="duotone" />数据链路接入</span>
          <span className={ready ? "is-active" : ""}><Cpu weight="duotone" />辨识模型就绪</span>
          <span className={ready ? "is-active" : ""}><ChartLineUp weight="duotone" />光能场同步</span>
        </div>
      </div>
    </section>
  );
}
