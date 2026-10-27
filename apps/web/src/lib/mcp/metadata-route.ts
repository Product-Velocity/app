import { NextResponse } from "next/server";
import { mcpEnabled } from "./auth";
import { resourceMetadata } from "./rpc";
import { supabaseEnv } from "@/lib/supabase/env";
import { siteUrl } from "@/lib/site-url";

export async function metadataResponse() {
  if (!mcpEnabled()) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(resourceMetadata(await siteUrl(), supabaseEnv().url), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
