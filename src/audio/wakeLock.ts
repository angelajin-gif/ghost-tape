// Keep the screen on while listening or broadcasting. A no-op where the Wake Lock API is missing
// or refuses. The browser drops the lock when the tab is hidden, so it is taken again on return.

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export async function keepScreenAwake(
  wakeLock: WakeLockLike | undefined = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock,
  doc: Document = document,
): Promise<{ release(): void }> {
  let sentinel: WakeLockSentinelLike | undefined;
  let released = false;
  const acquire = async (): Promise<void> => {
    if (!wakeLock || released) return;
    try {
      sentinel = await wakeLock.request('screen');
      // release() may have been called while the request was pending.
      if (released) await sentinel.release().catch(() => undefined);
    } catch {
      sentinel = undefined;
    }
  };
  const onVisible = (): void => {
    if (doc.visibilityState === 'visible') void acquire();
  };
  doc.addEventListener('visibilitychange', onVisible);
  await acquire();
  return {
    release: () => {
      released = true;
      doc.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    },
  };
}
