class JobConflictError extends Error {
  constructor(current) {
    super('Another optimization job is already running');
    this.name = 'JobConflictError';
    this.code = 'job-conflict';
    this.status = 409;
    this.current = current;
  }
}

class JobCancelledError extends Error {
  constructor(message = 'Optimization job was cancelled', code = 'job-cancelled') {
    super(message);
    this.name = 'JobCancelledError';
    this.code = code;
    this.status = code === 'job-timeout' ? 504 : 409;
  }
}

class JobCoordinator {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.sequence = 0;
    this.current = null;
  }

  snapshot() {
    if (!this.current) return null;
    const { abortController, signal, timeoutHandle, ...visible } = this.current;
    return { ...visible };
  }

  cancel(reason = 'Cancelled by user') {
    if (!this.current) return false;
    this.current.abortController.abort(new JobCancelledError(reason));
    return true;
  }

  async run(kind, options, handler) {
    if (this.current) throw new JobConflictError(this.snapshot());
    const now = this.now();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 90000);
    const abortController = new AbortController();
    const id = `${now.toString(36)}-${++this.sequence}`;
    const job = {
      id,
      kind,
      status: 'running',
      backendId: options.backend?.id || null,
      group: options.group || null,
      startedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + timeoutMs).toISOString(),
      timeoutMs,
      abortController,
      signal: abortController.signal,
      timeoutHandle: null
    };
    job.timeoutHandle = setTimeout(() => {
      abortController.abort(new JobCancelledError('Optimization job exceeded its time budget', 'job-timeout'));
    }, timeoutMs);
    if (typeof job.timeoutHandle.unref === 'function') job.timeoutHandle.unref();
    this.current = job;

    try {
      return await handler(job);
    } catch (error) {
      if (job.signal.aborted) throw job.signal.reason || new JobCancelledError();
      throw error;
    } finally {
      clearTimeout(job.timeoutHandle);
      if (this.current?.id === id) this.current = null;
    }
  }
}

module.exports = {
  JobCancelledError,
  JobConflictError,
  JobCoordinator
};
