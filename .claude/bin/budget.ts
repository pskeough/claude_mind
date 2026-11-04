/**
 * budget.ts: today's background model-call usage against the daily cap.
 *
 *   npm run budget
 *
 * The cap lives in .claude/lkhs.config.json under llmBudget (see config.ts). This
 * script only reads the ledger; it never spends a call.
 */
import { llmBudget, llmBudgetState, summaryModel, llmConcurrency } from "./config";

const b = llmBudget();
const s = llmBudgetState();
const cap = b.dailyCalls <= 0 ? "off" : String(b.dailyCalls);
console.log(`model           ${summaryModel()}`);
console.log(`concurrency     ${llmConcurrency()}`);
console.log(`daily cap       ${cap} calls (${b.captureReserve} reserved for session capture)`);
console.log(`used today      ${s.total}${s.refused ? `   refused: ${s.refused}` : ""}   (${s.day})`);
for (const [k, v] of Object.entries(s.byLabel).sort((a, c) => c[1] - a[1])) console.log(`  ${k.padEnd(13)} ${v}`);
