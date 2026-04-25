'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { SEQUENCE } from '@/components/Scene3D/Orchestrator';
import type { Howl as HowlType } from 'howler';

const DEBUG =
  typeof window !== 'undefined' &&
  (window.location.search.includes('debug=sounds') ||
    window.location.search.includes('debug=all'));

const dlog = (...args: unknown[]) => {
  if (DEBUG) console.log('%c[sounds]', 'color:#a855f7;font-weight:bold', ...args);
};

type SoundKey = 'whoosh' | 'scan' | 'tick' | 'paint' | 'place' | 'chime';

const SOUND_FILES: Record<SoundKey, string> = {
  whoosh: '/sounds/whoosh.wav',
  scan: '/sounds/scan.wav',
  tick: '/sounds/tick.wav',
  paint: '/sounds/paint.wav',
  place: '/sounds/place.wav',
  chime: '/sounds/chime.wav',
};

const STEP_KIND_TO_SOUND: Record<string, SoundKey> = {
  fetch: 'scan',
  compute: 'scan',
  think: 'tick',
  place: 'place',
  render: 'paint',
  done: 'tick',
};

const STEP_ID_OVERRIDE: Record<string, SoundKey> = {
  ready: 'chime',
  stylize: 'paint',
  panels_drop: 'place',
};

let howls: Partial<Record<SoundKey, HowlType>> | null = null;
let initFailed = false;

async function ensureHowls(): Promise<typeof howls> {
  if (howls || initFailed) return howls;
  if (typeof window === 'undefined') return null;
  try {
    dlog('init: importing howler…');
    const { Howl } = await import('howler');
    howls = {};
    (Object.keys(SOUND_FILES) as SoundKey[]).forEach((k) => {
      try {
        howls![k] = new Howl({
          src: [SOUND_FILES[k]],
          volume: 0.4,
          preload: true,
          html5: true,
          onload: () => dlog(`✓ loaded ${k} (${SOUND_FILES[k]})`),
          onloaderror: (_id, err) => dlog(`✗ load error ${k}:`, err),
          onplayerror: (_id, err) => dlog(`✗ play error ${k}:`, err),
        });
      } catch (e) {
        dlog(`✗ init error ${k}:`, e);
      }
    });
    dlog('init complete, 6 howls created');
    return howls;
  } catch (e) {
    initFailed = true;
    dlog('✗ howler import failed:', e);
    return null;
  }
}

function play(key: SoundKey, reason?: string) {
  void (async () => {
    const h = await ensureHowls();
    if (!h) {
      dlog(`✗ play(${key}) skipped — howls not initialised`);
      return;
    }
    const sound = h[key];
    if (!sound) {
      dlog(`✗ play(${key}) skipped — howl missing`);
      return;
    }
    try {
      const id = sound.play();
      dlog(`▶ play(${key})${reason ? ` — ${reason}` : ''} [id=${id}]`);
    } catch (e) {
      dlog(`✗ play(${key}) threw:`, e);
    }
  })();
}

export function useAgentSounds() {
  const phase = useStore((s) => s.phase);
  const steps = useStore((s) => s.agentSteps);
  const lastDoneIds = useRef<Set<string>>(new Set());
  const lastRunningIds = useRef<Set<string>>(new Set());
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    void ensureHowls();
  }, []);

  // Phase transitions → whoosh
  useEffect(() => {
    if (lastPhase.current !== phase) {
      dlog(`phase: ${lastPhase.current ?? 'init'} → ${phase}`);
      if (
        phase === 'agent-running' ||
        phase === 'interactive' ||
        phase === 'reviewing' ||
        phase === 'approved'
      ) {
        play('whoosh', `phase=${phase}`);
      }
      if (phase === 'approved') {
        play('chime', 'approved');
      }
      lastPhase.current = phase;
    }
  }, [phase]);

  // Per-step sound triggers
  useEffect(() => {
    const runningNow = new Set<string>();
    const doneNow = new Set<string>();
    for (const s of steps) {
      if (s.status === 'running') runningNow.add(s.id);
      if (s.status === 'done') doneNow.add(s.id);
    }

    // newly running → kind-specific sound
    for (const id of runningNow) {
      if (!lastRunningIds.current.has(id)) {
        const meta = SEQUENCE.find((seq) => seq.id === id);
        if (meta) {
          const override = STEP_ID_OVERRIDE[id];
          const key = override ?? STEP_KIND_TO_SOUND[meta.kind] ?? 'tick';
          play(key, `step ${id} → running (kind=${meta.kind})`);
        }
      }
    }

    // newly done → tick (light click)
    for (const id of doneNow) {
      if (!lastDoneIds.current.has(id)) {
        const meta = SEQUENCE.find((seq) => seq.id === id);
        if (meta?.id === 'ready') play('chime', 'step ready done');
        else if (meta?.kind !== 'render') play('tick', `step ${id} done`);
      }
    }

    lastRunningIds.current = runningNow;
    lastDoneIds.current = doneNow;
  }, [steps]);
}
