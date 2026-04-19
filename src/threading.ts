/**
 * Thread a flat list of parsed emails into conversation trees (JWZ
 * algorithm), derive stable thread ids for live ingestion, and
 * normalize subjects for subject-fallback matching.
 *
 * @example
 * ```ts
 * import { buildThreads, parseMessage } from "@oflabs/mail-utils";
 *
 * const emails = await Promise.all(rawEmls.map(parseMessage));
 * const threads = buildThreads(emails);
 * for (const t of threads) {
 *   console.log(t.subject, t.messageCount);
 * }
 * ```
 *
 * @module
 */

import { isOrphanId, synthesizeOrphanId } from "./internal/orphan-id.ts";
import { normalizeSubject as normalize } from "./internal/subject-normalizer.ts";
import type {
  EmailAddress,
  ParsedEmail,
  Thread,
  ThreadNode,
} from "./types.ts";

// ─── public surface ──────────────────────────────────────────────────

/**
 * Strip leading reply / forward / bracket / asterisk markers from a
 * subject line for subject-fallback threading comparison. Handles EN,
 * DE, FR, ES, IT, PT, NL, PL variants plus `[EXT]`-style and
 * `***SPAM***`-style markers. Loop-stripped with a 10-iteration cap.
 *
 * @param subject Raw subject. Non-string input returns `""`.
 * @returns Trimmed subject with every leading prefix removed.
 *
 * @example
 * ```ts
 * normalizeSubject("Re: Fwd: Aw: [EXT] Meeting tomorrow")
 * // "Meeting tomorrow"
 * ```
 */
export function normalizeSubject(subject: string): string {
  return normalize(subject);
}

/**
 * Derive a stable thread id for a single email, without running the
 * full JWZ batch threader. Use during live ingestion to assign a
 * `thread_id` column before storage.
 *
 * Logic:
 * 1. If `references[0]` is set, return it — that's the root of the chain.
 * 2. Else if `inReplyTo` is set, return it.
 * 3. Else if `messageId` is set, return it.
 * 4. Else synthesize a deterministic `<orphan.{hash}@local>` id so that
 *    re-ingesting the same orphan email produces the same thread id.
 *
 * @param email The email to derive a thread id for.
 * @returns A stable thread id — always a string, never `undefined`.
 *
 * @example
 * ```ts
 * import { getThreadId, isOrphanId } from "@oflabs/mail-utils";
 *
 * declare const email: ParsedEmail;
 * const id = getThreadId(email);
 *
 * if (isOrphanId(id)) {
 *   // synthesized — reply composition should omit In-Reply-To
 * }
 * ```
 */
export function getThreadId(email: ParsedEmail): string {
  const rootFromReferences = email.references[0];

  if (rootFromReferences) {
    return rootFromReferences;
  }

  if (email.inReplyTo) {
    return email.inReplyTo;
  }

  if (email.messageId) {
    return email.messageId;
  }

  return synthesizeOrphanId(email);
}

/**
 * Thread a flat list of parsed emails into conversation trees using
 * the JWZ algorithm (Jamie Zawinski's `www.jwz.org/doc/threading.html`).
 *
 * Input order does not affect the output. Emails sharing a
 * `Message-ID` are deduplicated with a deterministic scoring rule
 * (richer content wins; ties break on total header count, then the
 * later date). Missing parents produce virtual-root nodes when they
 * have ≥2 children so orphan siblings stay grouped. Parent-pointer
 * cycles are detected and broken.
 *
 * For live ingestion of a single new email against an existing
 * thread set, use {@link ingestIntoThreads} instead.
 *
 * @param emails The flat email set to thread.
 * @returns The resulting {@link Thread}s, ordered by `lastDate`
 * descending (most recent activity first).
 *
 * @example
 * ```ts
 * import { buildThreads, parseMessage } from "@oflabs/mail-utils";
 *
 * declare const raws: string[];
 * const emails = await Promise.all(raws.map(parseMessage));
 * const threads = buildThreads(emails);
 * for (const t of threads) console.log(t.subject, t.messageCount);
 * ```
 */
