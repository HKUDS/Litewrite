/**
 * SyncTeX debug log collector.
 * Collects frontend logs and sends them to the server for admin inspection.
 */

interface SyncTexLogContext {
  projectId?: string;
  direction?: "forward" | "backward";
  targetLine?: number;
  targetWord?: string;
  contextBefore?: string;
  contextAfter?: string;
  page?: number;
  x?: number;
  y?: number;
}

class SyncTexLogger {
  private logs: string[] = [];
  private context: SyncTexLogContext = {};
  private enabled: boolean = true;
  private maxLogs: number = 100;

  /**
   * Start a new log session.
   */
  startSession(context: SyncTexLogContext) {
    this.logs = [];
    this.context = context;
    this.log(`Session started: ${JSON.stringify(context)}`);
  }

  /**
   * Record a log entry.
   */
  log(message: string) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString().substring(11, 23); // HH:mm:ss.SSS
    const logEntry = `[${timestamp}] ${message}`;

    this.logs.push(logEntry);

    // Enforce log size limit
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also print to console (development debugging)
    console.log(`[SyncTeX] ${message}`);
  }

  /**
   * End the session and send logs to the server.
   */
  async endSession(additionalContext?: Partial<SyncTexLogContext>) {
    if (!this.enabled || this.logs.length === 0) return;

    const finalContext = { ...this.context, ...additionalContext };

    try {
      await fetch("/api/debug/synctex-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logs: this.logs,
          context: finalContext,
        }),
      });
    } catch (error) {
      console.error("[SyncTexLogger] Failed to send logs:", error);
    }

    // Clear logs
    this.logs = [];
    this.context = {};
  }

  /**
   * Get all logs of the current session.
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Enable/disable logging.
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Check whether logging is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton export
export const syncTexLogger = new SyncTexLogger();
