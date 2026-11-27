import { KEY } from './engine.js';
import { TOURNAMENT_KEY } from './tournament-storage.js';

export class SharedStorage {
  constructor({ state, request, readOnly = false, notify = () => {}, status = () => {}, clock = Date.now }) {
    this.request = request; this.readOnly = readOnly; this.notify = notify; this.status = status; this.clock = clock;
    this.offset = 0; this.accept(state, false);
  }
  accept(state, notify = true) {
    if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('Invalid shared database response.');
    if (this.state && state.revision < this.state.revision) return;
    const changed = !this.state || state.revision !== this.state.revision;
    this.state = state;
    if (changed && notify) this.notify();
  }
  getItem(key) {
    const value = key === KEY ? this.state.game : key === TOURNAMENT_KEY ? this.state.tournament : null;
    return value === null || value === undefined ? null : JSON.stringify({ ...value, _sharedRevision: this.state.revision });
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const started = this.clock(), response = await this.request('/api/state?since=' + this.state.revision);
      this.offset = response.serverTime - (started + this.clock()) / 2;
      if (!response.unchanged) this.accept(response.state); this.status(this.saving ? 'saving' : 'connected');
    } catch (error) { this.status('offline'); throw error; }
    finally { this.refreshing = false; }
  }
  now() { return Math.round(this.clock() + this.offset); }
  async save(key, json, expectedRaw) {
    if (this.readOnly) throw new Error('This display is read-only.');
    if (expectedRaw !== undefined && this.getItem(key) !== expectedRaw) throw new Error('Shared data changed. Review the current state and try again.');
    if (![KEY, TOURNAMENT_KEY].includes(key)) throw new Error('Unknown shared data key.');
    const value = JSON.parse(json), input = { key, value, revision: this.state.revision, mutationId: globalThis.crypto.randomUUID() };
    return this.commit(input);
  }
  async commit(input) {
    if (this.readOnly) throw new Error('This display is read-only.');
    if (this.saving) throw new Error('A save is still in progress. Wait for it to finish.');
    this.saving = true; this.status('saving');
    try {
      let response;
      try { response = await this.request('/api/state', { method: 'PUT', body: input }); }
      catch (error) {
        // A response can be lost after a successful commit. Check the receipt,
        // never replay a scoring action automatically.
        try {
          const latest = await this.request('/api/state'); this.accept(latest.state);
          if (latest.state.lastMutationId === input.mutationId) response = latest;
        } catch { /* Keep the prior cache until the connection returns. */ }
        if (!response) throw error;
      }
      this.accept(response.state); this.status('connected');
    } catch (error) { this.status(error.status === 409 ? 'connected' : 'offline'); throw error; }
    finally { this.saving = false; }
  }
}