export function buildThreads(
  emails: ReadonlyArray<ParsedEmail>,
): Thread[] {
  const deduped = dedupeByMessageId(emails);
  const containers = buildContainerMap(deduped);

  linkByReferences(containers, deduped);
  linkBySubjectFallback(containers);

  const roots = collectRoots(containers);
  const pruned = roots.flatMap(pruneEmptyContainers);

  const threads = pruned.map(buildThreadFromContainer);

  threads.sort(compareThreadsByLastDate);

  return threads;
}

/**
 * Insert a single newly-arrived email into an existing set of
 * threads, returning a new array plus the id of the affected thread.
 *
 * Matches against an existing thread via In-Reply-To / References;
 * falls back to subject matching within ±7 days of the thread's
 * `lastDate` when no id link is found. Creates a single-message
 * thread on no match. Never mutates the input array.
 *
 * The counterpart to {@link buildThreads} for the batch case.
 *
 * @param email The new email to ingest.
 * @param threads The existing threads (not mutated).
 * @returns New threads array and `affectedThreadId` — the id of the
 * thread that now contains the email (either an existing match or
 * the freshly-created single-message thread).
 *
 * @example
 * ```ts
 * import { ingestIntoThreads } from "@oflabs/mail-utils";
 *
 * let threads: Thread[] = [];
 *
 * for await (const email of incomingEmails) {
 *   const result = ingestIntoThreads(email, threads);
 *   threads = result.threads;
 *   await markThreadDirty(result.affectedThreadId);
 * }
 * ```
 */
export function ingestIntoThreads(
  email: ParsedEmail,
  threads: ReadonlyArray<Thread>,
): { threads: Thread[]; affectedThreadId: string } {
  const match = findMatchingThread(email, threads);

  if (match) {
    const updated = insertEmailIntoThread(email, match);
    const next = threads.map((t) => (t === match ? updated : t));

    return { threads: next, affectedThreadId: updated.id };
  }

  const fresh = singleMessageThread(email);

  return { threads: [...threads, fresh], affectedThreadId: fresh.id };
}

// ─── JWZ container implementation ────────────────────────────────────

interface Container {
  // Display form of the Message-ID — what callers get back on
  // ThreadNode.messageId / Thread.id. Preserves whichever form first
  // created the container (usually bracketed RFC form).
  messageId: string;
  // Canonical form (brackets + whitespace stripped) — the stable
  // identity used as the map key and for every parent / cycle
  // comparison. Lets `<id@host>` in Message-ID match `id@host` in
  // In-Reply-To / References across mail systems that normalize one
  // but not the other.
  canonicalId: string;
  email: ParsedEmail | undefined;
  // Canonical form of parent's id; undefined for roots.
  parentCanonicalId: string | undefined;
  children: Container[];
}

// Strip surrounding whitespace and angle brackets from a Message-ID
// for equality comparisons. Never mutates stored display ids.
function canonicalMessageId(id: string): string {
  let s = id.trim();

  if (s.startsWith("<")) s = s.slice(1);
  if (s.endsWith(">")) s = s.slice(0, -1);

  return s.trim();
}

function makeContainer(messageId: string, canonicalId: string): Container {
  return {
    messageId,
    canonicalId,
    email: undefined,
    parentCanonicalId: undefined,
    children: [],
  };
}

function ensureContainer(
  map: Map<string, Container>,
  rawId: string,
): Container {
  const key = canonicalMessageId(rawId);
  const existing = map.get(key);

  if (existing) {
    return existing;
  }

  const container = makeContainer(rawId, key);

  map.set(key, container);

  return container;
}

function scoreEmail(email: ParsedEmail): number {
  let score = 0;

  if (email.html) score += 3;
  if (email.text) score += 2;
  if (email.attachments.length > 0) score += 1;

  return score;
}

function totalHeaderOccurrences(email: ParsedEmail): number {
  let count = 0;

  for (const arr of email.headers.values()) {
    count += arr.length;
  }

  return count;
}

// Returns `true` when `candidate` should replace `existing` under the
// deterministic tiebreak rules (richer content wins; then more header
// occurrences; then later date; otherwise first-seen wins).
function candidateIsRicher(
  candidate: ParsedEmail,
  existing: ParsedEmail,
): boolean {
  const candidateScore = scoreEmail(candidate);
  const existingScore = scoreEmail(existing);

  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }

  const candidateHeaders = totalHeaderOccurrences(candidate);
  const existingHeaders = totalHeaderOccurrences(existing);

  if (candidateHeaders !== existingHeaders) {
    return candidateHeaders > existingHeaders;
  }

  const candidateDate = candidate.date?.getTime();
  const existingDate = existing.date?.getTime();

  if (candidateDate !== undefined && existingDate !== undefined) {
    return candidateDate > existingDate;
  }

  return false;
}

