// TODO: Replace with your Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyDsM6WpKssg1WeVoyM9cdY1dgsJp7ceJk8",
    authDomain: "work-timer-e9be9.firebaseapp.com",
    projectId: "work-timer-e9be9",
    storageBucket: "work-timer-e9be9.firebasestorage.app",
    messagingSenderId: "174802839864",
    appId: "1:174802839864:web:3620f3148138d1becdb9cd",
    measurementId: "G-RZZ9TP0D2S"
  };
  
  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  