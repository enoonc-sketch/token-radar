// Token Radar, radar-2 (Node 22, standard library only).
//
// What this program does, end to end:
//   1. It takes the sealed snapshot — /input/snapshot.json in the grader, or whatever
//      --input points at (a snapshot file, or a directory holding one) — and parses it
//      with the snapshot reader in lib/model.ts.
//   2. It scores every pre-token protocol with the model in lib/model.ts. The model
//      ranks the watchlist first, adds the early radar below the TVL floor, and ends
//      with the live-token protocols at the model's floor, each row carrying a farm plan.
//   3. It writes the ranked board to board.json and the same rows, as a script the
//      dashboard can read without a network, to data.js.
//   4. It copies this repository's dashboard/ and screenshots/ into the output so the
//      judge gets the page and its three proof images next to the data. The screenshots
//      are checked on the way in: at least three, and names the gate accepts.
//   5. Last, it writes dossier.json with the vendored make.fun library. The dossier is
//      written last on purpose: it is a manifest of the finished output directory, so
//      the scorer can rebuild it from the same files and compare bytes.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read the data.js this program writes. The
// board, the script and the page all come from the one ranked board, so the numbers
// the judge reads in the dossier, the numbers in board.json and the numbers on the
// page are the same numbers.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** How many screenshots the hand-in must carry: the board, a detail view, a filtered view. */
const REQUIRED_SCREENSHOTS = 3;

/** --name <value> out of the arguments, or the fallback when the flag is absent. */
function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/**
 * Step 1: work out which snapshot file to read. --input takes a snapshot file
 * directly, or a directory, in which case the file is snapshot.json inside it.
 * A missing snapshot is a usage error: exit 2 and say how to point at one.
 */
function resolveSnapshotFile(): string {
  const inputArg = flagValue('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return inputFile;
}

/** Step 1, continued: the output directory, from --output or MAKEFUN_OUTPUT_DIR. */
function resolveOutputDir(): string {
  return flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** Step 2: read the snapshot file and parse it into the model's input. */
function loadSnapshot(inputFile: string) {
  return parseSnapshot(readFileSync(inputFile, 'utf8'));
}

/**
 * Step 2, continued: score the snapshot and check the result against the gate.
 * A board the gate refuses is a model bug, not a usage error: exit 1.
 */
function scoreBoard(snapshot: ReturnType<typeof parseSnapshot>) {
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }
  return { board, radar };
}

/** Step 3: write the ranked board and the dashboard's data script. */
function writeBoardFiles(out: string, board: ReturnType<typeof buildRadar>['board'], radar: ReturnType<typeof buildRadar>['radar']): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
}

/**
 * Step 4: copy one directory's regular files into `to`, skipping names that
 * start with a dot, and report the copied names in directory order.
 */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * Step 4, continued: the screenshots are the hand-in's proof, so they are
 * checked, not just copied. Fewer than three, or a name the gate refuses,
 * stops the run with exit 1 before the dossier is written.
 */
function checkScreenshots(shots: string[]): void {
  if (shots.length < REQUIRED_SCREENSHOTS) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }
}

/**
 * Step 5: write the dossier last. It is a manifest of the finished output
 * directory, so it must be built after every other file is in place.
 */
function writeDossier(out: string): void {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
}

/** Report the run on stdout: what was scored, and what was written where. */
function printSummary(
  out: string,
  snapshot: ReturnType<typeof parseSnapshot>,
  board: ReturnType<typeof buildRadar>['board'],
  radar: ReturnType<typeof buildRadar>['radar'],
  shots: string[],
): void {
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live at the floor)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

/** Run the pipeline in order: snapshot in, board and dossier out. */
function main(): void {
  const inputFile = resolveSnapshotFile();
  const out = resolveOutputDir();

  const snapshot = loadSnapshot(inputFile);
  const { board, radar } = scoreBoard(snapshot);

  writeBoardFiles(out, board, radar);

  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  checkScreenshots(shots);

  writeDossier(out);
  printSummary(out, snapshot, board, radar, shots);
}

main();
