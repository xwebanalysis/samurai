import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { StatusTone } from '../../core/live-events';

/** Data-status tag: color applies to the value, never to row backgrounds. */
@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="status-badge" [ngClass]="tone">{{ label }}</span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        width: fit-content;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid currentColor;
        border-radius: 4px;
        padding: 2px 6px;
        font-family: var(--font-data);
        font-size: var(--label);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .neutral {
        color: var(--text-secondary);
      }

      .success {
        color: var(--success);
      }

      .warning {
        color: var(--warning);
      }

      .danger {
        color: var(--accent);
      }
    `
  ]
})
export class StatusBadgeComponent {
  @Input() label = '';
  @Input() tone: StatusTone = 'neutral';
}
