import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { Finding } from '../../core/api.service';
import { StatusTone, severityTone } from '../../core/live-events';
import { StatusBadgeComponent } from '../status-badge/status-badge.component';
import { TranslatePipe } from '../../core/translate.pipe';

/** Presentational list of findings (severity badge + type + description + PoC). */
@Component({
  selector: 'app-findings-list',
  standalone: true,
  imports: [CommonModule, StatusBadgeComponent, TranslatePipe],
  templateUrl: './findings-list.component.html',
  styleUrls: ['./findings-list.component.scss']
})
export class FindingsListComponent {
  @Input() findings: Finding[] = [];

  tone(severity: string): StatusTone {
    return severityTone(severity);
  }
}
