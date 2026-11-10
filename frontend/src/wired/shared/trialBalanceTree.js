/**
 * مساعدات مشتركة لتسطيح شجرة ميزان المراجعة الهرمي حسب حالة الطي/الفتح الحالية — تُستخدَم من شاشة
 * العرض نفسها وأيضاً من شاشتي الطباعة وتصدير Excel، حتى تُصدَّر/تُطبَع بالضبط نفس الصفوف الظاهرة
 * فعلياً على الشاشة (مطوية أو موسّعة، بعد فلترة البحث/إخفاء المعدوم اللذين يطبَّقان من الخادم).
 */

export function collectGroupAccountIds(nodes, out = new Set()) {
  for (const node of nodes) {
    if (!node.isPosting) {
      out.add(node.accountId);
      collectGroupAccountIds(node.children, out);
    }
  }
  return out;
}

export function flattenVisibleTree(nodes, expandedIds, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length > 0 && expandedIds.has(node.accountId)) {
      flattenVisibleTree(node.children, expandedIds, depth + 1, out);
    }
  }
  return out;
}

/** كل صفوف الشجرة موسّعة بالكامل (بنفس ترتيب وتداخل flattenVisibleTree) — لطباعة ميزان المراجعة بكل حساباته
 * بصرف النظر عن الفروع المطويّة في الشاشة. الشجرة نفسها مفلترة مسبقاً من الخادم (المستوى/إخفاء الصفري/البحث). */
export function flattenAllTree(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length > 0) flattenAllTree(node.children, depth + 1, out);
  }
  return out;
}
