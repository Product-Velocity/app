/** Rules of the public contact form (issue #530). Pure, so the server action, the page and the tests share them. */
export const CONTACT_SUBJECTS = [
  { slug: "general", label: "A question about Product Velocity" },
  { slug: "early-access", label: "Join us" },
  { slug: "connector", label: "Connecting Claude or another AI assistant" },
  { slug: "privacy", label: "Privacy or my data" },
  { slug: "security", label: "A security concern" },
  { slug: "partnerships", label: "Press or partnerships" },
  { slug: "other", label: "Something else" },
] as const;
export type ContactSlug = (typeof CONTACT_SUBJECTS)[number]["slug"];

export type ContactInput = { name: string; email: string; subject: string; message: string; website: string };
export type ContactErrors = Partial<Record<"name" | "email" | "subject" | "message", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strip = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
const clean = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? strip(v).replace(/[\r\n]+/g, " ").trim().slice(0, max) : "");

export function readContact(f: FormData): ContactInput {
  const m = f.get("message");
  return {
    name: clean(f.get("name"), 120),
    email: clean(f.get("email"), 200).toLowerCase(),
    subject: clean(f.get("subject"), 80),
    message: typeof m === "string" ? strip(m).replace(/\r\n?/g, "\n").trim().slice(0, 4000) : "",
    website: clean(f.get("website"), 200),
  };
}

export function checkContact(v: ContactInput): ContactErrors {
  const e: ContactErrors = {};
  if (!v.name) e.name = "Enter your name.";
  if (!EMAIL.test(v.email)) e.email = "Enter an email address we can reply to.";
  if (!CONTACT_SUBJECTS.some((s) => s.label === v.subject)) e.subject = "Choose what this is about.";
  if (v.message.length < 10) e.message = "Write a few words so we can help.";
  return e;
}

/** The label for a ?subject= link, or "" when the link names none we know. */
export const subjectFromSlug = (slug: string | undefined): string => CONTACT_SUBJECTS.find((s) => s.slug === slug)?.label ?? "";

/** Path of the contact page, optionally with the subject already chosen. */
export const contactHref = (slug?: ContactSlug) => (slug ? `/contact?subject=${slug}` : "/contact");
