import { TestBed } from '@angular/core/testing';

import { TranslationService } from './i18n.service';

describe('TranslationService (i18n)', () => {
  let service: TranslationService;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(TranslationService);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should default to English', () => {
    expect(service.currentLang()).toBe('en');
    expect(service.translate('NETWORK_SCANNER')).toBe('NETWORK SCANNER');
  });

  it('should translate to Spanish and update the document language', () => {
    service.setLang('es');

    expect(service.currentLang()).toBe('es');
    expect(service.translate('NETWORK_SCANNER')).toBe('ESCÁNER DE RED');
    expect(service.translate('PORTS_FOUND')).toBe('PUERTOS ENCONTRADOS');
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('samurai-lang')).toBe('es');
  });

  it('should toggle languages and fall back to the key when missing', () => {
    service.setLang('en');
    service.toggleLang();

    expect(service.currentLang()).toBe('es');
    expect(service.nextLangLabel()).toBe('ENGLISH');
    expect(service.translate('__MISSING_KEY__')).toBe('__MISSING_KEY__');

    service.toggleLang();
    expect(service.currentLang()).toBe('en');
    expect(service.nextLangLabel()).toBe('ESPAÑOL');
  });
});
