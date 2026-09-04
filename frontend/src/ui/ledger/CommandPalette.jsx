import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterCommands } from './navigation.js';
import Icon from './Icon.jsx';

export default function CommandPalette({ open, onClose, commands, onSelect }) {
  const { t } = useTranslation();
  const dialog = useRef(null);
  const input = useRef(null);
  const heading = useId();
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  useEffect(() => {
    const node = dialog.current;
    if (open && !node.open) {
      setQuery(''); node.showModal(); input.current?.focus();
    } else if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);
  function select(command) {
    onClose();
    onSelect(command);
  }
  return <dialog ref={dialog} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2 id={heading}>{t('ledgerUi.paletteTitle')}</h2>
      <button type="button" className="close" onClick={onClose} aria-label={t('ledgerUi.closeCommandCenter')}>×</button></div>
    <form onSubmit={event => { event.preventDefault(); if (results.length === 1) select(results[0]); }}>
      <div className="command-field"><Icon name="search" /><input ref={input} value={query}
        onChange={event => setQuery(event.target.value)} aria-label={t('ledgerUi.commandSearchLabel')}
        autoComplete="off" placeholder={t('ledgerUi.commandSearchPlaceholder')} /></div>
    </form>
    <div className="command-results" aria-live="polite">
      {results.length ? results.map(command => <button type="button" className="result" key={command.id}
        onClick={() => select(command)}><span>{command.label}</span><small>{command.group || t('ledgerUi.commandFallbackGroup')} ←</small></button>)
        : <p className="muted">{t('ledgerUi.commandNoResults')}</p>}
    </div>
    <p className="muted">{t('ledgerUi.commandFooterNote')}</p>
  </dialog>;
}
