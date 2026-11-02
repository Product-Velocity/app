"use server";

/** The test page has nothing to connect to; the buttons only have to be real form actions. */
export async function connectNoop(): Promise<void> {}
export async function disconnectNoop(): Promise<void> {}
