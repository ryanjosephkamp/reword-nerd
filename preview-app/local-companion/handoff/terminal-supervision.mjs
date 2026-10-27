// Used by the fixed native runner; none of these controls are browser inputs.
export async function superviseNative(
  child,
  {
    stdout,
    stderr,
    prompt,
    timeoutMs = 8 * 60 * 1000,
    sampleMs = 1000,
    maxRawBytes = 32 * 1024 * 1024,
    killAfterMs = 5000,
    signals = process,
    signalGroup = (pid, signal) => process.kill(-pid, signal),
  },
) {
  let reason = null,
    killTimer;
  const stop = (why) => {
    if (reason) return;
    reason = why;
    if (!Number.isInteger(child.pid) || child.pid < 1) return;
    try {
      signalGroup(child.pid, "SIGTERM");
    } catch {
      /* Owned process may have exited. */
    }
    killTimer = setTimeout(() => {
      try {
        signalGroup(child.pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }, killAfterMs);
  };
  const interrupt = () => stop("user-interrupt"),
    terminate = () => stop("terminal-closed");
  signals.once("SIGINT", interrupt);
  signals.once("SIGTERM", terminate);
  const timer = setTimeout(() => stop("owned-task-timeout"), timeoutMs);
  const bound = setInterval(async () => {
    try {
      if ((await stdout.stat()).size + (await stderr.stat()).size > maxRawBytes)
        stop("raw-output-bound");
    } catch {
      stop("raw-output-stat-failed");
    }
  }, sampleMs);
  child.stdin.on("error", () => {});
  const outcome = new Promise((resolve) => {
    child.once("error", (e) => resolve({ error: e.message }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end(prompt);
  try {
    return {
      exit: await outcome,
      get reason() {
        return reason;
      },
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearInterval(bound);
    signals.removeListener("SIGINT", interrupt);
    signals.removeListener("SIGTERM", terminate);
  }
}
