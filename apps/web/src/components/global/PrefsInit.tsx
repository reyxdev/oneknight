"use client";

import { useEffect } from "react";
import { initPrefs } from "@/lib/prefs";

export function PrefsInit() {
  useEffect(() => initPrefs(), []);
  return null;
}
