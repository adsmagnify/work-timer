// ===== Element References =====
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbw0qqnD-_3Pa0fNL5GtOssGDj_LHDJRCKQ7mM9abF7qoiU-qHY4VV809mU4lCG12GXhzg/exec';
const authSection = document.getElementById('authSection');
const dashboard = document.getElementById('dashboard');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn = document.getElementById('logoutBtn');

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

  // clear the 1-minute updater so it restarts fresh next login
  if (dailyTotalInterval) {
    clearInterval(dailyTotalInterval);
    dailyTotalInterval = null;
  }

  auth.signOut();
};


auth.onAuthStateChanged(user => {
  if (user) {
    authSection.hidden = true;
    dashboard.hidden = false;
    logoutBtn.hidden = false;
    updateTodayTotal();
    if (!dailyTotalInterval) {
      dailyTotalInterval = setInterval(updateTodayTotal, 60_000);
    }
  } else {
    authSection.hidden = false;
    dashboard.hidden = true;
    logoutBtn.hidden = true;
    // we no longer clearInterval or reset timerDisplay here
  }
});


// ===== Timer UI Functions =====
function startTimerUI() {
  clearInterval(timerInt);
  sessionStartTime = Date.now();
  timerInt = setInterval(() => {
    const now = Date.now();
    const elapsed = elapsedBeforePause + (now - sessionStartTime);
    timerDisplay.textContent = msToHMS(elapsed);
  }, 1000);

  startBtn.hidden = true;
  breakBtn.hidden = false;
  resumeBtn.hidden = true;
  clockoutBtn.hidden = false;
}

function pauseTimerUI() {
  clearInterval(timerInt);
  elapsedBeforePause += Date.now() - sessionStartTime;

  breakBtn.hidden = true;
  resumeBtn.hidden = false;
}

function stopTimerUI() {
  clearInterval(timerInt);

  startBtn.hidden = false;
  breakBtn.hidden = true;
  resumeBtn.hidden = true;
  clockoutBtn.hidden = true;

  elapsedBeforePause = 0;
  timerDisplay.textContent = '00:00:00';
}

// ===== Button Handlers with Timer & Firestore Logic =====
startBtn.onclick = async () => {
  if (sessionId) return;    // already clocked in
  console.log('✅ Start Work clicked');
  // … create your Firestore doc …
  sessionId = (await db.collection('sessions').add({
    userId: auth.currentUser.uid,
    startTime: firebase.firestore.FieldValue.serverTimestamp(),
    breakTotal: 0
  })).id;

  // reset any leftover state
  elapsedBeforePause = 0;
  startTimerUI();
};

breakBtn.onclick = async () => {
  console.log('⏸️ Take Break clicked');
  // log break start
  breakRef = await db.collection('sessions')
    .doc(sessionId)
    .collection('breaks')
    .add({ breakStart: firebase.firestore.FieldValue.serverTimestamp() });
  pauseTimerUI();
};

resumeBtn.onclick = async () => {
  if (!breakRef) {
    console.warn('No active break to resume.');
    return;
  }

  console.log('▶️ Resume Work clicked');
  // close out the break and accumulate its duration
  await breakRef.update({ breakEnd: firebase.firestore.FieldValue.serverTimestamp() });
  const brkSnap = await breakRef.get();
  const { breakStart, breakEnd } = brkSnap.data();
  const duration = breakEnd.toMillis() - breakStart.toMillis();
  await db.collection('sessions').doc(sessionId)
    .update({ breakTotal: firebase.firestore.FieldValue.increment(duration) });

  breakRef = null;   // clear so you can break again later
  startTimerUI();
};


clockoutBtn.onclick = async () => {
  console.log('🏁 Clock Out clicked');

  // 1) Close any open break (if applicable)
  if (breakRef) {
    await breakRef.update({ breakEnd: firebase.firestore.FieldValue.serverTimestamp() });
    const snap = await breakRef.get();
    const dur = snap.data().breakEnd.toMillis() - snap.data().breakStart.toMillis();
    await db.collection('sessions').doc(sessionId)
      .update({ breakTotal: firebase.firestore.FieldValue.increment(dur) });
    breakRef = null;
  }

  // 2) END the session and remember its ID
  const endedSessionId = sessionId;   // ← capture before clearing
  await db.collection('sessions').doc(endedSessionId)
    .update({ endTime: firebase.firestore.FieldValue.serverTimestamp() });
  sessionId = null;                   // ← allow Start Work again

  // 3) Update the UI
  // 3) Update the UI, but don’t zero it:
  pauseTimerUI();             // stops the interval, keeps elapsedBeforePause
  startBtn.hidden    = false;
  breakBtn.hidden    = true;
  resumeBtn.hidden   = true;
  clockoutBtn.hidden = true;
  await updateTodayTotal();

  // 4) Log to Google Sheet
  await sendSummaryToSheet(endedSessionId);  // ← pass the ID

  // 5) Clean up the daily‐total interval and logout if desired
  if (dailyTotalInterval) {
    clearInterval(dailyTotalInterval);
    dailyTotalInterval = null;
  }
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
      const sessionMs = data.endTime.toMillis()
        - data.startTime.toMillis()
        - (data.breakTotal || 0);
      totalMs += sessionMs;
    }
  });

  const hrs = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  todayTotalEl.textContent = `${hrs}h ${mins}m`;
}

// Calculate milliseconds until next midnight
function msUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow - now;
}

// Schedule a full reset at midnight
setTimeout(() => {
  // Reset UI state
  stopTimerUI();             // clears interval and resets display
  updateTodayTotal();        // should show 0 for the new day
  // Schedule again for next midnight
  setInterval(() => {
    stopTimerUI();
    updateTodayTotal();
  }, 24 * 3600 * 1000);
}, msUntilMidnight());

async function sendSummaryToSheet(sessionDocId) {
  const user = auth.currentUser;
  if (!user) return;

  // derive user name
  const email = user.email;
  const name  = email.split('@')[0];

  // 1) Fetch *this* session’s data first
  const sessionSnap = await db.collection('sessions')
                              .doc(sessionDocId)
                              .get();
  if (!sessionSnap.exists) {
    console.error('No such session:', sessionDocId);
    return;
  }
  const rec = sessionSnap.data();
  const start = rec.startTime.toDate();
  const end   = rec.endTime  .toDate();

  // format clock-in and clock-out as HH:MM:SS in local (IST) 24h
  const ci = start.toLocaleTimeString('en-GB', { hour12: false });
  const co = end  .toLocaleTimeString('en-GB', { hour12: false });

  // 2) Now compute *today’s* total across all sessions
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);

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

  // 3) Build and POST to your Google Form
  const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSe3-0Ty41UD4kmJDfIsDsCdcITCHVwuXdXVFM-EZaY7TUV9aQ/formResponse';
  const formData = new URLSearchParams();
  formData.append('entry.851716110', name);
  formData.append('entry.1407039982', ci);
  formData.append('entry.1613621228', co);
  formData.append('entry.628581510', totalToday);

  try {
    await fetch(formUrl, {
      method: 'POST',
      mode:   'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:   formData.toString()
    });
    console.log('Logged to Google Form');
  } catch (err) {
    console.error('Form submission failed:', err);
  }
}



