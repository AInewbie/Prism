import { randomUUID } from "node:crypto";
import { AppError } from "./core.mjs";

// Keep snapshots outside combined to avoid nesting history inside each revision.
// Legacy 0.1.0 sessions acquire history only when their draft next changes.
export function replaceDraft(run, next) {
  const prior = run.combined;
  run.combinedHistory ??= [];
  if (prior.version > 0 || prior.text) {
    run.combinedHistory.push({
      ...structuredClone(prior),
      historyId: randomUUID(),
      savedAt: prior.savedAt || run.updatedAt,
    });
  }
  run.combined = {
    ...next,
    version: prior.version + 1,
    savedAt: new Date().toISOString(),
  };
}

export function restoreDraft(run, historyId) {
  const snapshot = (run.combinedHistory || []).find(
    (item) => item.historyId === historyId,
  );
  if (!snapshot) throw new AppError("Saved draft not found.", 404);
  const { historyId: ignored, ...draft } = snapshot;
  replaceDraft(run, { ...draft, restoredFrom: snapshot.version });
}
