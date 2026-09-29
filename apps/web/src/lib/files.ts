"use client";

/** Reads a picked image as a data URL for the JSON upload API (the server checks the real type). */
export function readImage(file: File): Promise<{ name: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: String(r.result) });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export const fileUrl = (id: string) => `/api/files/${id}`;
