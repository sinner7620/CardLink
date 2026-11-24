import { writeFileSync } from "node:fs";
import { buildFixtureRecord, FIXTURE_EXPORTED_AT } from "../fixtures/fixture-data.ts";

const payload = {
  schemaVersion: 1,
  sourceId: "cli-smoke",
  exportedAt: FIXTURE_EXPORTED_AT,
  isFullSnapshot: true,
  records: Array.from({ length: 30 }, (_, i) => buildFixtureRecord(i)),
};
writeFileSync(new URL("../../data/smoke-snapshot.json", import.meta.url), JSON.stringify(payload));
console.log("fixture written:", payload.records.length);
