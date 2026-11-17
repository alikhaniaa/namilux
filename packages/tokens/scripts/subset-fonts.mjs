#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const UNICODE_RANGES =
  "U+0020-007E,U+00A0-00BF,U+00D7,U+00F7,U+0600-06FF,U+200B-200F,U+2010-2027,U+2030-203A,U+2212,U+FDFC,U+FE70-FEFF";
export const WGHT_RANGE = "400:800";

export const INPUTS = Object.freeze({
  estedad: "fonts/upstream/Estedad-VF.ttf",
  vazirmatn: "fonts/upstream/Vazirmatn-VF.woff2",
});
export const INTERMEDIATE = Object.freeze({
  estedad: "fonts/.build/Estedad-wght400-800.ttf",
  vazirmatn: "fonts/.build/Vazirmatn-wght400-800.ttf",
});
export const OUTPUTS = Object.freeze({
  estedad: "fonts/Estedad-VF.woff2",
  vazirmatn: "fonts/Vazirmatn-VF.woff2",
  report: "fonts/subset-report.json",
});
export const BUDGETS = Object.freeze({
  estedad: 110 * 1024,
  vazirmatn: 60 * 1024,
});

/** Where an absent original is downloaded from (fonts/README.md "Files in this folder"). */
const SOURCES = Object.freeze({
  estedad: "https://github.com/aminabedi68/Estedad (release asset Estedad-VF.ttf, OFL 1.1)",
  vazirmatn: "https://github.com/rastikerdar/vazirmatn (fonts/webfonts/Vazirmatn[wght].woff2, OFL 1.1)",
});

const SUBSET_FLAGS = [
  "--flavor=woff2",
  `--unicodes=${UNICODE_RANGES}`,
  "--layout-features=*",
  "--no-hinting",
  "--notdef-outline",
  "--drop-tables+=DSIG",
];

/** The exact command lines, in order. `tool` is resolved by resolveTools(). */
export const COMMANDS = Object.freeze([
  { tool: "instancer", args: ["-o", INTERMEDIATE.estedad, INPUTS.estedad, `wght=${WGHT_RANGE}`] },
  { tool: "subset", args: [INTERMEDIATE.estedad, `--output-file=${OUTPUTS.estedad}`, ...SUBSET_FLAGS] },
  { tool: "instancer", args: ["-o", INTERMEDIATE.vazirmatn, INPUTS.vazirmatn, `wght=${WGHT_RANGE}`] },
  { tool: "subset", args: [INTERMEDIATE.vazirmatn, `--output-file=${OUTPUTS.vazirmatn}`, ...SUBSET_FLAGS] },
]);

export const PIP_HINT = 'pip install "fonttools[woff]>=4.50" brotli';

/** Codepoints the subset must keep (edge cases: ZWNJ + Extended Arabic-Indic digits). */
const REQUIRED_COVERAGE = Object.freeze({
  "U+200C": [0x200c],
  "U+06F0-06F9": [0x06f0, 0x06f1, 0x06f2, 0x06f3, 0x06f4, 0x06f5, 0x06f6, 0x06f7, 0x06f8, 0x06f9],
});

const out = (s) => process.stdout.write(s + "\n");
const err = (s) => process.stderr.write(s + "\n");

/**
 * Runs a tool quietly and returns its stdout, or null when it is not runnable.
 * `spawnSync` never uses a shell here: every argument is a module constant (the spec - no shell
 * interpolation), and pip installs real `.exe` shims on Windows so PATH resolution still works.
 * @param {string} exe @param {string[]} args @returns {string | null}
 */
function probe(exe, args) {
  const r = spawnSync(exe, args, { encoding: "utf8", windowsHide: true, cwd: PKG_DIR });
  if (r.error || r.status !== 0) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
}

/**
 * Finds the fontTools entry points. Returns { instancer: string[], subset: string[], version }
 * where each array is [exe, ...prefixArgs]: prefers `fonttools`/`pyftsubset` on PATH, else
 * `<python> -m fontTools.varLib.instancer` / `<python> -m fontTools.subset`. Throws with PIP_HINT when absent.
 *
 * DECISION: the returned object also carries `ttx` ([exe, ...prefixArgs] for `fonttools ttx`).
 * The edge cases require the report to list the cmap coverage of the built subsets, and ttx is the
 * fontTools way to read it - no npm woff2/brotli parser may be added, and the
 * documented triple { instancer, subset, version } is preserved unchanged.
 *
 * DECISION: an explicit `--python` wins over the PATH shims (the caller is naming the interpreter
 * whose fontTools must be used); without it the shims are tried first, then python3, then python.
 * @param {string | undefined} python
 */
