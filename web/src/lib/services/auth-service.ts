import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  UserCredential,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "@/lib/firebase/client";

export function registerWithEmail(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function loginWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout(): Promise<void> {
  return signOut(auth);
}

export async function registerMemberAccount(
  name: string,
  email: string,
  password: string,
): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  await setDoc(doc(db, "users", credential.user.uid), {
    name,
    email,
    role: "member",
    createdAt: serverTimestamp(),
  });

  await signOut(auth);
  return credential;
}

export async function createAdminTestAccount(): Promise<{
  email: string;
  password: string;
  created: boolean;
}> {
  const email = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "admin@gloop.local";
  const password = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? "Admin123!";

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    await signOut(auth);
    return { email, password, created: true };
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "auth/email-already-in-use") {
      return { email, password, created: false };
    }

    throw error;
  }
}
