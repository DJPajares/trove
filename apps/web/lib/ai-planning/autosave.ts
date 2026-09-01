export type AutosavePhase = 'dirty' | 'error' | 'saved' | 'saving';

export type AutosaveSnapshot = {
  error: unknown;
  hasPendingChanges: boolean;
  phase: AutosavePhase;
};

type SerialAutosaveOptions<TDraft, TResult> = {
  draft: TDraft;
  getRevision: (result: TResult) => number;
  onStateChange?: (snapshot: AutosaveSnapshot) => void;
  persist: (draft: TDraft, expectedRevision: number) => Promise<TResult>;
  result: TResult;
  revision: number;
};

/**
 * Keeps optimistic draft revisions strictly ordered without blocking local edits.
 * A failed write stays paused until retry is requested, so an autosave outage can
 * never become a request loop.
 */
export class SerialAutosave<TDraft, TResult> {
  private draft: TDraft;
  private error: unknown = null;
  private readonly getRevision: (result: TResult) => number;
  private readonly onStateChange?: (snapshot: AutosaveSnapshot) => void;
  private persist: (draft: TDraft, expectedRevision: number) => Promise<TResult>;
  private phase: AutosavePhase = 'saved';
  private result: TResult;
  private revision: number;
  private running: Promise<TResult> | null = null;
  private savedVersion = 0;
  private version = 0;

  constructor(options: SerialAutosaveOptions<TDraft, TResult>) {
    this.draft = options.draft;
    this.getRevision = options.getRevision;
    this.onStateChange = options.onStateChange;
    this.persist = options.persist;
    this.result = options.result;
    this.revision = options.revision;
  }

  get snapshot(): AutosaveSnapshot {
    return {
      error: this.error,
      hasPendingChanges: this.savedVersion < this.version,
      phase: this.phase,
    };
  }

  update(draft: TDraft) {
    this.draft = draft;
    this.version += 1;
    if (!this.error) this.setPhase('dirty');
  }

  replace(options: Pick<SerialAutosaveOptions<TDraft, TResult>, 'draft' | 'result' | 'revision'>) {
    if (this.running || this.savedVersion < this.version) {
      throw new Error('Cannot replace an autosave queue with pending changes');
    }
    this.draft = options.draft;
    this.error = null;
    this.result = options.result;
    this.revision = options.revision;
    this.setPhase('saved');
  }

  flush(): Promise<TResult> {
    if (this.error) return Promise.reject(this.error);
    if (this.running) return this.running;
    if (this.savedVersion === this.version) return Promise.resolve(this.result);

    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  retry(): Promise<TResult> {
    this.error = null;
    this.setPhase(this.savedVersion < this.version ? 'dirty' : 'saved');
    return this.flush();
  }

  private async run() {
    this.setPhase('saving');
    try {
      while (this.savedVersion < this.version) {
        const draft = this.draft;
        const version = this.version;
        const result = await this.persist(draft, this.revision);
        this.result = result;
        this.revision = this.getRevision(result);
        this.savedVersion = version;
      }
      this.setPhase('saved');
      return this.result;
    } catch (error) {
      this.error = error;
      this.setPhase('error');
      throw error;
    }
  }

  private setPhase(phase: AutosavePhase) {
    this.phase = phase;
    this.onStateChange?.(this.snapshot);
  }
}