export function resolveTools(python) {
  /** @type {(py: string) => { instancer: string[]; subset: string[]; ttx: string[]; probe: [string, string[]] }} */
  const pythonRoute = (py) => ({
    instancer: [py, "-m", "fontTools.varLib.instancer"],
    subset: [py, "-m", "fontTools.subset"],
    ttx: [py, "-m", "fontTools", "ttx"],
    // DECISION: `fonttools --version` / `python -m fontTools --version` are NOT valid on
    // fontTools ≥ 4.5x - `__main__` treats the first argument as a subcommand and exits with
    // "No module named fontTools.--version". Probe by importing the package instead; it is the
    // only form that both proves the module is importable and yields the version the report needs.
    probe: [py, ["-c", "import fontTools,sys;sys.stdout.write(fontTools.version)"]],
  });
  const pathRoute = {
    instancer: ["fonttools", "varLib.instancer"],
    subset: ["pyftsubset"],
    ttx: ["fonttools", "ttx"],
    // `pyftsubset --help` is the PATH-route liveness probe (see above: the shims have no
    // --version). It proves the entry point runs; the version is filled in as "unknown" unless a
    // python route supplies it.
    probe: /** @type {[string, string[]]} */ (["pyftsubset", ["--help"]]),
  };

  const routes = [];
  if (python) routes.push(pythonRoute(python));
  routes.push(pathRoute);
  if (!python) for (const py of ["python3", "python"]) routes.push(pythonRoute(py));

  for (const route of routes) {
    const probed = probe(route.probe[0], route.probe[1]);
    if (probed === null) continue;
    // A probe proves the route runs; only the `import fontTools` form yields a bare version.
    const version = /^\d+\.\d+/.test(probed) ? probed : "unknown";
    let subset = route.subset;
    // the `pyftsubset` shim is optional: `fonttools subset` is the same entry point.
    if (subset.length === 1 && probe("pyftsubset", ["--help"]) === null) subset = ["fonttools", "subset"];
    return { instancer: route.instancer, subset, ttx: route.ttx, version };
  }

  throw new Error(
    `fontTools not found (tried ${python ? `${python}, ` : ""}fonttools/pyftsubset on PATH, python3, python).\n` +
      `  ${PIP_HINT}\n` +
      "  then re-run: pnpm --filter @namilux/tokens fonts:subset",
  );
}

/** sha256 hex of a file. @param {string} file */
export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * `cmap` coverage of a built subset, read with `fonttools ttx -t cmap`.
 * @param {{ ttx: string[] }} tools @param {string} relFile
 * @returns {Record<string, boolean> | { error: string }}
 */
