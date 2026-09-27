import { supabase } from "./supabaseClient.js";

let currentSession = null;
const listeners = [];

export function onAuthChange(fn) {
  listeners.push(fn);
}

function notify() {
  listeners.forEach((fn) => fn(currentSession));
}

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    notify();
  });
  return currentSession;
}

export function getSession() {
  return currentSession;
}

// Rolle "viewer" darf laut Datenbank-Regeln nichts anlegen/ändern/löschen.
export function canEdit() {
  if (!currentSession) return false;
  const role = currentSession.user?.user_metadata?.role;
  return role !== "viewer";
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
