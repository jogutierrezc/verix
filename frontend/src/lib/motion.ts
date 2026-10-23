import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';

/**
 * Motion compartido del panel. Reglas: entradas cortas (< 400ms), ease-out
 * exponencial, nada que bloquee la interacción y todo apagado con
 * `prefers-reduced-motion`.
 */

/** Anima en cascada los hijos marcados con `data-stagger` cada vez que cambia `key`. */
export function useStagger(container: RefObject<HTMLElement>, key: unknown, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled || !container.current) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('[data-stagger]', {
        y: 12,
        opacity: 0,
        duration: 0.38,
        stagger: { each: 0.035, amount: 0.4 },
        ease: 'expo.out',
        clearProps: 'transform,opacity',
      });
    }, container);
    return () => mm.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

/** Cuenta de 0 al valor (una vez por cambio de valor), respetando reduced-motion. */
export function useCountUp(target: number, enabled = true, duration = 0.7) {
  const [value, setValue] = useState(target);
  const previous = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(target)) { setValue(target); previous.current = target; return; }
    const state = { n: previous.current };
    const tween = gsap.to(state, {
      n: target,
      duration,
      ease: 'expo.out',
      onUpdate: () => setValue(Math.round(state.n)),
      onComplete: () => { previous.current = target; },
    });
    return () => { tween.kill(); previous.current = state.n; };
  }, [target, enabled, duration]);

  return value;
}
