import { GithubSettings } from "./github-settings";

export const metadata = { title: "Connection · GitHub · Product Velocity" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; why?: string; project?: string; t?: string }> }) {
  return <GithubSettings section="connection" searchParams={searchParams} />;
}
