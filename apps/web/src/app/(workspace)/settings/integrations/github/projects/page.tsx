import { GithubSettings } from "../github-settings";

export const metadata = { title: "Projects · GitHub · Product Velocity" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; why?: string; project?: string; t?: string }> }) {
  return <GithubSettings section="projects" searchParams={searchParams} />;
}
