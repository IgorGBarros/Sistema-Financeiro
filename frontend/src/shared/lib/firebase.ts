/**
 * Firebase é opcional em desenvolvimento.
 *
 * Sem VITE_FIREBASE_API_KEY, o app não inicializa o Firebase e o cliente da
 * API não manda header de autorização — o backend cai na
 * AutenticacaoDesenvolvimento. Assim `npm run dev` funciona no primeiro
 * minuto, sem criar projeto no console do Google.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseHabilitado = Boolean(config.apiKey);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (firebaseHabilitado) {
  app = initializeApp(config);
  auth = getAuth(app);
}

export const obterAuth = () => auth;

/** Token do usuário logado, ou null quando o Firebase está desligado. */
export async function obterToken(): Promise<string | null> {
  const usuario = auth?.currentUser;
  return usuario ? usuario.getIdToken() : null;
}