function dedupeByMessageId(
  emails: ReadonlyArray<ParsedEmail>,
): ParsedEmail[] {
  // Dedupe orphans by their synthesized id alongside real Message-IDs
  // so two orphans with identical hashable fields don't silently
  // collide later in buildContainerMap. Keyed by canonical form so
  // `<id@host>` and `id@host` count as the same message.
  const byId = new Map<string, ParsedEmail>();

  for (const email of emails) {
    const raw = email.messageId ?? synthesizeOrphanId(email);
    const key = canonicalMessageId(raw);
    const existing = byId.get(key);

    if (!existing) {
      byId.set(key, email);

      continue;
    }

    if (candidateIsRicher(email, existing)) {
      byId.set(key, email);
    }
  }

  return [...byId.values()];
}

function buildContainerMap(
  emails: ReadonlyArray<ParsedEmail>,
): Map<string, Container> {
  const map = new Map<string, Container>();

  for (const email of emails) {
    const rawId = email.messageId ?? synthesizeOrphanId(email);
    const container = ensureContainer(map, rawId);

    container.email = email;
    // Prefer the email's own Message-ID as the display form — even if
    // the container was first created from a reference in a different
    // bracket style.
    container.messageId = rawId;
  }

  return map;
}

function linkByReferences(
  map: Map<string, Container>,
  emails: ReadonlyArray<ParsedEmail>,
): void {
  for (const email of emails) {
    linkReferenceChain(map, email.references);

    const childRawId = email.messageId ?? synthesizeOrphanId(email);
    const childKey = canonicalMessageId(childRawId);
    const child = map.get(childKey);

    if (!child || child.parentCanonicalId !== undefined) {
      continue;
    }

    const parentRawId = findParentId(email);

    if (!parentRawId) {
      continue;
    }

    const parentKey = canonicalMessageId(parentRawId);

    if (parentKey === childKey) {
      continue;
    }

    if (wouldCreateCycle(map, childKey, parentKey)) {
      // Linking `child → parent` would close a cycle; keep child a
      // root rather than silently dropping it.
      continue;
    }

    const parent = ensureContainer(map, parentRawId);

    child.parentCanonicalId = parentKey;
    parent.children.push(child);
  }
}

// Link every consecutive pair in a References list: for
// `[root, middle, parent]`, set middle.parent = root and
// parent.parent = middle. Creates virtual containers for any missing
// ids so pruning can later promote a single live descendant up to the
// nearest real ancestor.
function linkReferenceChain(
  map: Map<string, Container>,
  refs: ReadonlyArray<string>,
): void {
  for (let i = 0; i < refs.length - 1; i++) {
    const parentRawId = refs[i]!;
    const childRawId = refs[i + 1]!;
    const parentKey = canonicalMessageId(parentRawId);
    const childKey = canonicalMessageId(childRawId);

    if (parentKey === childKey) {
      continue;
    }

    const childContainer = ensureContainer(map, childRawId);

    if (childContainer.parentCanonicalId !== undefined) {
      continue;
    }

    if (wouldCreateCycle(map, childKey, parentKey)) {
      continue;
    }

    const parentContainer = ensureContainer(map, parentRawId);

    childContainer.parentCanonicalId = parentKey;
    parentContainer.children.push(childContainer);
  }
}

// Walks the existing parent chain starting at `parentKey`; returns
// `true` if it reaches `childKey`, which would mean linking them
// closes a cycle. Also breaks out on any pre-existing cycle in the
// map to stay finite.
function wouldCreateCycle(
  map: Map<string, Container>,
  childKey: string,
  parentKey: string,
): boolean {
  const visited = new Set<string>();
  let cursor: string | undefined = parentKey;

  while (cursor !== undefined) {
    if (cursor === childKey) {
      return true;
    }

    if (visited.has(cursor)) {
      return true;
    }

    visited.add(cursor);
    cursor = map.get(cursor)?.parentCanonicalId;
  }

  return false;
}

