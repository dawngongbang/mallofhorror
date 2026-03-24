import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyDTZbo4cCKL9kzgi49x2aTR0JB7H983Evw',
  authDomain: 'mall-of-horror.firebaseapp.com',
  databaseURL: 'https://mall-of-horror-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'mall-of-horror',
  storageBucket: 'mall-of-horror.firebasestorage.app',
  messagingSenderId: '802802550769',
  appId: '1:802802550769:web:f37fe4fed29920d0b8a650',
}

export const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
export const auth = getAuth(app)
