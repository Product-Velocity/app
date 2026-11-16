import { GithubSettings } from "../github-settings";

export const metadata = { title: "Field mapping · GitHub · Product Velocity" };
/** The field mapping reads several GitHub endpoints: allow the longest run the plan offers. */
export const maxDuration = 60;

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; why?: string; project?: string; t?: string }> }) {
  return <GithubSettings section="mapping" searchParams={searchParams} />;
}
