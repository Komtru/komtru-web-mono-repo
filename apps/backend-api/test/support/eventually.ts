/** Polls until `check` passes, for asserting on asynchronous queue work. */
export const eventually = async (
  check: () => Promise<boolean> | boolean,
  timeoutMs = 5000,
  // A timeout here means a queue, a relay or a provider did not get where it was going, and the bare
  // failure names none of them. A caller that can describe the state it was waiting on reports it.
  describe?: () => Promise<string> | string,
) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      const detail = describe ? ` — ${String(await describe())}` : '';
      throw new Error(`condition not met in ${String(timeoutMs)}ms${detail}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
};
