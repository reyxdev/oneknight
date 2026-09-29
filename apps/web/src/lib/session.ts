"use client";

import { useEffect, useState } from "react";
import { hasAuthHint } from "./api";

/**
 * Whether the visitor has a ONEKNIGHT session, read from the non-secret `ok_auth` hint cookie.
 * The real session is an HttpOnly cookie checked by the API; this only decides which button to show.
 */
export function useSignedIn(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => setV(hasAuthHint()), []);
  return v;
}