function findParentId(email: ParsedEmail): string | undefined {
  if (email.inReplyTo) {
    return email.inReplyTo;
  }

  // Per JWZ: last entry of References is the immediate parent.
  const refs = email.references;

  return refs.length > 0 ? refs[refs.length - 1] : undefined;
}

function linkBySubjectFallback(map: Map<string, Container>): void {
  // Group candidate roots by normalized subject within a ±7-day window.
  // Require at least one shared participant before merging — prevents
  // unrelated teams sharing a generic subject ("Meeting", "Planning
  // sync") from being stitched into one thread.
  const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const bySubject = new Map<string, Container[]>();

  for (const container of map.values()) {
    if (container.parentCanonicalId !== undefined || !container.email) {
      continue;
    }

    const subjectKey = normalize(container.email.subject ?? "").toLowerCase();

    if (!subjectKey) {
      continue;
    }

    const list = bySubject.get(subjectKey);

    if (list) {
      list.push(container);
    } else {
      bySubject.set(subjectKey, [container]);
    }
  }

  for (const group of bySubject.values()) {
    if (group.length < 2) {
      continue;
    }

    // Earliest-dated member becomes the synthetic root for the group.
    group.sort(compareContainersByDate);

    const root = group[0]!;
    const rootParts = root.email
      ? emailParticipantSet(root.email)
      : undefined;

    for (let i = 1; i < group.length; i++) {
      const candidate = group[i]!;

      if (!withinWindow(root, candidate, WINDOW_MS)) {
        continue;
      }

      if (!rootParts || !candidate.email) {
        continue;
      }

      const candParts = emailParticipantSet(candidate.email);

      if (!sharesAddress(rootParts, candParts)) {
        continue;
      }

      candidate.parentCanonicalId = root.canonicalId;
      root.children.push(candidate);
    }
  }

}

function emailParticipantSet(email: ParsedEmail): Set<string> {
  const set = new Set<string>();

  if (email.from) set.add(email.from.address.toLowerCase());
  for (const a of email.to) set.add(a.address.toLowerCase());
  for (const a of email.cc) set.add(a.address.toLowerCase());
  for (const a of email.bcc) set.add(a.address.toLowerCase());

  return set;
}

function sharesAddress(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true;
  }

  return false;
}

function withinWindow(
  a: Container,
  b: Container,
  windowMs: number,
): boolean {
  const da = a.email?.date?.getTime();
  const db = b.email?.date?.getTime();

  if (da === undefined || db === undefined) {
    return false;
  }

  return Math.abs(da - db) <= windowMs;
}

function collectRoots(map: Map<string, Container>): Container[] {
  const roots: Container[] = [];

  for (const container of map.values()) {
    if (container.parentCanonicalId === undefined) {
      roots.push(container);
    }
  }

  return roots;
}

// JWZ container-pruning rules:
//   · 0 children → delete if empty.
//   · 1 child and container empty → promote the child.
//   · ≥2 children and container empty → keep as virtual root.
// Always recurse before deciding, so children are already pruned.
function pruneEmptyContainers(node: Container): Container[] {
  const prunedChildren: Container[] = [];

  for (const child of node.children) {
    prunedChildren.push(...pruneEmptyContainers(child));
  }

  node.children = prunedChildren;

  if (node.email) {
    return [node];
  }

  if (prunedChildren.length === 0) {
    return [];
  }

  if (prunedChildren.length === 1) {
    const only = prunedChildren[0]!;

    only.parentCanonicalId = undefined;

    return [only];
  }

  return [node];
}

function buildThreadFromContainer(root: Container): Thread {
  const sortedRoot = sortChildrenRecursively(root);
  const node = toThreadNode(sortedRoot);
  const participants = collectParticipants(sortedRoot);
  const messageCount = countMessages(sortedRoot);
  const lastDate = computeLastDate(sortedRoot);
  const subject = root.email?.subject
    ? normalize(root.email.subject)
    : undefined;

  const thread: Thread = {
    id: root.messageId,
    root: node,
    participants,
    messageCount,
    ...(subject !== undefined && subject.length > 0 ? { subject } : {}),
    ...(lastDate !== undefined ? { lastDate } : {}),
  };

  return thread;
}

