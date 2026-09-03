// A deliberately dumb DOM stand-in, shared by flow.test.mjs and
// leaderboard.test.mjs so the browser modules can be driven under node.
//
// It implements only the handful of APIs the app actually touches. That's the
// point: a clever fake would end up testing itself. Keep it boring.

import { readFileSync } from 'node:fs';

export class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.style = {};
    this.className = '';
    // Media state, only meaningful on <audio>.
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  focus() {}

  // Enough of HTMLMediaElement to assert that clips get stopped. `pauseCalls`
  // is tracked separately from `paused` so a test can tell "was pause() called"
  // apart from "happened to already be paused".
  play() {
    this.paused = false;
    this.playCalls = (this.playCalls || 0) + 1;
    // Dispatch the real event, so a "play" listener in app code is genuinely
    // exercised rather than silently skipped.
    this.fire('play');
  }

  pause() {
    this.paused = true;
    this.pauseCalls = (this.pauseCalls || 0) + 1;
  }

  /** Invoke listeners directly; there is no real event system here. */
  fire(type) {
    for (const handler of this.listeners[type] || []) {
      handler({ preventDefault() {} });
    }
  }

  descendants() {
    return this.children.flatMap((child) =>
      child instanceof Element ? [child, ...child.descendants()] : []
    );
  }

  /** Tag selectors only, which is all the app asks for. */
  querySelector(selector) {
    return this.descendants().find((node) => node.tag === selector) || null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.tag === selector);
  }

  /** Named controls keyed by name, mirroring HTMLFormElement.elements. */
  get elements() {
    const map = {};
    for (const node of this.descendants()) {
      if (node.name) map[node.name] = node;
    }
    return map;
  }

  /** Every rendered string in this subtree, joined -- for assertions. */
  text() {
    return this.descendants()
      .map((node) => node.textContent)
      .filter(Boolean)
      .join(' | ');
  }

  byClass(className) {
    return this.descendants().filter((node) => node.className === className);
  }
}

/**
 * Build a document whose element registry is derived from the real HTML file,
 * so a renamed id surfaces as a test failure instead of a silent null.
 */
export function buildDocument(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const registry = new Map(ids.map((id) => [id, new Element('div')]));

  return {
    title: '',
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => new Element(tag),
    _registry: registry,
  };
}

export class LocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  clear() {
    this.store.clear();
  }
}

/** Tiny assertion helper shared by both test files. */
export function createChecker() {
  const state = { passed: 0, failures: [] };

  function check(label, actual, expected) {
    if (actual === expected) state.passed++;
    else
      state.failures.push(
        `${label}\n    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
  }

  function report(noun) {
    for (const failure of state.failures) console.error(`  FAIL ${failure}`);

    const total = state.passed + state.failures.length;
    console.log(`\n${state.passed}/${total} ${noun} passed`);

    if (state.failures.length) {
      console.error(`${state.failures.length} failing`);
      process.exit(1);
    }
  }

  return { check, report, state };
}
