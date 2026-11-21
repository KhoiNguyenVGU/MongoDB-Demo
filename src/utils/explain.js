// Rút gọn output explain("executionStats") thành vài chỉ số chính
function summarize(ex) {
  let root = ex.queryPlanner?.winningPlan;
  if (root?.queryPlan) root = root.queryPlan; // định dạng của SBE engine
  const stages = [];
  const indexes = new Set();
  (function walk(n) {
    if (!n) return;
    stages.push(n.stage);
    if (n.indexName) indexes.add(n.indexName);
    if (n.inputStage) walk(n.inputStage);
    if (n.inputStages) n.inputStages.forEach(walk);
  })(root);
  const es = ex.executionStats || {};
  return {
    plan: stages.join(' ← '),
    index: indexes.size ? [...indexes].join(', ') : null,
    nReturned: es.nReturned,
    totalKeysExamined: es.totalKeysExamined,
    totalDocsExamined: es.totalDocsExamined,
    executionTimeMillis: es.executionTimeMillis,
  };
}

module.exports = { summarize };