function sortChildrenRecursively(node: Container): Container {
  for (const child of node.children) {
    sortChildrenRecursively(child);
  }

  node.children.sort(compareContainersByDate);

  return node;
}

function compareContainersByDate(a: Container, b: Container): number {
  const da = a.email?.date?.getTime();
  const db = b.email?.date?.getTime();

  if (da !== undefined && db !== undefined) {
    return da - db;
  }

  if (da !== undefined) return -1;
  if (db !== undefined) return 1;

  return 0;
}

function compareThreadsByLastDate(a: Thread, b: Thread): number {
  const da = a.lastDate?.getTime();
  const db = b.lastDate?.getTime();

  if (da !== undefined && db !== undefined) return db - da;
  if (da !== undefined) return -1;
  if (db !== undefined) return 1;

  return 0;
}

function toThreadNode(container: Container): ThreadNode {
  const children = container.children.map(toThreadNode);

  if (container.email) {
    return {
      email: container.email,
      messageId: container.messageId,
      children,
    };
  }

  return { messageId: container.messageId, children };
}

function collectParticipants(node: Container): EmailAddress[] {
  const seen = new Map<string, EmailAddress>();

  function visit(container: Container): void {
    if (container.email) {
      const email = container.email;

      if (email.from) {
        addParticipant(seen, email.from);
      }

      for (const a of email.to) addParticipant(seen, a);
      for (const a of email.cc) addParticipant(seen, a);
      for (const a of email.bcc) addParticipant(seen, a);
    }

    for (const child of container.children) visit(child);
  }

  visit(node);

  return [...seen.values()];
}

function addParticipant(
  map: Map<string, EmailAddress>,
  address: EmailAddress,
): void {
  const key = address.address.toLowerCase();

  if (!map.has(key)) {
    map.set(key, address);
  }
}

function countMessages(node: Container): number {
  let count = node.email ? 1 : 0;

  for (const child of node.children) {
    count += countMessages(child);
  }

  return count;
}

function computeLastDate(node: Container): Date | undefined {
  let latest: Date | undefined;

  function visit(container: Container): void {
    const d = container.email?.date;

    if (d && (!latest || d.getTime() > latest.getTime())) {
      latest = d;
    }

    for (const child of container.children) visit(child);
  }

  visit(node);

  return latest;
}

// ─── ingestIntoThreads helpers ───────────────────────────────────────

function findMatchingThread(
  email: ParsedEmail,
  threads: ReadonlyArray<Thread>,
): Thread | undefined {
  const candidateKeys = new Set<string>();

  if (email.inReplyTo) candidateKeys.add(canonicalMessageId(email.inReplyTo));
  for (const r of email.references) candidateKeys.add(canonicalMessageId(r));

  if (candidateKeys.size > 0) {
    const threadIds = collectAllMessageIds(threads);

    for (const key of candidateKeys) {
      const threadId = threadIds.get(key);

      if (threadId !== undefined) {
        return threadById(threads, threadId);
      }
    }
  }

  const subjectKey = normalize(email.subject ?? "").toLowerCase();

  if (!subjectKey) {
    return undefined;
  }

  const emailParts = emailParticipantSet(email);

  for (const thread of threads) {
    if (!thread.subject || thread.subject.toLowerCase() !== subjectKey) {
      continue;
    }

    if (!datesWithinWindow(email.date, thread.lastDate)) {
      continue;
    }

    // Require ≥1 shared participant so unrelated threads sharing a
    // generic subject don't merge on subject alone.
    const threadParts = threadParticipantSet(thread);

    if (!sharesAddress(emailParts, threadParts)) {
      continue;
    }

    return thread;
  }

  return undefined;
}

// canonical Message-ID -> thread id (display form)
function collectAllMessageIds(
  threads: ReadonlyArray<Thread>,
): Map<string, string> {
  const map = new Map<string, string>();

  function visit(threadId: string, node: ThreadNode): void {
    map.set(canonicalMessageId(node.messageId), threadId);

    for (const child of node.children) visit(threadId, child);
  }

  for (const thread of threads) {
    visit(thread.id, thread.root);
  }

  return map;
}

