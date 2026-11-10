import { hasSolvedToday, timestampToDateString } from '../shared/streak-calculator.js';

const REMINDER_KEY = 'eno_reminder_shown_date';
const FPS = 19;
const SEGMENTS = [38, 57, 10, 66, 95, 133, 95, 95];

export async function maybeShowEnoReminder(sendMessage) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.runtime?.id) return;

  const baseUrl = chrome.runtime.getURL('eno/');
  const assets = Object.fromEntries(
    ['walk-left.png', 'walk-right.png', 'front-wave.png', 'bow.png', 'seat.png', 'typing.png']
      .map(name => [name, `${baseUrl}${name}`])
  );

  // Expose manual trigger for debugging/preview anytime
  if (typeof window !== 'undefined') {
    const triggerNow = async () => {
      console.log('[LeetStreak Eno] Manual trigger requested.');
      try {
        await Promise.all(Object.values(assets).map(loadImage));
        playEnoReminder(assets, 'force-preview');
      } catch (err) {
        console.error('[LeetStreak Eno] Failed to load mascot images:', err);
      }
    };

    window.__leetStreakTriggerEno = triggerNow;

    // Listen for postMessage from the main page console (top context)
    window.addEventListener('message', async (event) => {
      if (event.data === 'LEETSTREAK_TRIGGER_ENO' || event.data?.type === 'LEETSTREAK_TRIGGER_ENO') {
        try {
          await chrome.storage.local.remove(REMINDER_KEY);
        } catch {}
        triggerNow();
      }
    });
  }

  const settings = await chrome.storage.local.get([
    REMINDER_KEY,
    'last_solve_date',
    'user_timezone'
  ]);
  const today = timestampToDateString(Math.floor(Date.now() / 1000), settings.user_timezone);

  if (settings[REMINDER_KEY] === today) {
    console.log(`[LeetStreak Eno] Already shown today (${today}). Run window.__leetStreakTriggerEno() in console to preview.`);
    return;
  }
  if (settings.last_solve_date === today) {
    console.log(`[LeetStreak Eno] Already solved today (${today}) according to last_solve_date.`);
    return;
  }

  let solvedToday = false;
  try {
    const response = await sendMessage({ type: 'FETCH_OWN_PROFILE' });
    const profile = response?.ownProfile;
    if (profile) {
      solvedToday = hasSolvedToday(
        profile.allAcceptedSubmissions || [],
        profile.submissionCalendar || {},
        settings.user_timezone
      );
    }
  } catch (err) {
    console.warn('[LeetStreak Eno] Profile check failed, checking fallback:', err);
  }

  if (solvedToday) {
    console.log(`[LeetStreak Eno] Solved today (${today}), skipping reminder.`);
    return;
  }

  try {
    await Promise.all(Object.values(assets).map(loadImage));
  } catch (imgErr) {
    console.warn('[LeetStreak Eno] Could not load mascot assets:', imgErr);
    return;
  }

  const current = await chrome.storage.local.get([REMINDER_KEY, 'last_solve_date']);
  if (current[REMINDER_KEY] === today || current.last_solve_date === today) return;
  await chrome.storage.local.set({ [REMINDER_KEY]: today });

  console.log('[LeetStreak Eno] Starting streak reminder animation!');
  playEnoReminder(assets, today);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = reject;
    image.src = src;
  });
}

