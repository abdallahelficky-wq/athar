import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';

export function PageHeader({ title, eyebrow, description, actionLabel, onAction }) {
  return <div className="heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}
    <h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>
    {actionLabel && onAction && <button type="button" className="primary" onClick={onAction}>
      <Icon name="plus" />{actionLabel}</button>}</div>;
}

export function LedgerColumns({ children, aside }) {
  return <div className={aside ? 'folio-grid' : undefined}><div>{children}</div>
    {aside && <aside className="margin-note">{aside}</aside>}</div>;
}

/** IDs should match the existing controlled tab IDs, not a new workflow database.
 * step.icon (optional): name from Icon.jsx — rendered next to the label, not the step number. */
export function WorkflowSteps({ steps, activeId, onChange, ariaLabel }) {
  const { t } = useTranslation();
  return <div className="flow" role="group" aria-label={ariaLabel || t('ledgerUi.workflowStepsLabel')}>
    {steps.map((step, index) => <button type="button" key={step.id} disabled={step.disabled || !onChange}
      aria-pressed={activeId === step.id} className={activeId === step.id ? 'active' : ''}
      onClick={() => onChange?.(step.id)}><small>{String(index + 1).padStart(2, '0')}</small>
      <span className="flow-title">{step.icon && <Icon name={step.icon} />}<strong>{step.label}</strong></span>
      {step.count != null && <span>{t('ledgerUi.workflowItemCount', { count: step.count })}</span>}</button>)}
  </div>;
}

/** Currency formatting and financial calculations belong to the parent. */
export function FinancialSummary({ label, value, unit, changeText, changeTone = 'neutral', metrics = [] }) {
  return <><div className="statement"><div><span className="muted">{label}</span><br />
    <strong>{value ?? '—'}</strong> <span className="unit">{unit}</span></div>
    {changeText && <div className={`change tone-${changeTone}`}>{changeText}</div>}</div>
    <div className="metrics">{metrics.map(metric => <div className="metric" key={metric.id}>
      <span className="muted">{metric.label}</span><b>{metric.value ?? '—'}</b></div>)}</div></>;
}

export function TaskList({ title = 'قرارات لها أولوية', tasks = [], emptyText = 'لا توجد مهام معلقة.' }) {
  return <><div className="section-label"><span>01</span><h3>{title}</h3></div>
    {tasks.length ? tasks.map((task, index) => <div className="task" key={task.id}>
      <span className="task-number">{index + 1}</span><div><p>{task.title}</p><small>{task.detail}</small></div>
      {task.actionLabel && task.onAction && <button type="button" onClick={task.onAction}>{task.actionLabel} ←</button>}
    </div>) : <p className="muted">{emptyText}</p>}</>;
}

export function RecordList({ title, rows = [], onOpen, loading = false, error, emptyText = 'لا توجد مستندات.' }) {
  return <><div className="records-head"><h2>{title}</h2>{!loading && !error && <span className="tag">{rows.length} عناصر معروضة</span>}</div>
    {loading ? <p role="status">جارٍ التحميل…</p> : error ? <p className="notice" role="alert">{error}</p>
      : rows.length ? rows.map(row => <article className="record" key={row.id}>
        <div><b>{row.title}</b><p>{row.description}</p></div><span className="amount">{row.amount}</span>
        {onOpen && <button type="button" onClick={() => onOpen(row)} aria-label={`عرض ${row.title}`}>←</button>}
      </article>) : <p className="muted">{emptyText}</p>}</>;
}

export function MarginNote({ label, number, title, children, actions = [], note }) {
  return <><div className="note-label">{label}</div>{number != null && <div className="note-number">{number}</div>}
    {title && <h3>{title}</h3>}{children}<div className="side-actions">
      {actions.map(action => <button type="button" key={action.id} onClick={action.onAction} disabled={!action.onAction}>
        {action.label}<span>←</span></button>)}</div>{note && <div className="note-card">{note}</div>}</>;
}
