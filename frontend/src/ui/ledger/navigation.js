/** Presentation helpers only. No API calls, persistence or authorization. */
export function normalizeArabic(value) {
  return String(value ?? '').toLowerCase().replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0640]/g, '').trim();
}
export function filterCommands(commands, query) {
  const words = normalizeArabic(query).split(/\s+/).filter(Boolean);
  return commands.filter(command => words.every(word =>
    normalizeArabic(`${command.label} ${command.keywords || ''}`).includes(word)));
}
export function chapterNumber(modules, activeId) {
  const index = modules.findIndex(module => module.id === activeId);
  return index < 0 ? '—' : String(index + 1).padStart(2, '0');
}
/** t اختياري (مفتاحان: openModule بمعامل {label}، وsectionsGroup) — بلا تمريره تبقى القيم
 * الافتراضية بالعربية كما كانت، حفاظاً على توافق الاستدعاء القديم moduleCommands(modules). */
export function moduleCommands(modules, t) {
  return modules.map(module => ({
    id: `navigate:${module.id}`,
    label: t ? t('ledgerUi.commandOpenModule', { label: module.label }) : `فتح ${module.label}`,
    group: t ? t('ledgerUi.commandSectionsGroup') : 'الأقسام',
    moduleId: module.id,
  }));
}
