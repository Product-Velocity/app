import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";
import { ContactForm } from "./contact-form";
import { subjectFromSlug } from "./contact";

export const metadata: Metadata = {
  title: "Contact Product Velocity",
  description: "Send a question, a privacy request or a note about joining us to the Product Velocity team.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ subject?: string | string[] }> }) {
  const q = (await searchParams).subject;
  const subject = subjectFromSlug(Array.isArray(q) ? q[0] : q);
  return (
    <PublicPage title="Contact us" intro="Send us a message and we will reply by email. Choose what it is about so it reaches the right place.">
      <ContactForm subject={subject} />
    </PublicPage>
  );
}