function threadParticipantSet(thread: Thread): Set<string> {
  const set = new Set<string>();

  for (const p of thread.participants) {
    set.add(p.address.toLowerCase());
  }

  return set;
}

function threadById(
  threads: ReadonlyArray<Thread>,
  id: string,
): Thread | undefined {
  return threads.find((t) => t.id === id);
}

function datesWithinWindow(
  a: Date | undefined,
  b: Date | undefined,
): boolean {
  if (!a || !b) return false;

  return Math.abs(a.getTime() - b.getTime()) <= 7 * 24 * 60 * 60 * 1000;
}

function insertEmailIntoThread(
  email: ParsedEmail,
  thread: Thread,
): Thread {
  const messageId = email.messageId ?? synthesizeOrphanId(email);
  const newNode: ThreadNode = {
    email,
    messageId,
    children: [],
  };
  const parentRawId = findParentId(email);
  const parentKey = parentRawId
    ? canonicalMessageId(parentRawId)
    : undefined;
  const attempt = insertUnderParent(thread.root, newNode, parentKey);

  // If no parent was found in the tree, attach the new node as a
  // direct child of the thread root so the email is never silently
  // dropped despite messageCount / participants having been updated.
  const root = attempt.inserted
    ? attempt.node
    : {
        ...thread.root,
        children: sortNodes([...thread.root.children, newNode]),
      };

  const participants = mergeParticipants(thread.participants, email);
  const messageCount = thread.messageCount + 1;
  const lastDate = maxDate(thread.lastDate, email.date);

  return {
    id: thread.id,
    root,
    participants,
    messageCount,
    ...(thread.subject !== undefined ? { subject: thread.subject } : {}),
    ...(lastDate !== undefined ? { lastDate } : {}),
  };
}

function insertUnderParent(
  node: ThreadNode,
  newNode: ThreadNode,
  parentKey: string | undefined,
): { node: ThreadNode; inserted: boolean } {
  if (parentKey && canonicalMessageId(node.messageId) === parentKey) {
    return {
      node: {
        ...node,
        children: sortNodes([...node.children, newNode]),
      },
      inserted: true,
    };
  }

  let inserted = false;
  const newChildren = node.children.map((c) => {
    const result = insertUnderParent(c, newNode, parentKey);

    if (result.inserted) inserted = true;

    return result.node;
  });

  if (inserted) {
    return { node: { ...node, children: newChildren }, inserted: true };
  }

  return { node, inserted: false };
}

function sortNodes(
  nodes: ReadonlyArray<ThreadNode>,
): ThreadNode[] {
  const arr = [...nodes];

  arr.sort((a, b) => {
    const da = a.email?.date?.getTime();
    const db = b.email?.date?.getTime();

    if (da !== undefined && db !== undefined) return da - db;
    if (da !== undefined) return -1;
    if (db !== undefined) return 1;

    return 0;
  });

  return arr;
}

function mergeParticipants(
  existing: ReadonlyArray<EmailAddress>,
  email: ParsedEmail,
): EmailAddress[] {
  const map = new Map<string, EmailAddress>();

  for (const a of existing) {
    map.set(a.address.toLowerCase(), a);
  }

  if (email.from) addParticipant(map, email.from);
  for (const a of email.to) addParticipant(map, a);
  for (const a of email.cc) addParticipant(map, a);
  for (const a of email.bcc) addParticipant(map, a);

  return [...map.values()];
}

function maxDate(
  a: Date | undefined,
  b: Date | undefined,
): Date | undefined {
  if (!a) return b;
  if (!b) return a;

  return a.getTime() >= b.getTime() ? a : b;
}

function singleMessageThread(email: ParsedEmail): Thread {
  const messageId = email.messageId ?? synthesizeOrphanId(email);
  const root: ThreadNode = { email, messageId, children: [] };
  const participants = mergeParticipants([], email);
  const normalized = normalize(email.subject ?? "");
  const subject = normalized.length > 0 ? normalized : undefined;

  return {
    id: messageId,
    root,
    participants,
    messageCount: 1,
    ...(subject !== undefined ? { subject } : {}),
    ...(email.date !== undefined ? { lastDate: email.date } : {}),
  };
}

// `isOrphanId` is re-exported for downstream composition use.
export { isOrphanId };