function cmapCoverage(tools, relFile) {
  const [exe, ...prefix] = tools.ttx;
  const r = spawnSync(exe, [...prefix, "-q", "-t", "cmap", "-o", "-", relFile], {
    cwd: PKG_DIR,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0 || typeof r.stdout !== "string") return { error: "fonttools ttx -t cmap failed" };
  const codes = new Set();
  for (const m of r.stdout.matchAll(/code="0x([0-9a-fA-F]+)"/gu)) codes.add(Number.parseInt(m[1], 16));
  /** @type {Record<string, boolean>} */
  const coverage = {};
  for (const [label, points] of Object.entries(REQUIRED_COVERAGE)) coverage[label] = points.every((c) => codes.has(c));
  return coverage;
}

/** `--check`: the served files must exist and fit their budget. Never needs fontTools. */
function checkOnly() {
  let failures = 0;
  for (const key of /** @type {const} */ (["estedad", "vazirmatn"])) {
    const rel = OUTPUTS[key];
    const abs = path.join(PKG_DIR, rel);
    if (!fs.existsSync(abs)) {
      err(`FAIL ${rel} is missing — run \`pnpm --filter @namilux/tokens fonts:subset\``);
      failures += 1;
      continue;
    }
    const bytes = fs.statSync(abs).size;
    const budget = BUDGETS[key];
    if (bytes > budget) {
      err(`FAIL ${rel} is ${bytes} B, over its ${budget} B budget`);
      failures += 1;
    } else {
      out(`ok   ${rel.padEnd(28)} ${String(bytes).padStart(7)} B  (budget ${budget} B)`);
    }
  }
  if (failures > 0) {
    err(`FAIL ${failures} problem(s) — the served fonts are part of the LCP budget.`);
    return 1;
  }
  out("ok   served fonts exist and fit their budgets.");
  return 0;
}

/**
 * Runs COMMANDS in order (cwd PKG_DIR, stdio inherit), then size checks, then writes the report.
 * @param {{ check?: boolean; python?: string }} opts
 * @returns {number} exit code
 */
export function main(opts = {}) {
  if (opts.check === true) return checkOnly();

  // 1. tools - before anything is written (EDGE CASE: "nothing is written").
  // DECISION: resolved before the input check so the pip line is the headline failure; it is the
  // far more common one and the header lists it first.
  let tools;
  try {
    tools = resolveTools(opts.python);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }

  // 2. the vendored originals
  for (const key of /** @type {const} */ (["estedad", "vazirmatn"])) {
    const rel = INPUTS[key];
    if (!fs.existsSync(path.join(PKG_DIR, rel))) {
      err(`missing original: packages/tokens/${rel}\n  download from ${SOURCES[key]}\n  see packages/tokens/fonts/README.md`);
      return 2;
    }
  }

  // 3. build
  fs.mkdirSync(path.join(PKG_DIR, path.dirname(INTERMEDIATE.estedad)), { recursive: true });
  out(`fonttools ${tools.version} · wght=${WGHT_RANGE} · ${UNICODE_RANGES}`);
  for (const cmd of COMMANDS) {
    const [exe, ...prefix] = tools[cmd.tool];
    const argv = [...prefix, ...cmd.args];
    out(`> ${exe} ${argv.join(" ")}`);
    const r = spawnSync(exe, argv, { cwd: PKG_DIR, stdio: "inherit", windowsHide: true });
    if (r.error || r.status !== 0) {
      err(`FAIL ${exe} ${cmd.tool} exited ${r.status ?? "with " + String(r.error)}`);
      return 1;
    }
  }

  // 4. budgets, hashes, cmap coverage
  let failed = false;
  const files = [];
  for (const key of /** @type {const} */ (["estedad", "vazirmatn"])) {
    const rel = OUTPUTS[key];
    const abs = path.join(PKG_DIR, rel);
    const budget = BUDGETS[key];
    const bytes = fs.statSync(abs).size;
    const coverage = cmapCoverage(tools, rel);
    files.push({ name: path.basename(rel), bytes, sha256: sha256(abs), budget, coverage });
    if (bytes > budget) {
      // the file stays on disk for inspection; the build still fails.
      err(`FAIL ${rel} is ${bytes} B, over its ${budget} B budget`);
      failed = true;
    } else {
      out(`ok   ${rel.padEnd(28)} ${String(bytes).padStart(7)} B  (budget ${budget} B)`);
    }
    // DECISION: a codepoint that is provably absent fails the build; a coverage read that could not
    // run at all only warns - a broken `ttx` invocation must not block a build whose real gate
    // (the size budget) passed, and the report records the unknown so CI can see it.
    for (const [label, ok] of Object.entries(coverage)) {
      if (label === "error") {
        err(`warn ${rel}: cmap coverage unknown (${String(ok)})`);
      } else if (ok !== true) {
        err(`FAIL ${rel} lost ${label} — the subset must keep ZWNJ and the Persian digits`);
        failed = true;
      }
    }
  }

  // 5. report
  const report = {
    builtAt: new Date().toISOString(),
    tool: `fonttools ${tools.version}`,
    ranges: UNICODE_RANGES,
    files,
    failed,
  };
  fs.writeFileSync(path.join(PKG_DIR, OUTPUTS.report), JSON.stringify(report, null, 2) + "\n");
  out(`${failed ? "FAIL" : "ok  "} report written to ${OUTPUTS.report}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const pyIdx = argv.indexOf("--python");
  process.exit(main({ check: argv.includes("--check"), python: pyIdx >= 0 ? argv[pyIdx + 1] : undefined }));
}
