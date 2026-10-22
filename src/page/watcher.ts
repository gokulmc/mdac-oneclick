// Content script (isolated world) on every MDAC page: tells the background which
// page this is, and when the traveller really submits the register form.
// Re-injecting it only re-reports the page, so the background can ask at any time.
import type { QueueEvent } from '../domain/queue';
import { detectPage } from './detect';

declare global {
  // eslint-disable-next-line no-var
  var __mdacWatcherInstalled: boolean | undefined;
}

function send(event: QueueEvent) {
  chrome.runtime.sendMessage({ type: 'queue-event', event }).catch(() => {
    // The background may be restarting; the next page load reports again.
  });
}

if (!globalThis.__mdacWatcherInstalled) {
  globalThis.__mdacWatcherInstalled = true;
  // Bubble phase, so the form's own onsubmit="return validateSubmit()" has already run:
  // a submission the form rejected arrives here with defaultPrevented set.
  document.addEventListener('submit', (e) => {
    // getAttribute, not form.name: the form has a field called "name", which shadows the property.
    const form = e.target as HTMLFormElement;
    const submitter = (e as SubmitEvent).submitter;
    if (e.defaultPrevented || form.getAttribute('name') !== 'permohonan' || submitter?.id !== 'submit') return;
    send({ type: 'submitted' });
  });
}

send({ type: 'page', kind: detectPage(document) });
