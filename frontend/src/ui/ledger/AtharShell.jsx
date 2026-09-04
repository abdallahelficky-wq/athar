import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logo from '../assets/athar-logo.png';
import Icon from './Icon.jsx';
import CommandPalette from './CommandPalette.jsx';
import { chapterNumber, moduleCommands } from './navigation.js';
import './AtharShell.css';

/**
 * Controlled navigation: parent owns activeModuleId and existing page/tab state.
 * modules: [{ id, label, title?, icon? }], already filtered by role/activity.
 * commands: [{ id, label, group?, keywords?, moduleId?, tabId? }].
 * onCommand must open an existing screen/form; do not use search to auto-post/pay.
 * companyControl is an optional ReactNode: pass your current, authorized picker.
 * children: existing modules — no business logic is replaced by this shell.
 */
export default function AtharShell({
  modules = [], activeModuleId, onNavigate, children,
  companyName = '', companyControl, commands = [], onCommand,
  logoSrc = logo, initialTheme = 'light', modeLabel = '',
  date = new Date(), footerText,
  onLogout,
}) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(initialTheme);
  const [focusMode, setFocusMode] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const active = modules.find(module => module.id === activeModuleId);
  const chapter = chapterNumber(modules, activeModuleId);
  const allCommands = useMemo(() => [
    ...(onNavigate ? moduleCommands(modules, t) : []),
    ...(onCommand ? commands : []),
  ], [modules, onNavigate, commands, onCommand, t]);
  useEffect(() => {
    function keydown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      // Never stack this palette above an invoice/auth/confirmation modal. The app's own modals
      // (invoice/journal forms, unpost/reverse confirmations, ...) are plain divs, not <dialog> or
      // role="dialog" — every one of them uses a single class ending in "-overlay" (e.g.
      // invoice-modal-overlay, unpost-confirm-overlay), so that convention is matched too.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [class$="-overlay"]')) return;
      event.preventDefault(); setPaletteOpen(true);
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  function selectCommand(command) {
    if (command.id.startsWith('navigate:')) onNavigate?.(command.moduleId);
    else onCommand?.(command);
  }
  const dateValue = date instanceof Date ? date : new Date(date);
  const dateIsValid = !Number.isNaN(dateValue.getTime());
  return <div className="athar-ui" dir={i18n.dir()} data-theme={theme} data-focus={focusMode}>
    <a className="skip-link" href="#athar-page-content">{t('ledgerUi.skipToContent')}</a>
    <header className="top">
      <div className="brand"><img className="brand-logo" src={logoSrc}
        alt={t('ledgerUi.logoAlt')} width="112" height="112" /></div>
      <span className="separator" aria-hidden="true" /><div className="edition">{t('ledgerUi.edition')}</div>
      <div className="top-actions">
        {modeLabel && <span className="demo">{modeLabel}</span>}
        <button type="button" className="search-launch" onClick={() => setPaletteOpen(true)} aria-label={t('ledgerUi.openCommandCenter')}>
          <Icon name="search" /><span>{t('ledgerUi.searchLaunch')}</span><kbd>Ctrl K</kbd></button>
        <button type="button" className="user" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
          aria-label={theme === 'dark' ? t('ledgerUi.switchToLight') : t('ledgerUi.switchToDark')}
          aria-pressed={theme === 'dark'} title={t('ledgerUi.toggleTheme')}>◐</button>
        {onLogout && <button className="logout-button" type="button" onClick={onLogout}>{t('ledgerUi.logout')}</button>}
      </div>
    </header>
    <div className="workspace"><div className="book">
      <nav className="index" aria-label={t('ledgerUi.navLabel')}>
        {modules.map(module => <button type="button" key={module.id} disabled={!onNavigate}
          className={module.id === activeModuleId ? 'active' : ''}
          aria-current={module.id === activeModuleId ? 'page' : undefined}
          onClick={() => onNavigate?.(module.id)}><Icon name={module.icon || module.id} /><small>{module.label}</small></button>)}
      </nav>
      <section className="sheet"><header className="book-head">
        <div className="chapter"><b>{chapter}</b><span>{active?.title || active?.label || t('ledgerUi.chooseSection')}</span></div>
        {dateIsValid && <time dateTime={dateValue.toISOString().slice(0, 10)}>
          {dateValue.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}</time>}
        {companyControl || <span className="company">{companyName || t('ledgerUi.noCompanySelected')}</span>}
        <button type="button" className="outline" aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)}>
          {focusMode ? t('ledgerUi.showMargins') : t('ledgerUi.focusMode')}</button>
      </header>
      <main className="book-content" id="athar-page-content">{children}</main>
      <footer className="footer"><span>{footerText || t('ledgerUi.footerDefault')}</span><span>{chapter} / {String(modules.length).padStart(2, '0')}</span></footer>
      </section>
    </div></div>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
      commands={allCommands} onSelect={selectCommand} />
  </div>;
}
