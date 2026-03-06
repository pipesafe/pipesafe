import { useState, useRef, type RefCallback } from "react";

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

export function useIntersectionObserver<T extends HTMLElement>(
  options: UseIntersectionObserverOptions = {}
): [RefCallback<T>, boolean] {
  const { threshold = 0.5, rootMargin = "0px", triggerOnce = true } = options;
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setRef: RefCallback<T> = (element) => {
    // Clean up previous observer
    if (observerRef.current && elementRef.current) {
      observerRef.current.unobserve(elementRef.current);
    }

    elementRef.current = element;

    if (!element) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (triggerOnce && observerRef.current) {
              observerRef.current.unobserve(element);
            }
          } else if (!triggerOnce) {
            setIsVisible(false);
          }
        });
      },
      { threshold, rootMargin }
    );

    observerRef.current.observe(element);
  };

  return [setRef, isVisible];
}
