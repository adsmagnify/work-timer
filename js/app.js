// ===== Element References =====
const statusDisplay = document.getElementById('statusDisplay');
const startTimeElement = document.getElementById('startTime');
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbw0qqnD-_3Pa0fNL5GtOssGDj_LHDJRCKQ7mM9abF7qoiU-qHY4VV809mU4lCG12GXhzg/exec';
const authSection = document.getElementById('authSection');
const dashboard = document.getElementById('dashboard');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn = document.getElementById('logoutBtn');
const quoteSection = document.getElementById('quoteSection');


const timerDisplay = document.getElementById('timerDisplay');
const startBtn = document.getElementById('startBtn');
const breakBtn = document.getElementById('breakBtn');
const resumeBtn = document.getElementById('resumeBtn');
const clockoutBtn = document.getElementById('clockoutBtn');
const todayTotalEl = document.getElementById('todayTotal');

// ===== Timer State =====
let timerInt = null;
let elapsedBeforePause = 0;
let sessionStartTime = 0;
let sessionId = null;   // track active session
let breakRef = null;   // track in-progress break
let dailyTotalInterval = null;   // guard for the 1-min updater


async function fetchRandomQuote() {
  const quoteSection = document.getElementById('quoteSection');
  try {
    const res = await fetch('https://dummyjson.com/quotes/random');
    if (!res.ok) throw new Error(res.status);
    const { quote, author } = await res.json();
    quoteSection.textContent = `“${quote}” — ${author}`;
  } catch (err) {
    console.error('Quote fetch failed:', err);
    quoteSection.textContent = '“Stay focused and never give up.”';
  }
}


// ===== UI Mode Controller =====
let currentMode = 'initial';
function setMode(mode) {
  currentMode = mode;
  [startBtn, breakBtn, resumeBtn, clockoutBtn].forEach(b => b.hidden = true);

  switch (mode) {
    case 'initial':
      startBtn.hidden = false;
      break;
    case 'working':
      breakBtn.hidden = false;
      clockoutBtn.hidden = false;
      break;
    case 'onBreak':
      resumeBtn.hidden = false;
      clockoutBtn.hidden = false;
      break;
  }
}

// ===== Utility: ms → "HH:MM:SS" =====
function msToHMS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  return [hr, min, sec]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

// ===== Authentication Flows =====
loginBtn.onclick = () => {
  auth.signInWithEmailAndPassword(emailInput.value, passInput.value)
    .catch(err => alert('Login failed: ' + err.message));
};

registerBtn.onclick = () => {
  auth.createUserWithEmailAndPassword(emailInput.value, passInput.value)
    .catch(err => alert('Registration failed: ' + err.message));
};

logoutBtn.onclick = async () => {
  // Close any active break
  if (sessionId) {
    alert('⚠️ Please clock out before logging out.');
    return;
  }
  if (breakRef) {
    await breakRef.update({ breakEnd: firebase.firestore.FieldValue.serverTimestamp() });
    const snap = await breakRef.get();
    const dur = snap.data().breakEnd.toMillis() - snap.data().breakStart.toMillis();
    await db.collection('sessions').doc(sessionId)
      .update({ breakTotal: firebase.firestore.FieldValue.increment(dur) });
    breakRef = null;
  }

  // End the session
  if (sessionId) {
    await db.collection('sessions').doc(sessionId)
      .update({ endTime: firebase.firestore.FieldValue.serverTimestamp() });
    sessionId = null;
  }

  pauseTimerUI();           // ← only pause, do NOT reset
  await updateTodayTotal(); // refresh daily total
  if (dailyTotalInterval) {
    clearInterval(dailyTotalInterval);
    dailyTotalInterval = null;
  }
  auth.signOut();
};

auth.onAuthStateChanged(user => {
  if (user) {
    // derive a friendly name: use displayName if set, otherwise email prefix
    const rawName = user.displayName || user.email.split('@')[0];
    document.getElementById('userName').textContent = rawName;
    authSection.hidden = true;
    dashboard.hidden = false;
    logoutBtn.hidden = false;
    setMode('initial');
    updateTodayTotal();
    if (!dailyTotalInterval) {
      dailyTotalInterval = setInterval(updateTodayTotal, 60_000);
    }
    fetchRandomQuote();  
  } else {
    authSection.hidden = false;
    dashboard.hidden = true;
    logoutBtn.hidden = true;
    setMode('initial');
    quoteSection.textContent = '';
  }
});

// ===== Timer UI Functions =====
function startTimerUI() {
  clearInterval(timerInt);
  sessionStartTime = Date.now();

  // Format and display start time
  const startTimeDate = new Date();
  startTimeElement.textContent = startTimeDate
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Update status display
  statusDisplay.textContent = 'Currently Working';
  statusDisplay.classList.remove('inactive', 'break');
  statusDisplay.classList.add('active');

  timerInt = setInterval(() => {
    const now = Date.now();
    const elapsed = elapsedBeforePause + (now - sessionStartTime);
    timerDisplay.textContent = msToHMS(elapsed);
  }, 1000);
}

function pauseTimerUI() {
  clearInterval(timerInt);
  elapsedBeforePause += Date.now() - sessionStartTime;

  // Update status display
  statusDisplay.textContent = 'On Break';
  statusDisplay.classList.remove('active', 'inactive');
  statusDisplay.classList.add('break');
}

function stopTimerUI() {
  clearInterval(timerInt);

  // Update status display
  statusDisplay.textContent = 'Not Working';
  statusDisplay.classList.remove('active', 'break');
  statusDisplay.classList.add('inactive');

  // Reset start time display
  startTimeElement.textContent = '--:--';

  elapsedBeforePause = 0;
  timerDisplay.textContent = '00:00:00';
}

