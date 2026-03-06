import { useState, useCallback } from "react";

export function useCopyToClipboard(
  resetDelay = 1500
): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), resetDelay);
      } catch {
        console.error("Failed to copy to clipboard");
      }
    },
    [resetDelay]
  );

  return [copied, copy];
}
