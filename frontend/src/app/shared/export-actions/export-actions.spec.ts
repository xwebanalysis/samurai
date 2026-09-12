import { TestBed } from '@angular/core/testing';

import { ExportActionsComponent } from './export-actions.component';

describe('ExportActionsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExportActionsComponent]
    }).compileComponents();
  });

  it('should stay hidden when there is nothing to export', () => {
    const fixture = TestBed.createComponent(ExportActionsComponent);
    fixture.componentInstance.visible = false;
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('button.export-btn').length).toBe(0);
  });

  it('should render the four export buttons with contextual ARIA labels', () => {
    const fixture = TestBed.createComponent(ExportActionsComponent);
    fixture.componentInstance.visible = true;
    fixture.componentInstance.ariaContext = 'scanner report';
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll('button.export-btn'));

    expect(buttons.length).toBe(4);
    expect(buttons[0].getAttribute('aria-label')).toBe('Export scanner report as CSV');
    expect(buttons[1].getAttribute('aria-label')).toBe('Export scanner report as JSON');
    expect(buttons[2].getAttribute('aria-label')).toBe('Export scanner report as PDF');
    expect(buttons[3].getAttribute('aria-label')).toBe('Export scanner report as binary');
  });

  it('should emit one output event per button', () => {
    const fixture = TestBed.createComponent(ExportActionsComponent);
    const component = fixture.componentInstance;
    component.visible = true;
    fixture.detectChanges();

    const emitted = { csv: 0, json: 0, pdf: 0, binary: 0 };
    component.exportCsv.subscribe(() => emitted.csv++);
    component.exportJson.subscribe(() => emitted.json++);
    component.exportPdf.subscribe(() => emitted.pdf++);
    component.exportBinary.subscribe(() => emitted.binary++);

    const buttons = fixture.nativeElement.querySelectorAll('button.export-btn');
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();
    buttons[3].click();

    expect(emitted).toEqual({ csv: 1, json: 1, pdf: 1, binary: 1 });
  });
});
