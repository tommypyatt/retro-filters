import { $, h } from './dom';

export type NoticeKind = 'warning' | 'error';

/** Dismissible banner messages under the top bar. `key` de-duplicates. */
export function notify(message: string, kind: NoticeKind = 'warning', key?: string): void {
  const banner = $('#banner');
  if (key) banner.querySelector(`[data-key="${key}"]`)?.remove();
  const close = h('button', { 'aria-label': 'Dismiss message' }, '×');
  const el = h('div', { class: `notice ${kind === 'error' ? 'error' : ''}`, role: kind === 'error' ? 'alert' : 'status', 'data-key': key }, h('p', {}, message), close);
  close.addEventListener('click', () => el.remove());
  banner.append(el);
}

export function clearNotices(key?: string): void {
  const banner = $('#banner');
  if (key) banner.querySelector(`[data-key="${key}"]`)?.remove();
  else banner.replaceChildren();
}
