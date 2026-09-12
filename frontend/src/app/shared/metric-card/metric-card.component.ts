import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { TranslatePipe } from '../../core/translate.pipe';

export type MetricTone = 'default' | 'success' | 'warning' | 'danger';

/** Instrument-panel metric: label (Space Mono caps) + hero value. */
@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './metric-card.component.html',
  styleUrls: ['./metric-card.component.scss']
})
export class MetricCardComponent {
  @Input() label = '';
  @Input() value: string | number | null = null;
  @Input() unit = '';
  @Input() ariaLabel = '';
  @Input() tone: MetricTone = 'default';
  @Input() hero = true;
}
