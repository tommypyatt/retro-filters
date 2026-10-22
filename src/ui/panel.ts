import type { Store } from '../state';
import { section, setPath, type Bound, type ControlHost, type SectionSpec } from './controls';
import { h } from './dom';

/** Collapsible side panel of grouped controls bound to the store. */
export class Panel {
  readonly host: ControlHost;
  readonly head = h('div', { class: 'panel-head' });
  readonly body = h('div', { class: 'panel-body' });
  private bound: Bound[] = [];

  constructor(readonly el: HTMLElement, private store: Store) {
    this.host = {
      view: () => store.viewing(),
      set: (path, value) => {
        setPath(store.editing(), path, value);
        store.emit('recipe');
      },
    };
    el.append(this.head, this.body);
  }

  addSection(spec: SectionSpec): void {
    const b = section(spec, this.host);
    this.bound.push(b);
    this.body.append(b.el);
  }

  addBound(b: Bound, target: HTMLElement = this.body): void {
    this.bound.push(b);
    target.append(b.el);
  }

  sync(): void {
    const r = this.store.viewing();
    for (const b of this.bound) b.sync(r);
  }
}
