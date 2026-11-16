import { GithubSettings } from "../github-settings";

export const metadata = { title: "Inbox · GitHub · Product Velocity" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; why?: string; project?: string; t?: string }> }) {
  return <GithubSettings section="inbox" searchParams={searchParams} />;
}
