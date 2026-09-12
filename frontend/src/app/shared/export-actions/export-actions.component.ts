import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { TranslatePipe } from '../../core/translate.pipe';

export type ExportAlign = 'start' | 'end';

/**
 * Shared export toolbar (CSV / JSON / PDF / BIN). Each feature wires the
 * outputs to its own export payload builder.
 */
@Component({
  selector: 'app-export-actions',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './export-actions.component.html',
  styleUrls: ['./export-actions.component.scss']
})
export class ExportActionsComponent {
  @Input() visible = false;
  /** e.g. "scanner report", "reconnaissance results", "findings" for ARIA keys. */
  @Input() ariaContext = 'report';
  @Input() align: ExportAlign = 'start';

  @Output() exportCsv = new EventEmitter<void>();
  @Output() exportJson = new EventEmitter<void>();
  @Output() exportPdf = new EventEmitter<void>();
  @Output() exportBinary = new EventEmitter<void>();
}
