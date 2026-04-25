// Split the multi-label pioneer-classification.jsonl into 3 SINGLE-LABEL datasets:
//   - data/pioneer-battery-classifier.jsonl  ({text, label}) labels: none/small/medium/large
//   - data/pioneer-system-classifier.jsonl   ({text, label}) labels: small/medium/large/xlarge
//   - data/pioneer-wallbox-classifier.jsonl  ({text, label}) labels: yes/no
//
// Why: Pioneer's classification dataset_type expects `label` (singular) for single-label.
// Our previous V3 attempt sent `labels: [...]` array → Pioneer coerced it to a 28-class
// composite label and stalled. 3 single-label fine-tunes train cleanly.
//
// Run: pnpm tsx src/scripts/split-classification-datasets.ts

import fs from 'node:fs';
import path from 'node:path';

interface MultiLabelRow {
  text: string;
  labels: string[];
}
interface SingleLabelRow {
  text: string;
  label: string;
}

function main() {
  const inPath = path.join(process.cwd(), 'data', 'pioneer-classification.jsonl');
  if (!fs.existsSync(inPath)) {
    console.error(`Missing ${inPath}. Run extract-pioneer-classification.ts first.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(inPath, 'utf-8').trim().split('\n');
  const rows: MultiLabelRow[] = lines.map((l) => JSON.parse(l));
  console.log(`Read ${rows.length} multi-label rows from ${path.basename(inPath)}`);

  const battery: SingleLabelRow[] = [];
  const system: SingleLabelRow[] = [];
  const wallbox: SingleLabelRow[] = [];
  let bad = 0;

  for (const r of rows) {
    const labels = r.labels ?? [];
    const bat = labels.find((l) => l.startsWith('bat_'))?.slice(4);
    const sys = labels.find((l) => l.startsWith('sys_'))?.slice(4);
    const wb = labels.find((l) => l.startsWith('wallbox_'))?.slice(8);

    if (!bat || !sys || !wb) { bad++; continue; }

    battery.push({ text: r.text, label: bat });
    system.push({ text: r.text, label: sys });
    wallbox.push({ text: r.text, label: wb });
  }
  if (bad > 0) console.warn(`Skipped ${bad} rows missing one of bat_/sys_/wallbox_`);

  // Write the 3 files
  const outDir = path.join(process.cwd(), 'data');
  const writeJsonl = (file: string, rows: SingleLabelRow[]) => {
    fs.writeFileSync(path.join(outDir, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`✓ ${file}: ${rows.length} rows`);
  };
  writeJsonl('pioneer-battery-classifier.jsonl', battery);
  writeJsonl('pioneer-system-classifier.jsonl', system);
  writeJsonl('pioneer-wallbox-classifier.jsonl', wallbox);

  // Distribution stats
  const dist = (rows: SingleLabelRow[]) =>
    rows.reduce<Record<string, number>>((a, r) => {
      a[r.label] = (a[r.label] ?? 0) + 1;
      return a;
    }, {});

  console.log('\n=== Battery distribution ===');
  for (const [k, v] of Object.entries(dist(battery))) {
    console.log(`  ${k}: ${v} (${Math.round((v / battery.length) * 100)}%)`);
  }
  console.log('\n=== System distribution ===');
  for (const [k, v] of Object.entries(dist(system))) {
    console.log(`  ${k}: ${v} (${Math.round((v / system.length) * 100)}%)`);
  }
  console.log('\n=== Wallbox distribution ===');
  for (const [k, v] of Object.entries(dist(wallbox))) {
    console.log(`  ${k}: ${v} (${Math.round((v / wallbox.length) * 100)}%)`);
  }

  // File size summary
  const sizes = ['battery', 'system', 'wallbox'].map((t) => ({
    name: `pioneer-${t}-classifier.jsonl`,
    kb: Math.round(fs.statSync(path.join(outDir, `pioneer-${t}-classifier.jsonl`)).size / 1024),
  }));
  console.log('\nFile sizes:');
  for (const s of sizes) console.log(`  ${s.name}: ${s.kb} KB`);

  // Sample
  console.log('\nSample battery row:', battery[0]);
}

main();
