import { describe, expect, it } from 'vitest';
import {
  currentIndex, isFinished, reduce, startRun, type QueueAction, type QueueEvent, type RunState,
} from '../../src/domain/queue';

const request = {
  travellerIds: ['a', 'b', 'c'],
  presetId: 'p1',
  dates: { arrival: '2026-10-23', departure: '2026-10-25' },
  transportNo: '',
};

/** Feeds events one by one; returns the final state and every action in order. */
function drive(state: RunState, events: QueueEvent[]) {
  const actions: QueueAction[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    actions.push(r.action);
  }
  return { state, actions };
}
const statuses = (s: RunState) => s.items.map((i) => i.status);

const form: QueueEvent = { type: 'page', kind: 'register-form' };
const confirmation: QueueEvent = { type: 'page', kind: 'confirmation' };
const filledOk: QueueEvent = { type: 'filled', ok: true };
const submitted: QueueEvent = { type: 'submitted' };

describe('startRun', () => {
  it('creates one pending item per traveller, in order', () => {
    const s = startRun(request);
    expect(statuses(s)).toEqual(['pending', 'pending', 'pending']);
    expect(s.items.map((i) => i.travellerId)).toEqual(['a', 'b', 'c']);
    expect(currentIndex(s)).toBe(0);
    expect(isFinished(s)).toBe(false);
  });
});

describe('family flow', () => {
  it('walks three travellers from register-form to done', () => {
    let s = startRun(request);
    const seen: QueueAction[] = [];
    for (const id of ['a', 'b', 'c']) {
      const step = drive(s, [form, filledOk, submitted, confirmation]);
      expect(step.actions[0]).toEqual({ type: 'fill', travellerId: id });
      expect(step.actions[1]).toEqual({ type: 'none' });
      expect(step.actions[2]).toEqual({ type: 'none' });
      seen.push(step.actions[3]!);
      s = step.state;
      // After the page-driven "fill" the background reports the result as an event; we did it in drive().
    }
    expect(seen).toEqual([{ type: 'open-form' }, { type: 'open-form' }, { type: 'done' }]);
    expect(statuses(s)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(isFinished(s)).toBe(true);
  });

  it('after a finished run every event is a no-op returning done', () => {
    let s = startRun({ ...request, travellerIds: ['a'] });
    s = drive(s, [form, filledOk, submitted, confirmation]).state;
    const r = reduce(s, form);
    expect(r.action).toEqual({ type: 'done' });
    expect(r.state).toBe(s);
  });
});

describe('server rejection', () => {
  it('submitted then register-form → needs-attention; refill → pending + open-form', () => {
    const base = drive(startRun(request), [form, filledOk, submitted]).state;
    const rejected = reduce(base, form);
    expect(rejected.action).toEqual({ type: 'none' });
    expect(rejected.state.items[0]!.status).toBe('needs-attention');
    expect(rejected.state.items[0]!.note).toMatch(/showed the form again/);

    const refill = reduce(rejected.state, { type: 'refill' });
    expect(refill.state.items[0]!.status).toBe('pending');
    expect(refill.state.items[0]!.note).toBeUndefined();
    expect(refill.action).toEqual({ type: 'open-form' });

    const again = reduce(refill.state, form);
    expect(again.action).toEqual({ type: 'fill', travellerId: 'a' });
  });

  it('a needs-attention item can still be submitted after the traveller fixes it by hand', () => {
    let s = drive(startRun(request), [form, filledOk, submitted, form]).state;
    expect(s.items[0]!.status).toBe('needs-attention');
    s = reduce(s, submitted).state;
    expect(s.items[0]!.status).toBe('submitted');
    s = reduce(s, confirmation).state;
    expect(s.items[0]!.status).toBe('confirmed');
  });
});

describe('reloads, skips, strays', () => {
  it('reloading a filled form fills again', () => {
    const filled = drive(startRun(request), [form, filledOk]).state;
    const r = reduce(filled, form);
    expect(r.state.items[0]!.status).toBe('pending');
    expect(r.action).toEqual({ type: 'fill', travellerId: 'a' });
  });
  it('skip marks the item skipped and advances', () => {
    const r = reduce(startRun(request), { type: 'skip' });
    expect(statuses(r.state)).toEqual(['skipped', 'pending', 'pending']);
    expect(r.action).toEqual({ type: 'open-form' });
    expect(currentIndex(r.state)).toBe(1);
  });
  it('skipping the last remaining item finishes the run', () => {
    let s = drive(startRun({ ...request, travellerIds: ['a', 'b'] }), [form, filledOk, submitted, confirmation]).state;
    const r = reduce(s, { type: 'skip' });
    expect(r.action).toEqual({ type: 'done' });
    expect(isFinished(r.state)).toBe(true);
  });
  it('a confirmation without a submission is ignored', () => {
    const s = startRun(request);
    expect(reduce(s, confirmation)).toEqual({ state: s, action: { type: 'none' } });
    const filled = drive(s, [form, filledOk]).state;
    expect(reduce(filled, confirmation)).toEqual({ state: filled, action: { type: 'none' } });
  });
  it("'submitted' before a fill is ignored", () => {
    const s = startRun(request);
    expect(reduce(s, submitted).state.items[0]!.status).toBe('pending');
  });
  it('other pages change nothing', () => {
    const s = drive(startRun(request), [form, filledOk]).state;
    expect(reduce(s, { type: 'page', kind: 'other' })).toEqual({ state: s, action: { type: 'none' } });
  });
});

describe('failed fill', () => {
  it('filled ok:false → needs-attention with the note', () => {
    const r = reduce(startRun(request), { type: 'filled', ok: false, note: 'arrDt: form kept "" instead of "23/10/2026"' });
    expect(r.state.items[0]!.status).toBe('needs-attention');
    expect(r.state.items[0]!.note).toContain('arrDt');
    expect(r.action).toEqual({ type: 'none' });
  });
  it('refill then re-fills the same traveller and clears the note', () => {
    const failed = reduce(startRun(request), { type: 'filled', ok: false, note: 'x' }).state;
    const refill = reduce(failed, { type: 'refill' });
    expect(refill.state.items[0]!.note).toBeUndefined();
    expect(reduce(refill.state, form).action).toEqual({ type: 'fill', travellerId: 'a' });
  });
});

describe('purity', () => {
  it('never mutates the input state', () => {
    const s = startRun(request);
    const frozen = JSON.stringify(s);
    reduce(s, form);
    reduce(s, { type: 'skip' });
    reduce(s, { type: 'filled', ok: false, note: 'n' });
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
