// diff-speed: a faster drop-in for makefun-diff 1.0.0.
//
// The same patch, written the same way: the common prefix is kept, then the common suffix of
// what is left, then Myers's greedy search between them (the deletion wins a tie), then hunks
// of 3 context lines. What changes is how the search runs: lines are interned to small integers
// once, the search keeps its diagonals in flat Int32Arrays (one per edit depth, kept for the
// backtrack), and no path objects are ever built. The search's decisions — which diagonal, which
// edit, how far each snake runs — are the baseline's, step for step, so the script it finds is
// the baseline's script, and the patch it writes is the baseline's patch.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** The op of a kept, a deleted and an inserted line, as the patch writes them. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * Splits a text into lines and appends one integer id per line to `ids`. A line's id says which
 * distinct line it is and whether it ends in "\n": two lines share an id only when they are the
 * same code units, newline or its absence included. Returns the split parts, kept so the patch
 * can write the lines back without rebuilding them first.
 */
function internLines(text, map, ids) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) {
    const p = parts[i];
    let base = map.get(p);
    if (base === undefined) {
      base = map.size;
      map.set(p, base);
    }
    ids.push(base * 2 + 1);
  }
  if (parts[last] !== '') {
    const p = parts[last];
    let base = map.get(p);
    if (base === undefined) {
      base = map.size;
      map.set(p, base);
    }
    ids.push(base * 2);
  }
  return parts;
}

/**
 * The runs of the edit script of a into b: [{ kind, count }], in order. a and b are the middle
 * section only, after the common prefix and suffix are trimmed. The search is Myers's greedy
 * search as the baseline runs it: for d = 0, 1, 2, ... edits and each diagonal k = x - y from
 * -d to d in steps of 2, the furthest point a path of d edits reaches on k is one old line past
 * the (d-1)-point on diagonal k - 1 (a deletion) or one new line past the (d-1)-point on
 * diagonal k + 1 (an insertion), whichever lies further into the old text, and the deletion when
 * both reach the same point; a move past the end of either text is no candidate. From that point
 * the path keeps every line equal in both texts as far as it can. The first path to reach both
 * ends is the script. The backtrack reads the stored diagonals, so the snake of each depth is
 * the stretch between the edit step and the next position, found by arithmetic, never by
 * re-comparing lines.
 */
function myersRuns(a, b) {
  const N = a.length;
  const M = b.length;
  if (N === 0 && M === 0) return [];
  // Vs[d] is the diagonals after d edits: Vs[d][k + d + 2] holds the old lines consumed plus
  // one (0 for no path) on diagonal k, after that depth's snake. Two padding slots on each
  // side hold 0, so the neighbours a depth reads are always in bounds and need no check.
  const Vs = [];
  let D = -1;
  outer: for (let d = 0; d <= N + M; d++) {
    const V = new Int32Array(2 * d + 5);
    Vs.push(V);
    if (d === 0) {
      let x = 0;
      let y = 0;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      V[2] = x + 1;
      if (x === N && y === M) {
        D = 0;
        break;
      }
      continue;
    }
    const Vp = Vs[d - 1];
    for (let k = -d; k <= d; k += 2) {
      const removeX = Vp[k + d] - 1;
      const addX = Vp[k + d + 2] - 1;
      const canRemove = removeX !== -1 && removeX < N;
      const canAdd = addX !== -1 && addX - k <= M;
      if (!canRemove && !canAdd) {
        V[k + d + 2] = 0;
        continue;
      }
      // The deletion's reach is one old line past the (d-1)-point on k - 1, the insertion's is
      // the (d-1)-point on k + 1; the further one wins, the deletion on a tie.
      let x;
      if (canRemove && (!canAdd || removeX + 1 >= addX)) x = removeX + 1;
      else x = addX;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      V[k + d + 2] = x + 1;
      if (x === N && y === M) {
        D = d;
        break outer;
      }
    }
  }
  // Backtrack from (N, M): each depth contributes its snake (as keeps) and its one edit.
  const rev = [];
  let x = N;
  let y = M;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const Vp = Vs[d - 1];
    const removeX = Vp[k + d] - 1;
    const addX = Vp[k + d + 2] - 1;
    const canRemove = removeX !== -1 && removeX < N;
    const canAdd = addX !== -1 && addX - k <= M;
    let prevX;
    let prevY;
    let kind;
    if (canRemove && (!canAdd || removeX + 1 >= addX)) {
      prevX = removeX;
      prevY = removeX - (k - 1);
      kind = DELETE;
    } else {
      prevX = addX;
      prevY = addX - (k + 1);
      kind = INSERT;
    }
    const snake = kind === DELETE ? x - (prevX + 1) : x - prevX;
    if (snake > 0) rev.push({ kind: KEEP, count: snake });
    rev.push({ kind, count: 1 });
    x = prevX;
    y = prevY;
  }
  if (x > 0) rev.push({ kind: KEEP, count: x });
  // Reverse, merging runs of one kind that touch.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of input.old into input.new (the header). */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;
  // One shared intern table, so a line both texts hold gets one id in both.
  const map = new Map();
  const aIds = [];
  const bIds = [];
  const aParts = internLines(oldText, map, aIds);
  const bParts = internLines(newText, map, bIds);
  const a = Int32Array.from(aIds);
  const b = Int32Array.from(bIds);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  pushRun(KEEP, prefix);
  for (const r of myersRuns(a.subarray(prefix, prefix + (n - prefix - suffix)), b.subarray(prefix, prefix + (m - prefix - suffix)))) {
    pushRun(r.kind, r.count);
  }
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  // A line of a text, with its "\n" (the last one without, when the text does not end in one).
  const aLine = (i) => (i < aParts.length - 1 ? `${aParts[i]}\n` : aParts[i]);
  const bLine = (i) => (i < bParts.length - 1 ? `${bParts[i]}\n` : bParts[i]);
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', aLine(at)));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aLine(c.o + i)));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bLine(c.p + i)));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aLine(at)));
  }
  return out.join('');
}
