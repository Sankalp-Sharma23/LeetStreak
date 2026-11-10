export const DAILY_REMINDER_QUOTES = [
  ['desi-01', 'desi roasting', 'Chi chi chi! Ek problem bhi nahi hua aaj? 😭'],
  ['desi-02', 'desi roasting', 'Bhai, LeetCode kholne se placement nahi lagti, solve bhi karna padta hai! 💀'],
  ['desi-03', 'desi roasting', 'Kya kar raha hai mere bhai? Arrays bhi ab tera wait karte karte thak gaye! 😭'],
  ['desi-04', 'desi roasting', 'Itni der toh Maggi bhi nahi leti jitna tu ek problem start karne mein laga raha hai! 🍜'],
  ['desi-05', 'desi roasting', 'Bhai ne aaj bhi DSA ko seen karke chhod diya! 👀'],
  ['desi-06', 'desi roasting', 'Problem solve kar le, warna tera future debugger mein hi atka rahega! 💀'],
  ['desi-07', 'desi roasting', 'Aaj ka target: ek problem. Excuses ka toh unlimited subscription hai tera! 😭'],
  ['desi-08', 'desi roasting', 'Kuch toh sharam kar, even your compiler is waiting for you! 😂'],
  ['parents-01', 'parents and relatives', 'Sharma ji ka beta nahi banna? Toh kam se kam ek problem solve kar le! 💀'],
  ['parents-02', 'parents and relatives', 'Mummy ko bol de padh raha hoon... bas iss baar sach mein padh le! 😭'],
  ['parents-03', 'parents and relatives', 'Relatives shaadi ki age pooch rahe hain, recruiter placement ki. Tu pehle LeetCode kar! 💀'],
  ['parents-04', 'parents and relatives', 'Beta, package kitne ka lagega? Pehle ek problem toh solve kar le! 😂'],
  ['parents-05', 'parents and relatives', 'Ghar wale soch rahe hain engineer ban raha hai, ENO ko sach pata hai! 👀'],
  ['placement-01', 'placement and engineering', 'Google ka interview crack karna hai ya sirf Chrome tabs kholne hain? 👀'],
  ['placement-02', 'placement and engineering', 'Future Netflix and chill se nahi, LeetCode par problems solve karke banao! 💀'],
  ['placement-03', 'placement and engineering', 'Bhai, HR ko tera potential nahi, Accepted submissions chahiye! 😭'],
  ['placement-04', 'placement and engineering', 'Placement season aa jayega, teri lazy season kab khatam hogi? 💀'],
  ['placement-05', 'placement and engineering', 'DSA nahi karega toh interview mein sirf “Good morning sir” se kaam nahi chalega! 😂'],
  ['placement-06', 'placement and engineering', 'Ek problem solve kar le, warna Big Tech bhi tujhe Big Excuse samjhegi! 😭'],
  ['placement-07', 'placement and engineering', 'Tera future SDE banna chahta hai, par tu uska pull request hi merge nahi kar raha! 💀'],
  ['hostel-01', 'hostel and student life', 'Chai thandi ho sakti hai, par tera DSA motivation itna bhi thanda nahi hona chahiye! ☕'],
  ['hostel-02', 'hostel and student life', 'Hostel mein attendance kam aur LeetCode streak bhi? Bhai, kuch toh sambhaal! 😭'],
  ['hostel-03', 'hostel and student life', 'Maggi ke 2 minutes mil gaye, ek LeetCode problem ke 20 minutes nahi? 💀'],
  ['hostel-04', 'hostel and student life', 'Mess ka khana roz kha raha hai, ek problem roz solve nahi ho rahi? 😭'],
  ['hostel-05', 'hostel and student life', 'Bhai, assignment deadline pe kar leta hai, LeetCode ko bhi thoda respect de! 😂'],
  ['cricket-01', 'cricket and extra savage', 'Teri DSA performance dekh ke selector bhi tujhe bench pe bitha de! 🏏'],
  ['cricket-02', 'cricket and extra savage', 'Ek problem maar de bhai, aaj tera LeetCode ka century opening karte hain! 💀'],
  ['cricket-03', 'cricket and extra savage', 'Tu problem se darr raha hai ya problem tujhe dekh ke darr rahi hai? 👀'],
  ['cricket-04', 'cricket and extra savage', 'IPL mein har ball pe action hota hai, aur tere LeetCode mein har din silence! 😭'],
  ['cricket-05', 'cricket and extra savage', 'ENO reminder de deke thak gaya, ab toh compiler bhi tere liye dua kar raha hai! 🥺']
].map(([id, category, text]) => ({ id, category, language: 'hinglish', text }));

export function getLocalDateKey(date = new Date()) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeReminderFrequency(value) {
  if (value === 'off' || value === 'minimal') return 'off';
  if (value === 'reduced' || value === 'important') return 'reduced';
  return 'normal';
}

export function getNextReminderTime(now = new Date(), frequency = 'normal') {
  const normalized = normalizeReminderFrequency(frequency);
  if (normalized === 'off') return null;
  const hours = normalized === 'reduced' ? [11] : [11, 23];
  for (const hour of hours) {
    const candidate = new Date(now);
    candidate.setHours(hour, 0, 0, 0);
    if (candidate > now) return candidate;
  }
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hours[0], 0, 0, 0);
  return next;
}

export function getDueReminderSlot(date = new Date()) {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  if (minuteOfDay >= 23 * 60) return '11pm';
  if (minuteOfDay >= 11 * 60) return '11am';
  return null;
}

export function canDeliverDailyReminder({ date = new Date(), slot, frequency = 'normal', enabled = true, solved = false, deliveredSlots = [] }) {
  if (!enabled || solved || !slot || normalizeReminderFrequency(frequency) === 'off') return false;
  const hour = slot === '11am' ? 11 : slot === '11pm' ? 23 : null;
  if (hour === null) return false;
  if (normalizeReminderFrequency(frequency) === 'reduced' && slot !== '11am') return false;
  if (date.getHours() !== hour || date.getMinutes() > 15) return false;
  return !deliveredSlots.includes(slot);
}

export function selectDailyReminderQuote(lastQuoteId, random = Math.random) {
  const options = DAILY_REMINDER_QUOTES.filter(quote => quote.id !== lastQuoteId);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

export function getDeliveredReminderSlots(state = {}, dayKey) {
  if (Array.isArray(state.deliveredByDay?.[dayKey])) return state.deliveredByDay[dayKey];
  return state.day === dayKey && Array.isArray(state.deliveredSlots) ? state.deliveredSlots : [];
}

export function recordDailyReminderSlot(state = {}, dayKey, slot, quoteId) {
  const deliveredByDay = { ...(state.deliveredByDay || {}) };
  const currentSlots = getDeliveredReminderSlots(state, dayKey);
  deliveredByDay[dayKey] = [...new Set([...currentSlots, slot])];
  const recentDays = Object.keys(deliveredByDay).sort().slice(-14);
  const retained = Object.fromEntries(recentDays.map(day => [day, deliveredByDay[day]]));
  return {
    day: dayKey,
    deliveredSlots: retained[dayKey],
    deliveredByDay: retained,
    lastQuoteId: quoteId || state.lastQuoteId || null
  };
}

export function getCompletedLocalDays(values = [], legacyValue) {
  const days = Array.isArray(values) ? values : [];
  return [...new Set([...days, ...(legacyValue ? [legacyValue] : [])].filter(value => typeof value === 'string'))].slice(-14);
}
