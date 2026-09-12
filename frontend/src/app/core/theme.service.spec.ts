import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    window.localStorage.clear();
    document.body.className = 'theme-dark';
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    window.localStorage.clear();
    document.body.className = '';
  });

  it('should initialize from the body class and persist the theme', () => {
    service.initTheme();

    expect(service.currentTheme()).toBe('theme-dark');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(window.localStorage.getItem('samurai-theme')).toBe('theme-dark');
  });

  it('should prioritize the stored theme over the body class', () => {
    window.localStorage.setItem('samurai-theme', 'theme-light');
    service.initTheme();

    expect(service.currentTheme()).toBe('theme-light');
    expect(document.body.classList.contains('theme-light')).toBe(true);
    expect(document.body.classList.contains('theme-dark')).toBe(false);
  });

  it('should toggle between dark and light', () => {
    service.initTheme();
    service.toggleTheme();

    expect(service.currentTheme()).toBe('theme-light');
    expect(window.localStorage.getItem('samurai-theme')).toBe('theme-light');
    expect(service.nextThemeLabel()).toBe('DARK MODE');

    service.toggleTheme();
    expect(service.currentTheme()).toBe('theme-dark');
    expect(service.nextThemeAriaLabel()).toBe('Switch to light theme');
  });
});