// ===== Button Handlers with Timer & Firestore Logic =====
startBtn.onclick = async () => {
  if (sessionId) return;
  console.log('✅ Start Work clicked');
  sessionId = (await db.collection('sessions').add({
    userId: auth.currentUser.uid,
    startTime: firebase.firestore.FieldValue.serverTimestamp(),
    breakTotal: 0
  })).id;

  elapsedBeforePause = 0;
  startTimerUI();
  setMode('working');
};

breakBtn.onclick = async () => {
  console.log('⏸️ Take Break clicked');
  breakRef = await db.collection('sessions')
    .doc(sessionId)
    .collection('breaks')
    .add({ breakStart: firebase.firestore.FieldValue.serverTimestamp() });
  pauseTimerUI();
  setMode('onBreak');
};

resumeBtn.onclick = async () => {
  if (!breakRef) return;
  console.log('▶️ Resume Work clicked');
  await breakRef.update({ breakEnd: firebase.firestore.FieldValue.serverTimestamp() });
  const brkSnap = await breakRef.get();
  const { breakStart, breakEnd } = brkSnap.data();
  const duration = breakEnd.toMillis() - breakStart.toMillis();
  await db.collection('sessions').doc(sessionId)
    .update({ breakTotal: firebase.firestore.FieldValue.increment(duration) });

  breakRef = null;
  startTimerUI();
  setMode('working');
};

clockoutBtn.onclick = async () => {
  // 1) close any open break
  console.log('🏁 Clock Out clicked');
  if (breakRef) {
    await breakRef.update({ breakEnd: firebase.firestore.FieldValue.serverTimestamp() });
    const snap = await breakRef.get();
    const dur = snap.data().breakEnd.toMillis() - snap.data().breakStart.toMillis();
    await db.collection('sessions').doc(sessionId)
      .update({ breakTotal: firebase.firestore.FieldValue.increment(dur) });
    breakRef = null;
  }

  // 2) end the session
  const endedSessionId = sessionId;
  await db.collection('sessions').doc(endedSessionId)
    .update({ endTime: firebase.firestore.FieldValue.serverTimestamp() });
  sessionId = null;

  // 3) reset UI & show only Start + today's total
  stopTimerUI();
  setMode('initial');
  await updateTodayTotal();

  // 4) log to Google Sheet
  await sendSummaryToSheet(endedSessionId);

  // 5) restart the 1-min updater
  if (dailyTotalInterval) clearInterval(dailyTotalInterval);
  dailyTotalInterval = setInterval(updateTodayTotal, 60_000);
};

// ===== Daily Total Calculation =====
async function updateTodayTotal() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const snap = await db.collection('sessions')
    .where('userId', '==', auth.currentUser.uid)
    .where('startTime', '>=', firebase.firestore.Timestamp.fromDate(startOfDay))
    .get();

  let totalMs = 0;
  snap.forEach(doc => {
    const data = doc.data();
    if (data.endTime) {
      totalMs += data.endTime.toMillis()
        - data.startTime.toMillis()
        - (data.breakTotal || 0);
    }
  });

  const hrs = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  todayTotalEl.textContent = `${hrs}h ${mins}m ${secs}s`;
}

// ===== Midnight Reset Scheduler =====
function msUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow - now;
}
setTimeout(() => {
  stopTimerUI();
  updateTodayTotal();
  setInterval(() => {
    stopTimerUI();
    updateTodayTotal();
  }, 24 * 3600 * 1000);
}, msUntilMidnight());

// ===== Send to Google Sheet =====
async function sendSummaryToSheet(sessionDocId) {
  const user = auth.currentUser;
  if (!user) return;

  const email = user.email;
  const name = email.split('@')[0];

  const sessionSnap = await db.collection('sessions')
    .doc(sessionDocId)
    .get();
  if (!sessionSnap.exists) return;
  const rec = sessionSnap.data();
  const start = rec.startTime.toDate();
  const end = rec.endTime.toDate();

  const ci = start.toLocaleTimeString('en-GB', { hour12: false });
  const co = end.toLocaleTimeString('en-GB', { hour12: false });

  // compute total today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dailySnap = await db.collection('sessions')
    .where('userId', '==', user.uid)
    .where('startTime', '>=', firebase.firestore.Timestamp.fromDate(startOfDay))
    .get();

  let dailyMs = 0;
  dailySnap.forEach(doc => {
    const s = doc.data();
    if (!s.endTime) return;
    dailyMs += s.endTime.toMillis()
      - s.startTime.toMillis()
      - (s.breakTotal || 0);
  });
  const totalToday = msToHMS(dailyMs);

  const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSe3-0Ty41UD4kmJDfIsDsCdcITCHVwuXdXVFM-EZaY7TUV9aQ/formResponse';
  const formData = new URLSearchParams();
  formData.append('entry.851716110', name);
  formData.append('entry.1407039982', ci);
  formData.append('entry.1613621228', co);
  formData.append('entry.628581510', totalToday);

  try {
    await fetch(formUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    console.log('Logged to Google Form');
  } catch (err) {
    console.error('Form submission failed:', err);
  }
}


// ===== Prevent Close While Working =====
window.addEventListener('beforeunload', function (e) {
  if (currentMode === 'working') {
    e.preventDefault();
    e.returnValue = 'You are still clocked in. Do you want to leave without clocking out?';
    return 'You are still clocked in. Do you want to leave without clocking out?';
  }
});