function playEnoReminder(assets, today) {
  if (window.__leetStreakEnoActive) return;
  window.__leetStreakEnoActive = true;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'false');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .viewport { position: fixed; inset: 0; z-index: 2147483646; overflow: hidden; pointer-events: none; }
      .actor { position: absolute; bottom: clamp(12px, 2.4vh, 28px); left: 50%; width: min(320px, 36vh, 52vw); aspect-ratio: 8 / 9; transform: translateX(-50%); transform-origin: 50% 86%; will-change: left, transform; clip-path: inset(0); }
      .art { position: absolute; inset: 0; background-repeat: no-repeat; opacity: 0; will-change: opacity; }
      .laptop { position: absolute; left: 31%; bottom: 11%; width: 46%; opacity: 0; transform-origin: 50% 85%; will-change: opacity, transform; }
      .laptop svg { display: block; width: 100%; height: auto; }
      .bubble { position: absolute; left: calc(50% - 180px); bottom: calc(min(360px, 40.5vh, 58.5vw) + clamp(12px, 2.4vh, 28px) + 16px); width: min(440px, calc(100vw - 32px)); box-sizing: border-box; padding: 15px 20px; border: 3px solid #302a32; border-radius: 20px; background: #fffdf9; color: #25212a; box-shadow: 0 5px 0 #302a32; font: 700 clamp(16px, 2vw, 23px)/1.28 system-ui, sans-serif; text-align: center; opacity: 0; transform: translate(-50%, 12px) scale(.92); transform-origin: 50% 100%; transition: opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1); }
      .bubble::after { content: ''; position: absolute; left: calc(100% - 24px); bottom: -15px; width: 20px; height: 20px; background: #fffdf9; border-right: 3px solid #302a32; border-bottom: 3px solid #302a32; transform: translateX(-50%) rotate(45deg); }
      .bubble.visible { opacity: 1; transform: translate(-50%, 0) scale(1); }
      .mark { position: absolute; left: 50%; bottom: calc(min(360px, 40.5vh, 58.5vw) + clamp(12px, 2.4vh, 28px) + 8px); color: #e59a20; font: 900 clamp(40px, 6vh, 64px)/1 system-ui, sans-serif; text-shadow: 0 3px 0 #fff, 2px 4px 0 #302a32; opacity: 0; transform: translate(-50%, 10px) scale(.4) rotate(-12deg); }
      .mark.visible { opacity: 1; animation: pop .42s cubic-bezier(.18,.9,.25,1.4) both, float 900ms ease-in-out .42s infinite alternate; }
      @keyframes pop { to { transform: translate(-50%, 0) scale(1) rotate(0); } }
      @keyframes float { to { translate: 0 -5px; } }
      @media (max-width: 520px) { .bubble { left: 50%; } .bubble::after { left: 50%; } }
      @media (prefers-reduced-motion: reduce) { .bubble { transition: none; } .mark.visible { animation: none; opacity: 1; transform: translate(-50%, 0) scale(1); } }
    </style>
    <div class="viewport">
      <div class="actor">
        <div class="art left"></div>
        <div class="art front"></div>
        <div class="art bow"></div>
        <div class="art right"></div>
        <div class="art seat"></div>
        <div class="art typing"></div>
        <div class="laptop" aria-hidden="true"><svg viewBox="0 0 150 92"><path d="M27 8h96a8 8 0 0 1 8 8v54H19V16a8 8 0 0 1 8-8Z" fill="#16151b" stroke="#08080a" stroke-width="4"/><path d="M26 15h98v48H26z" fill="#252832"/><path d="M11 73h128l8 9q1 4-7 5H10q-7-1-6-5z" fill="#34333a" stroke="#08080a" stroke-width="3"/><path d="M48 29h17m-17 10h28m-28 10h12" stroke="#b7dcff" stroke-width="3" stroke-linecap="round"/><path d="m90 29 5 5-5 5" fill="none" stroke="#b8e986" stroke-width="3"/></svg></div>
      </div>
      <div class="mark" aria-hidden="true">!</div>
      <div class="bubble" role="status" aria-live="polite"></div>
    </div>`;

  const actor = shadow.querySelector('.actor');
  const mark = shadow.querySelector('.mark');
  const bubble = shadow.querySelector('.bubble');
  const layers = {
    left: shadow.querySelector('.left'),
    front: shadow.querySelector('.front'),
    bow: shadow.querySelector('.bow'),
    right: shadow.querySelector('.right'),
    seat: shadow.querySelector('.seat'),
    typing: shadow.querySelector('.typing')
  };
  const laptop = shadow.querySelector('.laptop');

  setSprite(layers.left, assets['walk-left.png'], 6);
  setSprite(layers.front, assets['front-wave.png'], 2);
  setSprite(layers.bow, assets['bow.png'], 1);
  setSprite(layers.right, assets['walk-right.png'], 6);
  setSprite(layers.seat, assets['seat.png'], 1);
  setSprite(layers.typing, assets['typing.png'], 2);
  document.documentElement.appendChild(host);

  const setLayer = (name, opacity, frame = 0, count = 1) => {
    const layer = layers[name];
    layer.style.opacity = String(opacity);
    layer.style.backgroundPosition = count > 1 ? `${(frame / (count - 1)) * 100}% 0` : '0 0';
  };
  const showBubble = text => {
    if (bubble.textContent === text) return;
    bubble.classList.remove('visible');
    bubble.textContent = text;
    if (text) requestAnimationFrame(() => bubble.classList.add('visible'));
  };

  let raf = 0;
  let stopped = false;
  const remove = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    chrome.storage.onChanged?.removeListener(onStorageChange);
    host.remove();
    delete window.__leetStreakEnoActive;
  };
  const onStorageChange = (changes, area) => {
    if (area === 'local' && changes.last_solve_date?.newValue === today) remove();
  };
  chrome.storage.onChanged?.addListener(onStorageChange);

  const ease = p => p * p * (3 - 2 * p);
  const lerp = (a, b, p) => a + (b - a) * p;
  const setFrame = now => {
    if (stopped) return;
    const elapsed = now - start;
    const index = Math.floor(elapsed * FPS / 1_000);
    if (index >= SEGMENTS.reduce((sum, frames) => sum + frames, 0)) return remove();

    const [peekEnd, walkEnd, turnEnd, greetEnd, judgeEnd, codeEnd, smugEnd] = SEGMENTS
      .map((frames, i, all) => all.slice(0, i + 1).reduce((sum, value) => sum + value, 0));
    let x = 0.5, bob = 0, tilt = 0, frame = 0, message = '';
    let left = 0, front = 0, bow = 0, right = 0, seat = 0, typing = 0;
    let markVisible = false, clipPeek = false, laptopProgress = 0;
    let laptopVisible = false;

    if (index < peekEnd) {
      const p = index / peekEnd;
      x = lerp(1.12, 0.99, ease(p)); left = 1; clipPeek = true;
      bob = Math.sin(index * 0.4) * 2; tilt = Math.sin(index * 0.22) * 1.2;
    } else if (index < walkEnd) {
      const local = index - peekEnd; x = lerp(0.99, 0.5, local / (walkEnd - peekEnd));
      left = 1; frame = Math.floor(local / 1.5) % 6; bob = [0, -2, 1, 0, -2, 1][frame];
      markVisible = index < peekEnd + 8;
    } else if (index < turnEnd) {
      const p = ease((index - walkEnd) / (turnEnd - walkEnd)); left = 1 - p; front = p;
    } else if (index < greetEnd) {
      const local = index - turnEnd; front = 1; frame = Math.floor(local / 5) % 2;
      const bowIn = ease(Math.min(1, local / 11));
      const bowOut = ease(Math.max(0, Math.min(1, (local - 12) / 10)));
      bow = Math.min(bowIn, 1 - bowOut); front = 1 - bow;
      tilt = local < 22 ? -3 * bow : Math.sin(local * 0.12) * 0.5;
      message = local >= 24 ? 'Hi! I am ENO!' : '';
    } else if (index < judgeEnd) {
      const local = index - greetEnd; front = 1; frame = Math.floor(local / 6) % 2;
      tilt = local < 42 ? -2.5 : 0;
      message = 'I see you have other important things to do than LeetCode.';
    } else if (index < codeEnd) {
      const local = index - judgeEnd;
      const sitIn = ease(Math.min(1, local / 23));
      const standOut = ease(Math.max(0, Math.min(1, (local - 122) / 11)));
      seat = Math.min(sitIn, 1 - standOut);
      front = 1 - seat;
      const retrieveIn = ease(Math.max(0, Math.min(1, (local - 23) / 21)));
      const stowOut = ease(Math.max(0, Math.min(1, (local - 101) / 21)));
      laptopProgress = Math.min(retrieveIn, 1 - stowOut);
      laptopVisible = (local >= 23 && local < 44) || (local >= 101 && local < 122);
      if (local >= 44 && local < 101) {
        typing = 1; seat = 0; front = 0;
        frame = Math.floor((local - 44) / 3) % 2;
        bob = Math.sin(local * 0.55) * 1.5;
      }
    } else if (index < smugEnd) {
      const local = index - codeEnd; front = 1; frame = Math.floor(local / 6) % 2;
      tilt = local < 25 ? 0 : -1;
      message = 'I have done my LeetCode, but you have not!';
    } else {
      const local = index - smugEnd;
      message = local < 22 ? 'Bye!' : '';
      const turnFrames = 10;
      if (local < turnFrames) {
        const p = ease(local / turnFrames); front = 1 - p; right = p;
      } else {
        const walkFrame = Math.floor((local - turnFrames) / 1.5) % 6;
        const progress = (local - turnFrames) / (SEGMENTS[7] - turnFrames);
        x = lerp(0.5, 1.15, progress); right = 1; frame = walkFrame;
        bob = [0, -2, 1, 0, -2, 1][walkFrame];
      }
    }

    actor.style.left = `${x * 100}%`;
    mark.style.left = `${Math.max(28, Math.min(window.innerWidth - 28, x * window.innerWidth - actor.clientWidth * 0.18))}px`;
    actor.style.transform = `translateX(-50%) translateY(${bob}px) rotate(${tilt}deg)`;
    actor.style.clipPath = clipPeek ? 'inset(0 0 46% 0)' : 'inset(0)';
    setLayer('left', left, frame, 6); setLayer('front', front, frame % 2, 2);
    setLayer('bow', bow, 0, 1); setLayer('right', right, frame, 6);
    setLayer('seat', seat, 0, 1); setLayer('typing', typing, frame, 2);
    laptop.style.opacity = laptopVisible ? String(laptopProgress) : '0';
    laptop.style.transform = `translate(${lerp(-42, 0, laptopProgress)}px, ${lerp(-34, 0, laptopProgress)}px) rotate(${lerp(-18, 0, laptopProgress)}deg)`;
    mark.classList.toggle('visible', markVisible);
    showBubble(message);
    raf = requestAnimationFrame(setFrame);
  };
  const start = performance.now();
  raf = requestAnimationFrame(setFrame);
}

function setSprite(layer, url, count) {
  layer.style.backgroundImage = `url("${url}")`;
  layer.style.backgroundSize = `${count * 100}% 100%`;
  layer.style.backgroundPosition = '0 0';
}
